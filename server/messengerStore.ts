import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(rootDir, "data");
const mediaDir = path.join(dataDir, "messenger-media");
const dbPath = path.join(dataDir, "messenger.sqlite");

const dbGlobal = globalThis as typeof globalThis & { __kiddaiMessengerDb?: DatabaseSync };

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type PersonRole = "admin" | "installer";

export type Person = {
  id: string;
  name: string;
  role: PersonRole;
  groupNames: string[];
};

export type InboxGroup = {
  id: string;
  name: string;
  queueNumber: string | null;
  muted: boolean;
  unread: boolean;
  preview: string;
  lastActivityAt: string;
  memberCount: number;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  kind: "text" | "photo";
  text: string | null;
  photoUrl: string | null;
  createdAt: string;
};

export type GroupDetail = {
  group: InboxGroup;
  members: Person[];
  messages: ChatMessage[];
};

type Row = Record<string, unknown>;

function cell(row: Row, key: string): string {
  const value = row[key];
  if (value == null) {
    return "";
  }
  return String(value);
}

function now(): string {
  return new Date().toISOString();
}

function changesOf(result: { changes: number | bigint }): number {
  return Number(result.changes);
}

function getDb(): DatabaseSync {
  if (!dbGlobal.__kiddaiMessengerDb) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(mediaDir, { recursive: true });
    const opened = new DatabaseSync(dbPath);
    opened.exec("PRAGMA journal_mode = WAL");
    opened.exec("PRAGMA foreign_keys = ON");
    opened.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'installer')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      queue_number TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      group_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      muted INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT,
      PRIMARY KEY (group_id, person_id),
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (person_id) REFERENCES people(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('text', 'photo')),
      body TEXT,
      media_name TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (sender_id) REFERENCES people(id)
    );

    CREATE INDEX IF NOT EXISTS messages_group_created ON messages (group_id, created_at);
  `);
    dbGlobal.__kiddaiMessengerDb = opened;
  }

  const db = dbGlobal.__kiddaiMessengerDb;
  ensureQueueColumn(db);
  ensureSeed(db);
  return db;
}

function ensureQueueColumn(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(groups)").all() as Row[];
  const hasQueue = columns.some((column) => cell(column, "name") === "queue_number");
  if (!hasQueue) {
    db.exec("ALTER TABLE groups ADD COLUMN queue_number TEXT");
    db.prepare(
      "UPDATE groups SET queue_number = '2412' WHERE name = 'KIDDAI 1' AND (queue_number IS NULL OR queue_number = '')",
    ).run();
  }
}

function ensureSeed(db: DatabaseSync): void {
  const count = db.prepare("SELECT COUNT(*) AS total FROM people").get() as Row | undefined;
  if (Number(cell(count ?? {}, "total")) > 0) {
    return;
  }

  const createdAt = now();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO people (id, name, role, created_at) VALUES (?, ?, ?, ?)").run(
      "person-admin",
      "Admin",
      "admin",
      createdAt,
    );
    db.prepare("INSERT INTO people (id, name, role, created_at) VALUES (?, ?, ?, ?)").run(
      "person-installer-1",
      "Installer 1",
      "installer",
      createdAt,
    );
    db.prepare("INSERT INTO groups (id, name, queue_number, created_at) VALUES (?, ?, ?, ?)").run(
      "group-kiddai-1",
      "KIDDAI 1",
      "2412",
      createdAt,
    );
    db.prepare(
      "INSERT INTO memberships (group_id, person_id, muted, last_read_at) VALUES (?, ?, ?, ?)",
    ).run("group-kiddai-1", "person-admin", 0, createdAt);
    db.prepare(
      "INSERT INTO memberships (group_id, person_id, muted, last_read_at) VALUES (?, ?, ?, ?)",
    ).run("group-kiddai-1", "person-installer-1", 1, null);
    db.prepare(
      "INSERT INTO messages (id, group_id, sender_id, kind, body, media_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "message-seed-1",
      "group-kiddai-1",
      "person-admin",
      "text",
      "คิว 2412 ติดตั้งพรุ่งนี้ 8:00",
      null,
      createdAt,
    );
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* The transaction may already be closed. */
    }
    throw error;
  }
}

function requirePerson(personId: string): { id: string; name: string; role: PersonRole } {
  const row = getDb().prepare("SELECT id, name, role FROM people WHERE id = ?").get(personId) as
    | Row
    | undefined;
  if (!row) {
    throw new HttpError(401, "Choose a person.");
  }
  const role = cell(row, "role");
  if (role !== "admin" && role !== "installer") {
    throw new HttpError(500, "A person has an unknown role.");
  }
  return { id: cell(row, "id"), name: cell(row, "name"), role };
}

function requireAdmin(personId: string): { id: string; name: string; role: PersonRole } {
  const person = requirePerson(personId);
  if (person.role !== "admin") {
    throw new HttpError(403, "Only an admin can do that.");
  }
  return person;
}

function groupNamesFor(personId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT g.name AS name
       FROM memberships m
       JOIN groups g ON g.id = m.group_id
       WHERE m.person_id = ?
       ORDER BY g.created_at ASC`,
    )
    .all(personId) as Row[];
  return rows.map((row) => cell(row, "name"));
}

function toPerson(id: string, name: string, role: PersonRole, withGroups: boolean): Person {
  return {
    id,
    name,
    role,
    groupNames: withGroups ? groupNamesFor(id) : [],
  };
}

export function listPeople(): Person[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, role
       FROM people
       ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at ASC`,
    )
    .all() as Row[];
  return rows.map((row) => {
    const role = cell(row, "role") === "admin" ? "admin" : "installer";
    return toPerson(cell(row, "id"), cell(row, "name"), role, true);
  });
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new HttpError(400, "Enter a name.");
  }
  if (trimmed.length > 40) {
    throw new HttpError(400, "Name is too long.");
  }
  return trimmed;
}

function findPersonByName(name: string): Row | undefined {
  return getDb().prepare("SELECT id, name, role FROM people WHERE name = ?").get(name) as
    | Row
    | undefined;
}

export function createPerson(actorId: string, name: string): Person {
  requireAdmin(actorId);
  const trimmed = assertName(name);
  if (findPersonByName(trimmed)) {
    throw new HttpError(409, "That name is already used.");
  }
  const id = crypto.randomUUID();
  getDb()
    .prepare("INSERT INTO people (id, name, role, created_at) VALUES (?, ?, 'installer', ?)")
    .run(id, trimmed, now());
  return toPerson(id, trimmed, "installer", true);
}

export function renamePerson(actorId: string, targetId: string, name: string): Person {
  requireAdmin(actorId);
  const trimmed = assertName(name);
  const current = requirePerson(targetId);
  const existing = findPersonByName(trimmed);
  if (existing && cell(existing, "id") !== current.id) {
    throw new HttpError(409, "That name is already used.");
  }
  getDb().prepare("UPDATE people SET name = ? WHERE id = ?").run(trimmed, current.id);
  return toPerson(current.id, trimmed, current.role, true);
}

function requireGroup(groupId: string): { id: string; name: string; queueNumber: string | null; createdAt: string } {
  const row = getDb()
    .prepare("SELECT id, name, queue_number, created_at FROM groups WHERE id = ?")
    .get(groupId) as Row | undefined;
  if (!row) {
    throw new HttpError(404, "That group was not found.");
  }
  const queueNumber = cell(row, "queue_number");
  return {
    id: cell(row, "id"),
    name: cell(row, "name"),
    queueNumber: queueNumber || null,
    createdAt: cell(row, "created_at"),
  };
}

function membershipOf(groupId: string, personId: string): { muted: boolean; lastReadAt: string | null } | null {
  const row = getDb()
    .prepare("SELECT muted, last_read_at FROM memberships WHERE group_id = ? AND person_id = ?")
    .get(groupId, personId) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    muted: Number(cell(row, "muted")) === 1,
    lastReadAt: cell(row, "last_read_at") || null,
  };
}

function assertCanAccess(person: { id: string; role: PersonRole }, groupId: string): void {
  requireGroup(groupId);
  if (person.role === "admin") {
    return;
  }
  if (!membershipOf(groupId, person.id)) {
    throw new HttpError(403, "You are not in this group.");
  }
}

function lastMessage(groupId: string): Row | undefined {
  return getDb()
    .prepare(
      `SELECT kind, body, sender_id, created_at
       FROM messages
       WHERE group_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(groupId) as Row | undefined;
}

function previewText(kind: string, body: string): string {
  if (kind === "photo") {
    return "รูปภาพ";
  }
  return body.replace(/\s+/g, " ").trim();
}

function groupSummary(groupId: string, viewerId: string): InboxGroup {
  const group = requireGroup(groupId);
  const viewer = requirePerson(viewerId);
  const last = lastMessage(groupId);
  const membership = membershipOf(groupId, viewer.id);
  const countRow = getDb()
    .prepare("SELECT COUNT(*) AS member_count FROM memberships WHERE group_id = ?")
    .get(groupId) as Row;
  const latestAt = last ? cell(last, "created_at") : group.createdAt;
  const senderId = last ? cell(last, "sender_id") : "";
  const lastReadAt = membership?.lastReadAt ?? null;
  const unread = Boolean(last) && senderId !== viewer.id && (!lastReadAt || cell(last ?? {}, "created_at") > lastReadAt);

  return {
    id: group.id,
    name: group.name,
    queueNumber: group.queueNumber,
    muted: membership?.muted ?? false,
    unread,
    preview: last ? previewText(cell(last, "kind"), cell(last, "body")) : "No messages yet",
    lastActivityAt: latestAt,
    memberCount: Number(cell(countRow, "member_count")),
  };
}

export function listInbox(personId: string): InboxGroup[] {
  const viewer = requirePerson(personId);
  const rows =
    viewer.role === "admin"
      ? (getDb().prepare("SELECT id FROM groups").all() as Row[])
      : (getDb().prepare("SELECT group_id AS id FROM memberships WHERE person_id = ?").all(viewer.id) as Row[]);

  return rows
    .map((row) => groupSummary(cell(row, "id"), viewer.id))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

function listMembers(groupId: string): Person[] {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.name, p.role
       FROM memberships m
       JOIN people p ON p.id = m.person_id
       WHERE m.group_id = ?
       ORDER BY CASE p.role WHEN 'admin' THEN 0 ELSE 1 END, p.created_at ASC`,
    )
    .all(groupId) as Row[];
  return rows.map((row) =>
    toPerson(cell(row, "id"), cell(row, "name"), cell(row, "role") === "admin" ? "admin" : "installer", false),
  );
}

function toChatMessage(row: Row): ChatMessage {
  const kind = cell(row, "kind") === "photo" ? "photo" : "text";
  const mediaName = cell(row, "media_name");
  return {
    id: cell(row, "id"),
    senderId: cell(row, "sender_id"),
    senderName: cell(row, "sender_name"),
    kind,
    text: kind === "text" ? cell(row, "body") : null,
    photoUrl: mediaName ? `/api/messenger/media/${mediaName}` : null,
    createdAt: cell(row, "created_at"),
  };
}

export function getGroup(groupId: string, personId: string): GroupDetail {
  const viewer = requirePerson(personId);
  assertCanAccess(viewer, groupId);
  const messages = getDb()
    .prepare(
      `SELECT m.id, m.sender_id, p.name AS sender_name, m.kind, m.body, m.media_name, m.created_at
       FROM messages m
       JOIN people p ON p.id = m.sender_id
       WHERE m.group_id = ?
       ORDER BY m.created_at ASC, m.rowid ASC`,
    )
    .all(groupId) as Row[];
  return {
    group: groupSummary(groupId, viewer.id),
    members: listMembers(groupId),
    messages: messages.map(toChatMessage),
  };
}

function nextGroupName(db: DatabaseSync): string {
  const rows = db.prepare("SELECT name FROM groups").all() as Row[];
  let max = 0;
  for (const row of rows) {
    const match = /^KIDDAI (\d+)$/.exec(cell(row, "name"));
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `KIDDAI ${max + 1}`;
}

export function createGroup(actorId: string): InboxGroup {
  const admin = requireAdmin(actorId);
  const db = getDb();
  const id = crypto.randomUUID();
  db.exec("BEGIN");
  try {
    const name = nextGroupName(db);
    db.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run(id, name, now());
    const admins = db.prepare("SELECT id FROM people WHERE role = 'admin'").all() as Row[];
    const insert = db.prepare(
      "INSERT INTO memberships (group_id, person_id, muted, last_read_at) VALUES (?, ?, 0, NULL)",
    );
    for (const row of admins) {
      insert.run(id, cell(row, "id"));
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* The transaction may already be closed. */
    }
    throw error;
  }
  return groupSummary(id, admin.id);
}

function assertQueueNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d{1,6}$/.test(trimmed)) {
    throw new HttpError(400, "Enter the queue number from the worksheet.");
  }
  return trimmed;
}

export function setQueueNumber(actorId: string, groupId: string, queueNumber: string): InboxGroup {
  const admin = requireAdmin(actorId);
  requireGroup(groupId);
  const next = assertQueueNumber(queueNumber);
  if (next) {
    const taken = getDb()
      .prepare("SELECT id FROM groups WHERE queue_number = ? AND id != ?")
      .get(next, groupId) as Row | undefined;
    if (taken) {
      throw new HttpError(409, "That queue number is already on another group.");
    }
  }
  getDb().prepare("UPDATE groups SET queue_number = ? WHERE id = ?").run(next, groupId);
  return groupSummary(groupId, admin.id);
}

export function addMemberByName(
  actorId: string,
  groupId: string,
  name: string,
): { created: boolean; alreadyMember: boolean; members: Person[] } {
  requireAdmin(actorId);
  requireGroup(groupId);
  const trimmed = assertName(name);
  const db = getDb();
  db.exec("BEGIN");
  try {
    let existing = findPersonByName(trimmed);
    let created = false;
    if (!existing) {
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO people (id, name, role, created_at) VALUES (?, ?, 'installer', ?)").run(
        id,
        trimmed,
        now(),
      );
      existing = findPersonByName(trimmed);
      created = true;
    }
    if (!existing) {
      throw new HttpError(500, "Could not save that person.");
    }
    const personId = cell(existing, "id");
    const already = membershipOf(groupId, personId);
    if (!already) {
      db.prepare(
        "INSERT INTO memberships (group_id, person_id, muted, last_read_at) VALUES (?, ?, 0, NULL)",
      ).run(groupId, personId);
    }
    db.exec("COMMIT");
    return {
      created,
      alreadyMember: Boolean(already),
      members: listMembers(groupId),
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* The transaction may already be closed. */
    }
    throw error;
  }
}

export function removeMember(actorId: string, groupId: string, memberId: string): Person[] {
  requireAdmin(actorId);
  requireGroup(groupId);
  const member = requirePerson(memberId);
  if (member.role === "admin") {
    throw new HttpError(400, "Admins stay available in every installation group.");
  }
  const result = getDb()
    .prepare("DELETE FROM memberships WHERE group_id = ? AND person_id = ?")
    .run(groupId, member.id);
  if (changesOf(result) === 0) {
    throw new HttpError(404, "That person is not in this group.");
  }
  return listMembers(groupId);
}

function savePhoto(dataUrl: string): string {
  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) {
    throw new HttpError(400, "Use a PNG, JPEG, WebP, or GIF photo.");
  }
  const rawExt = match[1].toLowerCase();
  const ext = rawExt === "jpeg" ? "jpg" : rawExt;
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length === 0) {
    throw new HttpError(400, "That photo is empty.");
  }
  if (buffer.length > 4_000_000) {
    throw new HttpError(413, "Photo is too large.");
  }
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(mediaDir, filename), buffer);
  return filename;
}

export function sendMessage(input: {
  groupId: string;
  senderId: string;
  kind: "text" | "photo";
  text?: string;
  photoDataUrl?: string;
}): ChatMessage {
  const sender = requirePerson(input.senderId);
  assertCanAccess(sender, input.groupId);
  const id = crypto.randomUUID();
  const createdAt = now();
  let body: string | null = null;
  let mediaName: string | null = null;

  if (input.kind === "text") {
    body = (input.text ?? "").trim();
    if (!body) {
      throw new HttpError(400, "Enter a message.");
    }
    if (body.length > 2000) {
      throw new HttpError(400, "Message is too long.");
    }
  } else {
    if (!input.photoDataUrl) {
      throw new HttpError(400, "Choose a photo.");
    }
    mediaName = savePhoto(input.photoDataUrl);
  }

  getDb()
    .prepare(
      "INSERT INTO messages (id, group_id, sender_id, kind, body, media_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, input.groupId, sender.id, input.kind, body, mediaName, createdAt);

  return {
    id,
    senderId: sender.id,
    senderName: sender.name,
    kind: input.kind,
    text: body,
    photoUrl: mediaName ? `/api/messenger/media/${mediaName}` : null,
    createdAt,
  };
}

export function markRead(groupId: string, personId: string): void {
  const viewer = requirePerson(personId);
  assertCanAccess(viewer, groupId);
  const readAt = now();
  const result = getDb()
    .prepare("UPDATE memberships SET last_read_at = ? WHERE group_id = ? AND person_id = ?")
    .run(readAt, groupId, viewer.id);
  if (changesOf(result) === 0 && viewer.role === "admin") {
    getDb()
      .prepare("INSERT INTO memberships (group_id, person_id, muted, last_read_at) VALUES (?, ?, 0, ?)")
      .run(groupId, viewer.id, readAt);
  }
}

export function setMuted(groupId: string, personId: string, muted: boolean): boolean {
  const viewer = requirePerson(personId);
  assertCanAccess(viewer, groupId);
  const flag = muted ? 1 : 0;
  const result = getDb()
    .prepare("UPDATE memberships SET muted = ? WHERE group_id = ? AND person_id = ?")
    .run(flag, groupId, viewer.id);
  if (changesOf(result) === 0) {
    if (viewer.role !== "admin") {
      throw new HttpError(403, "You are not in this group.");
    }
    getDb()
      .prepare("INSERT INTO memberships (group_id, person_id, muted, last_read_at) VALUES (?, ?, ?, NULL)")
      .run(groupId, viewer.id, flag);
  }
  return muted;
}

export function resolveMedia(filename: string): string | null {
  if (!/^[\w.-]+$/.test(filename)) {
    return null;
  }
  const root = path.resolve(mediaDir);
  const full = path.resolve(root, filename);
  if (!full.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  if (!fs.existsSync(full)) {
    return null;
  }
  return full;
}
