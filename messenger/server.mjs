import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const mediaDir = path.join(dataDir, "media");
const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || "0.0.0.0";

const MEDIA = {
  "image/jpeg": { ext: ".jpg", kind: "image" },
  "image/png": { ext: ".png", kind: "image" },
  "image/webp": { ext: ".webp", kind: "image" },
  "image/gif": { ext: ".gif", kind: "image" },
  "video/mp4": { ext: ".mp4", kind: "video" },
  "video/webm": { ext: ".webm", kind: "video" },
  "video/quicktime": { ext: ".mov", kind: "video" },
};

fs.mkdirSync(mediaDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "kiddai.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 3000");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'installer')),
    display_name TEXT NOT NULL,
    active_project_id INTEGER REFERENCES projects(id),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT,
    media_file TEXT,
    media_type TEXT,
    media_name TEXT,
    created_at TEXT NOT NULL,
    CHECK (body IS NOT NULL OR media_file IS NOT NULL)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS messages_project ON messages (project_id, id);
`);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(actual, expected);
}

const DUMMY_HASH = hashPassword("not-a-real-password");

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;

  const hour = 60 * 60 * 1000;
  const adminPassword = process.env.ADMIN_PASSWORD || "kiddai-admin";
  const installerPasswords = [
    process.env.INSTALLER1_PASSWORD || "install-1",
    process.env.INSTALLER2_PASSWORD || "install-2",
    process.env.INSTALLER3_PASSWORD || "install-3",
  ];

  const insertProject = db.prepare("INSERT INTO projects (name, created_at) VALUES (?, ?)");
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role, display_name, active_project_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (project_id, user_id, body, created_at)
    VALUES (?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    const bangna = Number(insertProject.run("Bangna kitchen", iso(-6 * hour)).lastInsertRowid);
    const chiangMai = Number(insertProject.run("Chiang Mai wardrobe", iso(-6 * hour)).lastInsertRowid);
    const adminId = Number(
      insertUser.run("admin", hashPassword(adminPassword), "admin", "Admin", null, iso(-6 * hour)).lastInsertRowid,
    );
    const installer1 = Number(
      insertUser.run("installer1", hashPassword(installerPasswords[0]), "installer", "Installer 1", bangna, iso(-6 * hour))
        .lastInsertRowid,
    );
    const installer2 = Number(
      insertUser.run("installer2", hashPassword(installerPasswords[1]), "installer", "Installer 2", chiangMai, iso(-6 * hour))
        .lastInsertRowid,
    );
    insertUser.run("installer3", hashPassword(installerPasswords[2]), "installer", "Installer 3", null, iso(-6 * hour));

    insertMessage.run(
      bangna,
      adminId,
      "Galley kitchen on the 4th floor. White oak doors. Measure the left wall before you fix anything. Drawing says 3200mm.",
      iso(-3 * hour),
    );
    insertMessage.run(bangna, installer1, "On site. Left wall is 3180mm, not 3200.", iso(-2 * hour));
    insertMessage.run(bangna, adminId, "Use 3180. Send a photo of the corner when the base cabinets are in.", iso(-1 * hour));

    insertMessage.run(
      chiangMai,
      adminId,
      "Master bedroom wardrobe. Hinges go on the window wall. Customer is home after 10:00.",
      iso(-5 * hour),
    );
    insertMessage.run(chiangMai, installer2, "Floor drops about 8mm toward the window. I will pack the base.", iso(-4 * hour));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  console.log("Seeded demo projects and installers");
}

seed();

const cutoff = iso(-14 * 24 * 60 * 60 * 1000);
db.prepare("DELETE FROM sessions WHERE created_at < ?").run(cutoff);

function loadUserById(id) {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.active_project_id, p.name AS active_project_name
    FROM users u
    LEFT JOIN projects p ON p.id = u.active_project_id
    WHERE u.id = ?
  `).get(id);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    activeProjectId: row.active_project_id,
    activeProjectName: row.active_project_name || null,
  };
}

function userFromRequest(req) {
  const header = req.headers.cookie || "";
  let token = null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === "sid") token = decodeURIComponent(rest.join("="));
  }
  if (!token) return null;
  const session = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token);
  if (!session) return null;
  const user = loadUserById(session.user_id);
  return user ? publicUser(user) : null;
}

function requireUser(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: "Sign in required" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

function idParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function listProjects() {
  const projects = db.prepare("SELECT id, name, created_at FROM projects ORDER BY id").all();
  const people = db.prepare(`
    SELECT active_project_id, display_name
    FROM users
    WHERE role = 'installer' AND active_project_id IS NOT NULL
    ORDER BY id
  `).all();
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    createdAt: project.created_at,
    installers: people
      .filter((person) => person.active_project_id === project.id)
      .map((person) => person.display_name),
  }));
}

function listInstallers() {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.active_project_id, p.name AS active_project_name
    FROM users u
    LEFT JOIN projects p ON p.id = u.active_project_id
    WHERE u.role = 'installer'
    ORDER BY u.id
  `).all().map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    activeProjectId: row.active_project_id,
    activeProjectName: row.active_project_name || null,
  }));
}

function listMessages(projectId, viewerId) {
  return db.prepare(`
    SELECT m.id, m.body, m.media_file, m.media_type, m.media_name, m.created_at, m.user_id,
           u.display_name, u.role
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ?
    ORDER BY m.id ASC
  `).all(projectId).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    authorName: row.display_name,
    authorRole: row.role,
    mine: row.user_id === viewerId,
    mediaUrl: row.media_file ? `/api/media/${row.media_file}` : null,
    mediaType: row.media_type,
    mediaName: row.media_name,
  }));
}

function cleanName(name) {
  const base = path.basename(name || "file").replace(/[^\w.\- ()]+/g, "").slice(0, 80);
  return base || "file";
}

function insertMessage(projectId, user, rawBody, file) {
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) throw httpError(404, "Project not found");
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  if (body.length > 4000) throw httpError(400, "Message is too long");
  if (!body && !file) throw httpError(400, "Write a message or attach a file");
  const kind = file ? MEDIA[file.mimetype]?.kind : null;
  if (file && !kind) throw httpError(400, "Use a JPG, PNG, WEBP, GIF, or MP4");
  if (file && user.role === "installer" && kind !== "image") throw httpError(400, "Photos only");

  const info = db.prepare(`
    INSERT INTO messages (project_id, user_id, body, media_file, media_type, media_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId,
    user.id,
    body || null,
    file ? file.filename : null,
    kind,
    file ? cleanName(file.originalname) : null,
    iso(),
  );
  const messages = listMessages(projectId, user.id);
  return messages.find((message) => message.id === Number(info.lastInsertRowid));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaDir),
    filename: (_req, file, cb) => {
      const spec = MEDIA[file.mimetype];
      cb(null, `${randomUUID()}${spec ? spec.ext : ""}`);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const spec = MEDIA[file.mimetype];
    if (!spec) return cb(new Error("Use a JPG, PNG, WEBP, GIF, or an MP4 video"));
    if (req.user?.role === "installer" && spec.kind !== "image") return cb(new Error("Photos only"));
    cb(null, true);
  },
});

function withFile(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    const message = error.code === "LIMIT_FILE_SIZE" ? "File is too large (max 80 MB)" : error.message;
    res.status(400).json({ error: message || "Upload failed" });
  });
}

function discardUpload(req) {
  if (req.file?.path) fs.unlink(req.file.path, () => {});
}

function sendError(res, error) {
  if (!error.status) console.error(error);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "Something went wrong",
  });
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", [
    `sid=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${60 * 60 * 24 * 14}`,
  ].join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  next();
});
app.use(express.json({ limit: "100kb" }));

app.post("/api/login", (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const row = db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(username);
  const ok = verifyPassword(password, row?.password_hash || DUMMY_HASH) && row;
  if (!ok) return res.status(401).json({ error: "Wrong username or password" });
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, row.id, iso());
  setSessionCookie(res, token);
  res.json({ user: publicUser(loadUserById(row.id)) });
});

app.post("/api/logout", (req, res) => {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === "sid") {
      db.prepare("DELETE FROM sessions WHERE token = ?").run(decodeURIComponent(rest.join("=")));
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", requireUser, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/projects", requireUser, requireAdmin, (_req, res) => {
  res.json({ projects: listProjects() });
});

app.post("/api/projects", requireUser, requireAdmin, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 80) return res.status(400).json({ error: "Enter a project name" });
  const info = db.prepare("INSERT INTO projects (name, created_at) VALUES (?, ?)").run(name, iso());
  const project = listProjects().find((item) => item.id === Number(info.lastInsertRowid));
  res.status(201).json({ project });
});

app.get("/api/projects/:id/messages", requireUser, requireAdmin, (req, res) => {
  const id = idParam(req.params.id);
  if (!id || !db.prepare("SELECT id FROM projects WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Project not found" });
  }
  res.json({ messages: listMessages(id, req.user.id) });
});

app.post("/api/projects/:id/messages", requireUser, requireAdmin, withFile, (req, res) => {
  try {
    const id = idParam(req.params.id);
    if (!id) throw httpError(404, "Project not found");
    const message = insertMessage(id, req.user, req.body?.body, req.file);
    res.status(201).json({ message });
  } catch (error) {
    discardUpload(req);
    sendError(res, error);
  }
});

app.get("/api/installers", requireUser, requireAdmin, (_req, res) => {
  res.json({ installers: listInstallers() });
});

app.patch("/api/installers/:id", requireUser, requireAdmin, (req, res) => {
  try {
    const id = idParam(req.params.id);
    const existing = id
      ? db.prepare("SELECT id, role, username FROM users WHERE id = ?").get(id)
      : null;
    if (!existing || existing.role !== "installer") throw httpError(404, "Installer not found");

    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, "displayName");
    const hasProject = Object.prototype.hasOwnProperty.call(req.body || {}, "projectId");
    if (!hasName && !hasProject) throw httpError(400, "Nothing to change");

    if (hasName) {
      const displayName = String(req.body.displayName || "").trim().replace(/\s+/g, " ");
      if (!displayName || displayName.length > 40) throw httpError(400, "Enter a name up to 40 characters");
      const clash = db.prepare(
        "SELECT id FROM users WHERE lower(display_name) = lower(?) AND id != ?",
      ).get(displayName, id);
      if (clash) throw httpError(400, "That name is already used");
      db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, id);
    }

    let already = false;
    if (hasProject) {
      const projectId = idParam(req.body.projectId);
      if (!projectId || !db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId)) {
        throw httpError(400, "Pick a project");
      }
      const current = db.prepare("SELECT active_project_id FROM users WHERE id = ?").get(id);
      already = current.active_project_id === projectId;
      if (!already) db.prepare("UPDATE users SET active_project_id = ? WHERE id = ?").run(projectId, id);
    }

    const installer = listInstallers().find((person) => person.id === id);
    res.json({ installer, already });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/chat", requireUser, (req, res) => {
  if (req.user.role !== "installer") return res.status(403).json({ error: "Installers only" });
  if (!req.user.activeProjectId) return res.json({ project: null, messages: [] });
  res.json({
    project: { id: req.user.activeProjectId, name: req.user.activeProjectName },
    messages: listMessages(req.user.activeProjectId, req.user.id),
  });
});

app.post("/api/chat/messages", requireUser, withFile, (req, res) => {
  try {
    if (req.user.role !== "installer") throw httpError(403, "Installers only");
    if (!req.user.activeProjectId) throw httpError(400, "No job yet");
    const message = insertMessage(req.user.activeProjectId, req.user, req.body?.body, req.file);
    res.status(201).json({ message });
  } catch (error) {
    discardUpload(req);
    sendError(res, error);
  }
});

app.get("/api/media/:file", requireUser, (req, res) => {
  const file = req.params.file;
  if (!/^[\w-]+\.(jpg|png|webp|gif|mp4|webm|mov)$/.test(file)) {
    return res.status(404).json({ error: "Not found" });
  }
  const message = db.prepare("SELECT project_id FROM messages WHERE media_file = ?").get(file);
  if (!message) return res.status(404).json({ error: "Not found" });
  const allowed = req.user.role === "admin" || req.user.activeProjectId === message.project_id;
  if (!allowed) return res.status(404).json({ error: "Not found" });
  res.set("Cache-Control", "private, max-age=3600");
  res.sendFile(path.join(mediaDir, file));
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(express.static(publicDir, { index: "index.html", maxAge: 0, etag: false }));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Kiddai Install listening on http://localhost:${port}`);
});
