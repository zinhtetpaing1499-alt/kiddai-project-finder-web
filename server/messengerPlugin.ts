import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  HttpError,
  addMemberByName,
  createGroup,
  createPerson,
  getGroup,
  listInbox,
  listPeople,
  markRead,
  removeMember,
  renamePerson,
  resolveMedia,
  sendMessage,
  setMuted,
} from "./messengerStore.ts";

const BODY_LIMIT = 8_000_000;

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, "Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "Expected a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "Invalid JSON.");
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function personFrom(source: { personId?: string }, body: Record<string, unknown>): string {
  return asString(body.personId) || source.personId || "";
}

async function route(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/messenger")) {
    next();
    return;
  }

  const method = req.method ?? "GET";
  const queryPersonId = url.searchParams.get("personId")?.trim() ?? "";

  if (method === "GET" && pathname === "/api/messenger/people") {
    sendJson(res, 200, { people: listPeople() });
    return;
  }

  if (method === "POST" && pathname === "/api/messenger/people") {
    const body = await readJson(req);
    const person = createPerson(asString(body.personId), asString(body.name));
    sendJson(res, 200, { person });
    return;
  }

  const renameMatch = pathname.match(/^\/api\/messenger\/people\/([^/]+)$/);
  if (renameMatch && method === "PATCH") {
    const body = await readJson(req);
    const person = renamePerson(asString(body.personId), decodeURIComponent(renameMatch[1]), asString(body.name));
    sendJson(res, 200, { person });
    return;
  }

  if (method === "GET" && pathname === "/api/messenger/inbox") {
    sendJson(res, 200, { groups: listInbox(queryPersonId) });
    return;
  }

  if (method === "POST" && pathname === "/api/messenger/groups") {
    const body = await readJson(req);
    sendJson(res, 200, { group: createGroup(asString(body.personId)) });
    return;
  }

  const mediaMatch = pathname.match(/^\/api\/messenger\/media\/([^/]+)$/);
  if (mediaMatch && method === "GET") {
    const filename = decodeURIComponent(mediaMatch[1]);
    const filePath = resolveMedia(filename);
    if (!filePath) {
      sendJson(res, 404, { error: "Photo not found." });
      return;
    }
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const types: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    };
    res.statusCode = 200;
    res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(fs.readFileSync(filePath));
    return;
  }

  const memberMatch = pathname.match(/^\/api\/messenger\/groups\/([^/]+)\/members\/([^/]+)$/);
  if (memberMatch && method === "DELETE") {
    const members = removeMember(
      queryPersonId,
      decodeURIComponent(memberMatch[1]),
      decodeURIComponent(memberMatch[2]),
    );
    sendJson(res, 200, { members });
    return;
  }

  const membersMatch = pathname.match(/^\/api\/messenger\/groups\/([^/]+)\/members$/);
  if (membersMatch && method === "POST") {
    const body = await readJson(req);
    const groupId = decodeURIComponent(membersMatch[1]);
    const result = addMemberByName(personFrom({ personId: queryPersonId }, body), groupId, asString(body.name));
    sendJson(res, 200, result);
    return;
  }

  const messagesMatch = pathname.match(/^\/api\/messenger\/groups\/([^/]+)\/messages$/);
  if (messagesMatch && method === "POST") {
    const body = await readJson(req);
    const kind = body.kind === "photo" ? "photo" : "text";
    const message = sendMessage({
      groupId: decodeURIComponent(messagesMatch[1]),
      senderId: asString(body.personId),
      kind,
      text: asString(body.text),
      photoDataUrl: asString(body.photoDataUrl),
    });
    sendJson(res, 200, { message });
    return;
  }

  const readMatch = pathname.match(/^\/api\/messenger\/groups\/([^/]+)\/read$/);
  if (readMatch && method === "POST") {
    const body = await readJson(req);
    markRead(decodeURIComponent(readMatch[1]), personFrom({ personId: queryPersonId }, body));
    sendJson(res, 200, { ok: true });
    return;
  }

  const muteMatch = pathname.match(/^\/api\/messenger\/groups\/([^/]+)\/mute$/);
  if (muteMatch && method === "POST") {
    const body = await readJson(req);
    const muted = setMuted(
      decodeURIComponent(muteMatch[1]),
      personFrom({ personId: queryPersonId }, body),
      body.muted === true,
    );
    sendJson(res, 200, { muted });
    return;
  }

  const groupMatch = pathname.match(/^\/api\/messenger\/groups\/([^/]+)$/);
  if (groupMatch && method === "GET") {
    sendJson(res, 200, getGroup(decodeURIComponent(groupMatch[1]), queryPersonId));
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

export function messengerApiPlugin(): Plugin {
  return {
    name: "kiddai-messenger-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void route(req, res, next).catch((error: unknown) => {
          if (res.headersSent) {
            return;
          }
          const status = error instanceof HttpError ? error.status : 500;
          if (!(error instanceof HttpError)) {
            console.error(error);
          }
          sendJson(res, status, {
            error: error instanceof Error ? error.message : "Messenger failed.",
          });
        });
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void route(req, res, next).catch((error: unknown) => {
          if (res.headersSent) {
            return;
          }
          const status = error instanceof HttpError ? error.status : 500;
          if (!(error instanceof HttpError)) {
            console.error(error);
          }
          sendJson(res, status, {
            error: error instanceof Error ? error.message : "Messenger failed.",
          });
        });
      });
    },
  };
}
