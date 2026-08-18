const TOKEN_URI = "https://oauth2.googleapis.com/token";

function getClientIdOnly() {
  const fromEnv =
    process.env.GOOGLE_CLIENT_ID?.trim() || process.env.VITE_GOOGLE_CLIENT_ID?.trim() || "";
  if (fromEnv) {
    return fromEnv;
  }
  throw new Error(
    "Missing Google client ID. Set GOOGLE_CLIENT_ID (or VITE_GOOGLE_CLIENT_ID) in Netlify environment variables.",
  );
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || process.env.VITE_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (clientId && clientSecret) {
    return {
      clientId,
      clientSecret,
      tokenUri: process.env.GOOGLE_TOKEN_URI?.trim() || TOKEN_URI,
    };
  }

  throw new Error(
    "Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify environment variables.",
  );
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function getAction(event) {
  const fromQuery = event.queryStringParameters?.action?.trim();
  if (fromQuery) {
    return fromQuery;
  }

  const rawPath = event.path || "";
  const parts = rawPath.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (last === "client-id" || last === "token" || last === "refresh") {
    return last;
  }
  return "";
}

export async function handler(event) {
  try {
    const action = getAction(event);
    const method = event.httpMethod || "GET";
    if (method === "GET" && action === "client-id") {
      return json(200, { clientId: getClientIdOnly() });
    }

    const oauth = getOAuthClient();

    if (method === "POST" && action === "token") {
      const body = JSON.parse(event.body || "{}");
      const code = String(body.code || "").trim();
      const redirectUri = String(body.redirectUri || "").trim();
      if (!code || !redirectUri) {
        return json(400, { error: "Missing authorization code or redirect URI." });
      }

      const tokenResponse = await fetch(oauth.tokenUri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok) {
        return json(400, {
          error:
            tokenPayload.error_description ||
            tokenPayload.error ||
            "Unable to exchange Google authorization code.",
        });
      }
      return json(200, tokenPayload);
    }

    if (method === "POST" && action === "refresh") {
      const body = JSON.parse(event.body || "{}");
      const refreshToken = String(body.refreshToken || "").trim();
      if (!refreshToken) {
        return json(400, { error: "Missing refresh token." });
      }

      const tokenResponse = await fetch(oauth.tokenUri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          grant_type: "refresh_token",
        }),
      });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok) {
        return json(400, {
          error:
            tokenPayload.error_description ||
            tokenPayload.error ||
            "Unable to refresh Google access token.",
        });
      }
      return json(200, tokenPayload);
    }

    return json(404, { error: "Not found" });
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : "Google auth API failed.",
    });
  }
}
