import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type GoogleOAuthClientFile = {
  installed?: {
    client_id?: string;
    client_secret?: string;
    token_uri?: string;
  };
  web?: {
    client_id?: string;
    client_secret?: string;
    token_uri?: string;
  };
};

function tryReadOAuthClient() {
  const candidates = [
    path.resolve(__dirname, "../src-tauri/secrets/google-oauth-client.json"),
    path.resolve(__dirname, "secrets/google-oauth-client.json"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const raw = fs.readFileSync(candidate, "utf8");
    const parsed = JSON.parse(raw) as GoogleOAuthClientFile;
    const config = parsed.web ?? parsed.installed;
    if (!config?.client_id || !config.client_secret) {
      throw new Error(`Google OAuth client file is incomplete: ${candidate}`);
    }

    return {
      clientId: config.client_id,
      clientSecret: config.client_secret,
      tokenUri: config.token_uri || "https://oauth2.googleapis.com/token",
    };
  }

  return null;
}

const LIVE_GOOGLE_API_ORIGIN =
  process.env.KIDDAI_LIVE_GOOGLE_API?.trim() || "https://kiddai.netlify.app";
const PROXY_LIVE_MESSAGING = process.env.KIDDAI_PROXY_LIVE_MESSAGING?.trim() === "true";

async function proxyApiToLiveSite(req: IncomingMessage, res: ServerResponse) {
  const pathAndQuery = req.url ?? "/";
  const target = `${LIVE_GOOGLE_API_ORIGIN}${pathAndQuery}`;
  const headers: Record<string, string> = {};
  if (req.headers["content-type"]) {
    headers["Content-Type"] = String(req.headers["content-type"]);
  }

  const init: RequestInit = { method: req.method ?? "GET", headers };
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    init.body = Buffer.concat(chunks);
  }

  const response = await fetch(target, init);
  const text = await response.text();
  res.statusCode = response.status;
  res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function googleAuthApiPlugin(): Plugin {
  return {
    name: "kiddai-google-auth-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const isGoogleApi = req.url?.startsWith("/api/google/");
        const isMessagingApi =
          req.url?.startsWith("/api/facebook/") || req.url?.startsWith("/api/line/");

        if (!isGoogleApi && !isMessagingApi) {
          next();
          return;
        }

        try {
          if (isMessagingApi) {
            if (PROXY_LIVE_MESSAGING) {
              await proxyApiToLiveSite(req, res);
            } else {
              // Local development must not silently generate paid production
              // Function traffic. Opt in explicitly only while testing bells.
              sendJson(res, 200, {
                unreadCount: 0,
                notifications: [],
                localDevelopment: true,
              });
            }
            return;
          }

          const oauth = tryReadOAuthClient();
          if (!oauth) {
            await proxyApiToLiveSite(req, res);
            return;
          }

          if (req.method === "GET" && req.url === "/api/google/client-id") {
            sendJson(res, 200, { clientId: oauth.clientId });
            return;
          }

          if (req.method === "POST" && req.url === "/api/google/token") {
            const body = await readJsonBody(req);
            const code = body.code?.trim();
            const redirectUri = body.redirectUri?.trim();
            if (!code || !redirectUri) {
              sendJson(res, 400, { error: "Missing authorization code or redirect URI." });
              return;
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

            const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
            if (!tokenResponse.ok) {
              sendJson(res, 400, {
                error:
                  (tokenPayload.error_description as string) ||
                  (tokenPayload.error as string) ||
                  "Unable to exchange Google authorization code.",
              });
              return;
            }

            sendJson(res, 200, tokenPayload);
            return;
          }

          if (req.method === "POST" && req.url === "/api/google/refresh") {
            const body = await readJsonBody(req);
            const refreshToken = body.refreshToken?.trim();
            if (!refreshToken) {
              sendJson(res, 400, { error: "Missing refresh token." });
              return;
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

            const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
            if (!tokenResponse.ok) {
              sendJson(res, 400, {
                error:
                  (tokenPayload.error_description as string) ||
                  (tokenPayload.error as string) ||
                  "Unable to refresh Google access token.",
              });
              return;
            }

            sendJson(res, 200, tokenPayload);
            return;
          }

          sendJson(res, 404, { error: "Not found" });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Google auth API failed.",
          });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), googleAuthApiPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
