import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MEDIA = {
  "image/jpeg": { ext: ".jpg", kind: "image" },
  "image/jpg": { ext: ".jpg", kind: "image" },
  "image/png": { ext: ".png", kind: "image" },
  "image/webp": { ext: ".webp", kind: "image" },
  "image/gif": { ext: ".gif", kind: "image" },
  "video/mp4": { ext: ".mp4", kind: "video" },
  "video/webm": { ext: ".webm", kind: "video" },
  "video/quicktime": { ext: ".mov", kind: "video" },
  "application/pdf": { ext: ".pdf", kind: "file" },
};

const BODY_LIMIT = 4000;
const FILE_LIMIT = 80 * 1024 * 1024;
const DEPARTMENTS = new Set([
  "ประเมิน",
  "วัด",
  "Selling Stage",
  "Deposit Stage",
  "Draftman",
  "Confirm",
  "จัดซื้อ",
  "สโตร์",
  "ตัดไม้",
  "ประกอบ",
  "แก้",
  "CNC",
  "Admin",
]);

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

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function previewFor(body, kind) {
  const text = String(body ?? "").trim();
  if (text) return text.length > 90 ? `${text.slice(0, 89)}…` : text;
  if (kind === "image") return "Photo";
  if (kind === "video") return "Video";
  return "";
}

export function createCompanyApi() {
  const dataDir = process.env.COMPANY_DATA_DIR
    ? path.resolve(process.env.COMPANY_DATA_DIR)
    : path.join(__dirname, "data");
  const mediaDir = path.join(dataDir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });

  const db = new DatabaseSync(path.join(dataDir, "company.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 3000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id),
      role_id INTEGER NOT NULL REFERENCES roles(id),
      PRIMARY KEY (user_id, role_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY,
      job_ref TEXT NOT NULL,
      ref_kind TEXT NOT NULL CHECK (ref_kind IN ('estimate', 'queue')),
      customer_name TEXT NOT NULL,
      designer_name TEXT,
      stage TEXT NOT NULL,
      install_date TEXT,
      deadline TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS job_stage_history (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      stage TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS job_remakes (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS chat_groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('group', 'community')),
      job_id INTEGER REFERENCES jobs(id),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS chat_group_members (
      group_id INTEGER NOT NULL REFERENCES chat_groups(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (group_id, user_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES chat_groups(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS message_attachments (
      id INTEGER PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES messages(id),
      file_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      media_type TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id INTEGER NOT NULL REFERENCES messages(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      read_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      target TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS messages_group ON messages (group_id, id);
    CREATE INDEX IF NOT EXISTS attachments_message ON message_attachments (message_id);
  `);

  const messageColumns = db.prepare("PRAGMA table_info(messages)").all().map((column) => column.name);
  if (!messageColumns.includes("department")) db.exec("ALTER TABLE messages ADD COLUMN department TEXT");
  if (!messageColumns.includes("reply_to")) db.exec("ALTER TABLE messages ADD COLUMN reply_to INTEGER");
  if (!messageColumns.includes("pinned")) db.exec("ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  if (!messageColumns.includes("kind")) db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'message'");
  if (!messageColumns.includes("extra")) db.exec("ALTER TABLE messages ADD COLUMN extra TEXT");

  const attachmentSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'message_attachments'").get()?.sql ?? "";
  if (attachmentSql && !attachmentSql.includes("'file'")) {
    db.exec(`
      CREATE TABLE message_attachments_next (
        id INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id),
        file_name TEXT NOT NULL,
        stored_name TEXT NOT NULL UNIQUE,
        media_type TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'file')),
        created_at TEXT NOT NULL
      );
      INSERT INTO message_attachments_next (id, message_id, file_name, stored_name, media_type, kind, created_at)
      SELECT id, message_id, file_name, stored_name, media_type, kind, created_at FROM message_attachments;
      DROP TABLE message_attachments;
      ALTER TABLE message_attachments_next RENAME TO message_attachments;
      CREATE INDEX IF NOT EXISTS attachments_message ON message_attachments (message_id);
    `);
  }

  db.prepare("UPDATE chat_groups SET name = ? WHERE name = ?").run("5310 · Niran Chai", "KIDDAI 1");

  const dummyHash = hashPassword("not-a-real-password");

  function audit(userId, action, target) {
    db.prepare(
      "INSERT INTO audit_logs (user_id, action, target, created_at) VALUES (?, ?, ?, ?)",
    ).run(userId, action, target ?? null, iso());
  }

  function rolesFor(userId) {
    return db
      .prepare(
        `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ?
         ORDER BY r.name`,
      )
      .all(userId)
      .map((row) => row.name);
  }

  function publicUser(row) {
    const roles = rolesFor(row.id);
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      roles,
      role: roles[0] ?? "member",
    };
  }

  function hasRole(user, role) {
    return user.roles.includes(role);
  }

  function loadGroup(groupId) {
    return db
      .prepare(
        `SELECT g.id, g.name, g.kind, g.job_id, g.created_at,
                j.job_ref, j.ref_kind, j.customer_name, j.designer_name, j.stage,
                j.install_date, j.deadline, j.notes
         FROM chat_groups g
         LEFT JOIN jobs j ON j.id = g.job_id
         WHERE g.id = ?`,
      )
      .get(groupId);
  }

  function assertGroup(user, groupId) {
    const group = loadGroup(groupId);
    if (!group) throw httpError(404, "That group does not exist.");
    if (hasRole(user, "admin")) return group;
    const member = db
      .prepare("SELECT 1 AS ok FROM chat_group_members WHERE group_id = ? AND user_id = ?")
      .get(groupId, user.id);
    if (!member) throw httpError(403, "You are not in this group.");
    return group;
  }

  function membersOf(groupId) {
    return db
      .prepare(
        `SELECT u.id, u.display_name,
                (SELECT r.name
                 FROM user_roles ur
                 JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id
                 ORDER BY r.name
                 LIMIT 1) AS role
         FROM chat_group_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ?
         ORDER BY u.display_name`,
      )
      .all(groupId)
      .map((row) => ({
        id: row.id,
        displayName: row.display_name,
        role: row.role ?? "member",
      }));
  }

  function jobPayload(group) {
    if (!group.job_id) return null;
    const history = db
      .prepare(
        `SELECT stage, note, created_at
         FROM job_stage_history
         WHERE job_id = ?
         ORDER BY id`,
      )
      .all(group.job_id)
      .map((row) => ({
        stage: row.stage,
        note: row.note,
        createdAt: row.created_at,
      }));
    const remakes = db
      .prepare("SELECT id, note, created_at FROM job_remakes WHERE job_id = ? ORDER BY id")
      .all(group.job_id)
      .map((row) => ({
        id: row.id,
        note: row.note,
        createdAt: row.created_at,
      }));
    return {
      id: group.job_id,
      jobRef: group.job_ref,
      refKind: group.ref_kind,
      customerName: group.customer_name,
      designerName: group.designer_name,
      stage: group.stage,
      installDate: group.install_date,
      deadline: group.deadline,
      notes: group.notes,
      history,
      remakes,
    };
  }

  function lastMessage(groupId) {
    return db
      .prepare(
        `SELECT m.body, m.created_at, u.display_name AS sender_name,
                (SELECT a.kind FROM message_attachments a WHERE a.message_id = m.id LIMIT 1) AS kind
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ?
         ORDER BY m.id DESC
         LIMIT 1`,
      )
      .get(groupId);
  }

  function unreadCount(groupId, userId) {
    return db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM messages m
         WHERE m.group_id = ?
           AND m.user_id != ?
           AND NOT EXISTS (
             SELECT 1 FROM message_reads r
             WHERE r.message_id = m.id AND r.user_id = ?
           )`,
      )
      .get(groupId, userId, userId).n;
  }

  function visibleGroupRows(user) {
    if (hasRole(user, "admin")) {
      return db
        .prepare(
          `SELECT g.id, g.name, g.kind, g.job_id, j.job_ref, j.customer_name, j.designer_name, j.stage, j.install_date, j.notes
           FROM chat_groups g
           LEFT JOIN jobs j ON j.id = g.job_id`,
        )
        .all();
    }
    return db
      .prepare(
         `SELECT g.id, g.name, g.kind, g.job_id, j.job_ref, j.customer_name, j.designer_name, j.stage, j.install_date, j.notes
         FROM chat_groups g
         JOIN chat_group_members m ON m.group_id = g.id AND m.user_id = ?
         LEFT JOIN jobs j ON j.id = g.job_id`,
      )
      .all(user.id);
  }

  function decorateGroup(row, userId) {
    const last = lastMessage(row.id);
    const memberCount = db
      .prepare("SELECT COUNT(*) AS n FROM chat_group_members WHERE group_id = ?")
      .get(row.id).n;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      jobRef: row.job_ref,
      customerName: row.customer_name,
      designerName: row.designer_name,
      stage: row.stage,
      installDate: row.install_date,
      notes: row.notes,
      member: Boolean(
        db.prepare("SELECT 1 AS n FROM chat_group_members WHERE group_id = ? AND user_id = ?").get(row.id, userId),
      ),
      memberCount,
      unreadCount: unreadCount(row.id, userId),
      lastMessage: last
        ? {
            preview: previewFor(last.body, last.kind),
            createdAt: last.created_at,
            senderName: last.sender_name,
          }
        : null,
    };
  }

  function messagesFor(groupId, userId) {
    const rows = db
      .prepare(
        `SELECT m.id, m.user_id, m.body, m.department, m.kind AS message_kind, m.pinned, m.extra, m.reply_to, m.created_at,
                u.display_name, r.body AS reply_body, ru.display_name AS reply_name,
                a.id AS attachment_id, a.file_name, a.stored_name, a.media_type, a.kind
         FROM messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN messages r ON r.id = m.reply_to
         LEFT JOIN users ru ON ru.id = r.user_id
         LEFT JOIN message_attachments a ON a.message_id = m.id
         WHERE m.group_id = ?
         ORDER BY m.id`,
      )
      .all(groupId);
    const messages = [];
    const index = new Map();
    for (const row of rows) {
      let message = index.get(row.id);
      if (!message) {
        let prepare = [];
        if (row.extra) {
          try {
            prepare = JSON.parse(row.extra).prepare ?? [];
          } catch {
            prepare = [];
          }
        }
        message = {
          id: row.id,
          body: row.body,
          department: row.department,
          kind: row.message_kind || "message",
          pinned: Boolean(row.pinned),
          prepare,
          createdAt: row.created_at,
          mine: row.user_id === userId,
          sender: { id: row.user_id, displayName: row.display_name },
          reply: row.reply_to
            ? { id: row.reply_to, body: row.reply_body, senderName: row.reply_name }
            : null,
          attachments: [],
        };
        index.set(row.id, message);
        messages.push(message);
      }
      if (row.attachment_id) {
        message.attachments.push({
          id: row.attachment_id,
          fileName: row.file_name,
          kind: row.kind,
          mediaType: row.media_type,
          url: `/api/company/media/${row.stored_name}`,
        });
      }
    }
    return messages;
  }

  function seed() {
    const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    if (count > 0) return;

    const hour = 60 * 60 * 1000;
    const adminPassword = process.env.COMPANY_ADMIN_PASSWORD || "kiddai-admin";
    const installer1Password = process.env.COMPANY_INSTALLER1_PASSWORD || "install-1";
    const installer2Password = process.env.COMPANY_INSTALLER2_PASSWORD || "install-2";
    const insertRole = db.prepare("INSERT INTO roles (name) VALUES (?)");
    const insertUser = db.prepare(
      "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
    );
    const insertUserRole = db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)");

    db.exec("BEGIN");
    try {
      for (const name of ["admin", "installer", "designer", "purchasing", "cnc"]) {
        insertRole.run(name);
      }
      const roleId = (name) => db.prepare("SELECT id FROM roles WHERE name = ?").get(name).id;

      const adminId = Number(
        insertUser.run("admin", hashPassword(adminPassword), "Admin", iso(-30 * hour)).lastInsertRowid,
      );
      const installer1Id = Number(
        insertUser.run("installer1", hashPassword(installer1Password), "Installer 1", iso(-30 * hour))
          .lastInsertRowid,
      );
      const installer2Id = Number(
        insertUser.run("installer2", hashPassword(installer2Password), "Installer 2", iso(-30 * hour))
          .lastInsertRowid,
      );
      insertUserRole.run(adminId, roleId("admin"));
      insertUserRole.run(installer1Id, roleId("installer"));
      insertUserRole.run(installer2Id, roleId("installer"));

      const jobId = Number(
        db.prepare(
          `INSERT INTO jobs (
             job_ref, ref_kind, customer_name, designer_name, stage, install_date, deadline, notes, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          "5310",
          "queue",
          "Niran Chai",
          "Han",
          "Install",
          "2026-10-06",
          "2026-10-10",
          "White oak doors. Drawing says the left wall is 3200mm.",
          iso(-20 * hour),
        ).lastInsertRowid,
      );

      const insertHistory = db.prepare(
        "INSERT INTO job_stage_history (job_id, stage, note, created_at) VALUES (?, ?, ?, ?)",
      );
      insertHistory.run(jobId, "Deposit", "Queue 5310 is the job id from here on.", iso(-18 * hour));
      insertHistory.run(jobId, "Drawing", "Draftman Stage and Confirm.", iso(-12 * hour));
      insertHistory.run(jobId, "Workshop", "CNC finished. Same job, not a new record.", iso(-8 * hour));
      insertHistory.run(jobId, "Install", "Assigned to KIDDAI 1.", iso(-4 * hour));

      const groupId = Number(
        db.prepare(
          "INSERT INTO chat_groups (name, kind, job_id, created_at) VALUES (?, ?, ?, ?)",
        ).run("KIDDAI 1", "group", jobId, iso(-4 * hour)).lastInsertRowid,
      );
      const insertMember = db.prepare(
        "INSERT INTO chat_group_members (group_id, user_id) VALUES (?, ?)",
      );
      insertMember.run(groupId, adminId);
      insertMember.run(groupId, installer1Id);

      const insertMessage = db.prepare(
        "INSERT INTO messages (group_id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
      );
      insertMessage.run(
        groupId,
        adminId,
        "Queue 5310. Bangna kitchen for Niran Chai. White oak doors. Measure the left wall before you fix anything. Drawing says 3200mm.",
        iso(-3 * hour),
      );
      insertMessage.run(
        groupId,
        installer1Id,
        "On site. Left wall is 3180mm, not 3200.",
        iso(-2 * hour),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  seed();
  const cutoff = iso(-14 * 24 * 60 * 60 * 1000);
  db.prepare("DELETE FROM sessions WHERE created_at < ?").run(cutoff);

  return {
    login(username, password) {
      const normalized = String(username ?? "").trim().toLowerCase();
      const row = db.prepare("SELECT * FROM users WHERE username = ?").get(normalized);
      const stored = row?.password_hash ?? dummyHash;
      const ok = verifyPassword(String(password ?? ""), stored) && row;
      if (!ok) throw httpError(401, "Those details do not match.");
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(
        token,
        row.id,
        iso(),
      );
      const user = publicUser(row);
      audit(user.id, "login", user.username);
      return { token, user };
    },

    logout(token) {
      if (!token) return;
      db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    },

    userFromToken(token) {
      if (!token) return null;
      const session = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token);
      if (!session) return null;
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
      return row ? publicUser(row) : null;
    },

    inbox(user, tab) {
      const allowed = new Set(["all", "unread", "groups", "communities"]);
      const selected = allowed.has(tab) ? tab : "all";
      const groups = visibleGroupRows(user)
        .map((row) => decorateGroup(row, user.id))
        .sort((left, right) => {
          const leftTime = left.lastMessage?.createdAt ?? "";
          const rightTime = right.lastMessage?.createdAt ?? "";
          return rightTime.localeCompare(leftTime) || right.id - left.id;
        });
      const unreadTotal = groups.reduce((sum, group) => sum + group.unreadCount, 0);
      const filtered = groups.filter((group) => {
        if (selected === "unread") return group.unreadCount > 0;
        if (selected === "groups") return group.kind === "group";
        if (selected === "communities") return group.kind === "community";
        return true;
      });
      return { tab: selected, groups: filtered, unreadTotal };
    },

    thread(user, groupId) {
      const group = assertGroup(user, groupId);
      return {
        group: {
          id: group.id,
          name: group.name,
          kind: group.kind,
          job: jobPayload(group),
          members: membersOf(group.id),
        },
        messages: messagesFor(group.id, user.id),
      };
    },

    markRead(user, groupId) {
      assertGroup(user, groupId);
      db.prepare(
        `INSERT INTO message_reads (message_id, user_id, read_at)
         SELECT m.id, ?, ?
         FROM messages m
         WHERE m.group_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM message_reads r
             WHERE r.message_id = m.id AND r.user_id = ?
           )`,
      ).run(user.id, iso(), groupId, user.id);
      return { ok: true };
    },

    sendMessage(user, groupId, input) {
      assertGroup(user, groupId);
      const body = String(input.body ?? "").trim();
      const files = Array.isArray(input.files) ? input.files : input.file ? [input.file] : [];
      const kind = input.kind === "work_order" ? "work_order" : "message";
      const department = String(input.department ?? "").trim();
      const prepare = String(input.prepare ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 12);
      if (kind === "work_order" && !hasRole(user, "admin")) {
        throw httpError(403, "Only an admin can post a work order.");
      }
      if (!body && files.length === 0 && prepare.length === 0) {
        throw httpError(400, "Write a message or attach a photo, video, or file.");
      }
      if (body.length > BODY_LIMIT) throw httpError(400, "That message is too long.");
      if (department && !DEPARTMENTS.has(department)) throw httpError(400, "Choose a department.");
      const replyTo = Number(input.replyTo);
      if (input.replyTo && !db.prepare("SELECT id FROM messages WHERE id = ? AND group_id = ?").get(replyTo, groupId)) {
        throw httpError(400, "That reply does not belong to this project.");
      }

      const stored = [];
      for (const file of files.slice(0, 8)) {
        if (!file?.data?.length) throw httpError(400, "That file is empty.");
        if (file.data.length > FILE_LIMIT) throw httpError(413, "Each file must be 80 MB or smaller.");
        const media = MEDIA[String(file.mime || "").toLowerCase()];
        if (!media) throw httpError(400, "Send a JPG, PNG, WEBP, GIF, MP4, WEBM, MOV, or PDF.");
        const storedName = `${randomUUID()}${media.ext}`;
        fs.writeFileSync(path.join(mediaDir, storedName), file.data);
        stored.push({ file, media, storedName });
      }

      try {
        db.exec("BEGIN");
        const messageId = Number(
          db.prepare(
            `INSERT INTO messages (group_id, user_id, body, department, kind, extra, reply_to, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            groupId,
            user.id,
            body || null,
            department || null,
            kind,
            prepare.length ? JSON.stringify({ prepare }) : null,
            input.replyTo ? replyTo : null,
            iso(),
          ).lastInsertRowid,
        );
        const insertFile = db.prepare(
          `INSERT INTO message_attachments (
             message_id, file_name, stored_name, media_type, kind, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const item of stored) {
          const safeName = String(item.file.filename || "upload").replace(/[\r\n"]/g, "").slice(0, 120) || "upload";
          const mime = item.file.mime.toLowerCase() === "image/jpg" ? "image/jpeg" : item.file.mime.toLowerCase();
          insertFile.run(messageId, safeName, item.storedName, mime, item.media.kind, iso());
        }
        db.prepare(
          "INSERT INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)",
        ).run(messageId, user.id, iso());
        db.exec("COMMIT");
        audit(user.id, kind === "work_order" ? "work_order" : "send_message", `group:${groupId}`);
      } catch (error) {
        db.exec("ROLLBACK");
        for (const item of stored) fs.rmSync(path.join(mediaDir, item.storedName), { force: true });
        throw error;
      }

      return this.thread(user, groupId);
    },

    pinMessage(user, groupId, messageId) {
      assertGroup(user, groupId);
      if (!hasRole(user, "admin")) throw httpError(403, "Only an admin can pin a message.");
      const row = db.prepare("SELECT pinned FROM messages WHERE id = ? AND group_id = ?").get(messageId, groupId);
      if (!row) throw httpError(404, "That message does not exist.");
      db.prepare("UPDATE messages SET pinned = ? WHERE id = ?").run(row.pinned ? 0 : 1, messageId);
      audit(user.id, "pin_message", `message:${messageId}`);
      return this.thread(user, groupId);
    },

    mediaFor(user, storedName) {
      if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov|pdf)$/i.test(storedName)) {
        throw httpError(404, "That file does not exist.");
      }
      const row = db
        .prepare(
          `SELECT a.file_name, a.media_type, a.stored_name, m.group_id
           FROM message_attachments a
           JOIN messages m ON m.id = a.message_id
           WHERE a.stored_name = ?`,
        )
        .get(storedName);
      if (!row) throw httpError(404, "That file does not exist.");
      assertGroup(user, row.group_id);
      const absPath = path.join(mediaDir, row.stored_name);
      const root = mediaDir.endsWith(path.sep) ? mediaDir : `${mediaDir}${path.sep}`;
      if (!absPath.startsWith(root) || !fs.existsSync(absPath)) {
        throw httpError(404, "That file does not exist.");
      }
      return {
        absPath,
        mime: row.media_type,
        fileName: row.file_name,
      };
    },
  };
}
