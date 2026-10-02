import { createReadStream } from "node:fs";
import { createCompanyApi } from "./store.mjs";

const JSON_LIMIT = 1_000_000;
const UPLOAD_LIMIT = 85 * 1024 * 1024;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("That upload is too large.");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function cookieToken(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === "company_sid") return decodeURIComponent(rest.join("="));
  }
  return "";
}

function setSessionCookie(res, token) {
  const value = token ? encodeURIComponent(token) : "";
  const maxAge = token ? 60 * 60 * 24 * 14 : 0;
  res.setHeader(
    "Set-Cookie",
    `company_sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
  );
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  const boundary = match?.[1] || match?.[2];
  if (!boundary) {
    const error = new Error("Upload could not be read.");
    error.status = 400;
    throw error;
  }
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  let start = buffer.indexOf(delimiter);
  if (start < 0) {
    const error = new Error("Upload could not be read.");
    error.status = 400;
    throw error;
  }
  start += delimiter.length;

  while (start < buffer.length) {
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    else if (buffer[start] === 10) start += 1;
    const next = buffer.indexOf(delimiter, start);
    if (next < 0) break;
    let part = buffer.subarray(start, next);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.subarray(0, part.length - 2);
    }
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd >= 0) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      const body = part.subarray(headerEnd + 4);
      const name = /name="([^"]+)"/i.exec(headerText)?.[1];
      const filename = /filename="([^"]*)"/i.exec(headerText)?.[1];
      const mime = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim().toLowerCase();
      if (name && filename) {
        files.push({ filename, mime: mime || "application/octet-stream", data: body });
      } else if (name) {
        fields[name] = body.toString("utf8");
      }
    }
    start = next + delimiter.length;
  }

  return { fields, files: files.filter((item) => item.filename) };
}

function requireUser(api, req) {
  const user = api.userFromToken(cookieToken(req));
  if (!user) {
    const error = new Error("Sign in to the company portal.");
    error.status = 401;
    throw error;
  }
  return user;
}

function groupIdFrom(pathname) {
  const match = /^\/api\/company\/groups\/(\d+)(?:\/|$)/.exec(pathname);
  if (!match) {
    const error = new Error("That group does not exist.");
    error.status = 404;
    throw error;
  }
  return Number(match[1]);
}

async function handle(api, req, res, url) {
  const { pathname } = url;

  if (req.method === "POST" && pathname === "/api/company/login") {
    const raw = await readBody(req, JSON_LIMIT);
    let body = {};
    try {
      body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      const error = new Error("Sign-in could not be read.");
      error.status = 400;
      throw error;
    }
    const result = api.login(body.username, body.password);
    setSessionCookie(res, result.token);
    sendJson(res, 200, { user: result.user });
    return;
  }

  if (req.method === "POST" && pathname === "/api/company/logout") {
    api.logout(cookieToken(req));
    setSessionCookie(res, "");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/company/me") {
    const user = api.userFromToken(cookieToken(req));
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === "GET" && pathname === "/api/company/inbox") {
    const user = requireUser(api, req);
    sendJson(res, 200, api.inbox(user, url.searchParams.get("tab") || "all"));
    return;
  }

  const mediaMatch = /^\/api\/company\/media\/([^/]+)$/.exec(pathname);
  if (req.method === "GET" && mediaMatch) {
    const user = requireUser(api, req);
    const media = api.mediaFor(user, decodeURIComponent(mediaMatch[1]));
    res.statusCode = 200;
    res.setHeader("Content-Type", media.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${String(media.fileName).replace(/[\r\n"]/g, "")}"`,
    );
    createReadStream(media.absPath).pipe(res);
    return;
  }

  if (pathname.startsWith("/api/company/groups/")) {
    const user = requireUser(api, req);
    const groupId = groupIdFrom(pathname);

    if (req.method === "GET" && pathname === `/api/company/groups/${groupId}`) {
      sendJson(res, 200, api.thread(user, groupId));
      return;
    }

    if (req.method === "POST" && pathname === `/api/company/groups/${groupId}/read`) {
      sendJson(res, 200, api.markRead(user, groupId));
      return;
    }

    if (req.method === "POST" && pathname === `/api/company/groups/${groupId}/messages`) {
      const type = String(req.headers["content-type"] || "");
      let body = "";
      let department = "";
      let kind = "message";
      let prepare = "";
      let replyTo = "";
      let files = [];
      if (type.includes("multipart/form-data")) {
        const parsed = parseMultipart(await readBody(req, UPLOAD_LIMIT), type);
        body = parsed.fields.body || "";
        department = parsed.fields.department || "";
        kind = parsed.fields.kind || "message";
        prepare = parsed.fields.prepare || "";
        replyTo = parsed.fields.replyTo || "";
        files = parsed.files;
      } else {
        const raw = await readBody(req, JSON_LIMIT);
        let payload = {};
        try {
          payload = raw.length ? JSON.parse(raw.toString("utf8")) : {};
        } catch {
          const error = new Error("Message could not be read.");
          error.status = 400;
          throw error;
        }
        body = payload.body || "";
        department = payload.department || "";
        kind = payload.kind || "message";
        prepare = payload.prepare || "";
        replyTo = payload.replyTo || "";
      }
      sendJson(res, 201, api.sendMessage(user, groupId, { body, files, department, kind, prepare, replyTo }));
      return;
    }

    const pinMatch = /^\/api\/company\/groups\/(\d+)\/messages\/(\d+)\/pin$/.exec(pathname);
    if (req.method === "POST" && pinMatch) {
      sendJson(res, 200, api.pinMessage(user, Number(pinMatch[1]), Number(pinMatch[2])));
      return;
    }

    if (req.method === "GET" && pathname === `/api/company/groups/${groupId}/calls/active`) {
      sendJson(res, 200, api.activeCall(user, groupId));
      return;
    }

    if (req.method === "POST" && pathname === `/api/company/groups/${groupId}/calls`) {
      const raw = await readBody(req, JSON_LIMIT);
      let payload = {};
      try {
        payload = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      } catch {
        const error = new Error("That call could not be read.");
        error.status = 400;
        throw error;
      }
      sendJson(res, 201, api.startCall(user, groupId, payload.kind));
      return;
    }

    const callEnd = /^\/api\/company\/groups\/(\d+)\/calls\/(\d+)\/end$/.exec(pathname);
    if (req.method === "POST" && callEnd) {
      sendJson(res, 200, api.endCall(user, Number(callEnd[1]), Number(callEnd[2])));
      return;
    }

    const callSignals = /^\/api\/company\/groups\/(\d+)\/calls\/(\d+)\/signals$/.exec(pathname);
    if (callSignals && req.method === "GET") {
      const after = url.searchParams.get("after") || "0";
      sendJson(res, 200, api.callSignals(user, Number(callSignals[1]), Number(callSignals[2]), after));
      return;
    }
    if (callSignals && req.method === "POST") {
      const raw = await readBody(req, JSON_LIMIT);
      let payload = {};
      try {
        payload = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      } catch {
        const error = new Error("That call update could not be read.");
        error.status = 400;
        throw error;
      }
      sendJson(res, 201, api.postSignal(user, Number(callSignals[1]), Number(callSignals[2]), payload));
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

export function companyApiPlugin() {
  return {
    name: "kiddai-company-api",
    configureServer(server) {
      const api = createCompanyApi();
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/api/company")) {
          next();
          return;
        }
        handle(api, req, res, url).catch((error) => {
          if (res.headersSent || res.writableEnded) return;
          const status = Number(error?.status) || 500;
          sendJson(res, status, {
            error: error instanceof Error ? error.message : "Company API failed.",
          });
        });
      });
    },
  };
}
