import { getStore } from "@netlify/blobs";

const STORE_NAME = "facebook-notifications";
const KEY = "unread-v1";
const MAX_ITEMS = 200;

/**
 * @typedef {{
 *   id: string;
 *   psid: string;
 *   mid: string;
 *   senderName: string;
 *   preview: string;
 *   receivedAt: string;
 *   pageId: string;
 *   read: boolean;
 * }} FacebookNotification
 */

/** Strip sheet marker ` line@` / `line@` so mark-read matches FB sender names. */
function normalizeSenderName(value) {
  return String(value || "")
    .replace(/\s*line@$/iu, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ");
}

function getNotificationStore() {
  const token =
    process.env.NETLIFY_AUTH_TOKEN?.trim() ||
    process.env.BLOBS_TOKEN?.trim() ||
    process.env.NETLIFY_BLOBS_TOKEN?.trim() ||
    "";
  const siteID = process.env.SITE_ID?.trim() || process.env.NETLIFY_SITE_ID?.trim() || "";

  // Prefer automatic Netlify runtime context (correct site) when available.
  try {
    if (!token || !siteID) {
      return getStore({ name: STORE_NAME, consistency: "strong" });
    }
  } catch {
    // Fall through to explicit credentials.
  }

  if (!token) {
    throw new Error(
      "Netlify Blobs is not configured. Set NETLIFY_AUTH_TOKEN (Netlify personal access token) in site env vars.",
    );
  }

  if (!siteID) {
    throw new Error(
      "Netlify Blobs needs SITE_ID / NETLIFY_SITE_ID when using an explicit auth token.",
    );
  }

  return getStore({
    name: STORE_NAME,
    siteID,
    token,
    consistency: "strong",
  });
}

/** @returns {Promise<FacebookNotification[]>} */
export async function readNotifications() {
  try {
    const store = getNotificationStore();
    const payload = await store.get(KEY, { type: "json" });
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload.filter((item) => item && typeof item.id === "string");
  } catch (error) {
    console.log("facebook-store: read failed", error instanceof Error ? error.message : error);
    return [];
  }
}

/** @param {FacebookNotification[]} items */
export async function writeNotifications(items) {
  const store = getNotificationStore();
  const trimmed = items.slice(0, MAX_ITEMS);
  await store.setJSON(KEY, trimmed);
  return trimmed;
}

/** @param {FacebookNotification[]} incoming */
export async function addNotifications(incoming) {
  if (incoming.length === 0) {
    return readNotifications();
  }

  const existing = await readNotifications();
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...incoming.filter((item) => !seen.has(item.id)), ...existing];
  return writeNotifications(merged);
}

/**
 * @param {{ ids?: string[]; psids?: string[]; senderNames?: string[] }} options
 */
export async function markNotificationsRead(options) {
  const ids = new Set((options.ids ?? []).map((value) => value.trim()).filter(Boolean));
  const psids = new Set((options.psids ?? []).map((value) => value.trim()).filter(Boolean));
  const senderNames = new Set(
    (options.senderNames ?? []).map((value) => normalizeSenderName(value)).filter(Boolean),
  );

  const existing = await readNotifications();
  const next = existing.map((item) => {
    const nameMatch = senderNames.has(normalizeSenderName(item.senderName));
    if (ids.has(item.id) || psids.has(item.psid) || nameMatch) {
      return { ...item, read: true };
    }
    return item;
  });

  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const pruned = next.filter((item) => {
    if (!item.read) {
      return true;
    }
    const ts = Date.parse(item.receivedAt);
    return Number.isFinite(ts) ? ts >= cutoff : false;
  });

  await writeNotifications(pruned);
  return pruned.filter((item) => !item.read);
}
