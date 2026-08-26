import {
  GOOGLE_CONNECTION_STORAGE_KEY,
  GOOGLE_TOKEN_STORAGE_KEY,
} from "../constants/storage";
import type { GoogleConnectionState } from "../types/googleConnection";

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
].join(" ");

type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

function readStoredToken(): StoredToken | null {
  const rawValue = window.localStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as StoredToken;
    if (!parsed.accessToken || !parsed.expiresAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredToken(token: StoredToken | null) {
  if (!token) {
    window.localStorage.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(GOOGLE_TOKEN_STORAGE_KEY, JSON.stringify(token));
}

function readStoredConnection(): GoogleConnectionState | null {
  const rawValue = window.localStorage.getItem(GOOGLE_CONNECTION_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as GoogleConnectionState;
  } catch {
    return null;
  }
}

function writeStoredConnection(connection: GoogleConnectionState | null) {
  if (!connection) {
    window.localStorage.removeItem(GOOGLE_CONNECTION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(GOOGLE_CONNECTION_STORAGE_KEY, JSON.stringify(connection));
}

function getRedirectUri() {
  return `${window.location.origin}/auth/callback`;
}

/** Public OAuth client ID (safe in frontend). Secret stays on Netlify Functions only. */
const PUBLIC_GOOGLE_CLIENT_ID =
  "631728775101-t3pi7kkuh15shl9i6ak1cr2f8kmq8s0f.apps.googleusercontent.com";

async function getClientId() {
  const fromEnv = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const response = await fetch("/api/google/client-id");
    const payload = (await response.json()) as { clientId?: string; error?: string };
    if (response.ok && payload.clientId?.trim()) {
      return payload.clientId.trim();
    }
  } catch {
    // Fall through to the public client ID.
  }

  return PUBLIC_GOOGLE_CLIENT_ID;
}

async function fetchAccountEmail(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Unable to load the connected Google account email.");
  }

  const payload = (await response.json()) as { email?: string };
  return payload.email?.trim() || null;
}

function persistTokenResponse(
  payload: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  },
  previousRefreshToken?: string,
) {
  if (!payload.access_token) {
    throw new Error("Google did not return an access token.");
  }

  const expiresInSeconds = Number(payload.expires_in ?? 3600);
  const token: StoredToken = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previousRefreshToken,
    expiresAt: Date.now() + Math.max(60, expiresInSeconds - 60) * 1000,
  };
  writeStoredToken(token);
  return token;
}

export async function connectGoogleAccount(): Promise<GoogleConnectionState> {
  const clientId = await getClientId();
  const redirectUri = getRedirectUri();
  const state = crypto.randomUUID();
  window.sessionStorage.setItem("kiddai.web.oauthState", state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);

  // The page navigates away; keep the promise pending until unload.
  return await new Promise<GoogleConnectionState>(() => undefined);
}

type GoogleCallbackInFlight = {
  code: string;
  state: string | null;
  promise: Promise<GoogleConnectionState>;
};

let googleCallbackInFlight: GoogleCallbackInFlight | null = null;

export async function completeGoogleConnectFromCallback(code: string, state: string | null) {
  if (
    googleCallbackInFlight &&
    googleCallbackInFlight.code === code &&
    googleCallbackInFlight.state === state
  ) {
    return googleCallbackInFlight.promise;
  }

  const callback: GoogleCallbackInFlight = {
    code,
    state,
    promise: finishGoogleConnectFromCallback(code, state),
  };
  googleCallbackInFlight = callback;

  try {
    return await callback.promise;
  } finally {
    if (googleCallbackInFlight === callback) {
      googleCallbackInFlight = null;
    }
  }
}

async function finishGoogleConnectFromCallback(code: string, state: string | null) {
  const expectedState = window.sessionStorage.getItem("kiddai.web.oauthState");

  if (!expectedState || !state || expectedState !== state) {
    throw new Error("Google sign-in state mismatch. Try Connect Google again from Settings.");
  }

  const redirectUri = getRedirectUri();
  const response = await fetch("/api/google/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirectUri }),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "Unable to complete Google sign-in.");
  }

  window.sessionStorage.removeItem("kiddai.web.oauthState");
  const token = persistTokenResponse(payload);
  const email = await fetchAccountEmail(token.accessToken);
  const connection: GoogleConnectionState = {
    status: "Connected",
    email,
    lastConnectedAt: new Date().toISOString(),
  };
  writeStoredConnection(connection);
  return connection;
}

export async function disconnectGoogleAccount() {
  const token = readStoredToken();
  if (token?.accessToken) {
    void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => undefined);
  }

  writeStoredToken(null);
  writeStoredConnection(null);
}

export async function getValidAccessToken(forceRefresh = false) {
  const existing = readStoredToken();
  if (!forceRefresh && existing && existing.expiresAt > Date.now()) {
    return existing.accessToken;
  }

  if (!existing?.refreshToken) {
    writeStoredToken(null);
    writeStoredConnection(null);
    throw new Error("Google session expired. Connect Google again in Settings.");
  }

  const response = await fetch("/api/google/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: existing.refreshToken }),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!response.ok) {
    writeStoredToken(null);
    writeStoredConnection(null);
    throw new Error(payload.error || "Google session expired. Connect Google again in Settings.");
  }

  const token = persistTokenResponse(payload, existing.refreshToken);
  return token.accessToken;
}

export async function restoreGoogleConnection() {
  const connection = readStoredConnection();
  const token = readStoredToken();

  if (!connection || connection.status !== "Connected" || !token) {
    return {
      connection: null,
      diagnostics: {
        refreshTokenFound: false,
        accessTokenRefreshed: false,
      },
      errorMessage: null as string | null,
    };
  }

  try {
    if (token.expiresAt <= Date.now()) {
      await getValidAccessToken(true);
    }

    return {
      connection,
      diagnostics: {
        refreshTokenFound: Boolean(token.refreshToken),
        accessTokenRefreshed: true,
      },
      errorMessage: null as string | null,
    };
  } catch (error) {
    writeStoredToken(null);
    writeStoredConnection(null);
    return {
      connection: null,
      diagnostics: {
        refreshTokenFound: Boolean(token.refreshToken),
        accessTokenRefreshed: false,
      },
      errorMessage:
        error instanceof Error
          ? error.message
          : "Google session expired. Connect Google again in Settings.",
    };
  }
}
