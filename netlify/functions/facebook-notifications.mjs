import { addNotifications, markNotificationsRead, readNotifications } from "./_facebook-store.mjs";

/** Kiddai Page ID from Meta Webhooks / Page Subscriptions. */
const DEFAULT_KIDDAI_PAGE_ID = "141857615883785";
const LOOKBACK_HOURS = 36;

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(payload),
  };
}

function participantName(participants, pageId) {
  const data = participants?.data ?? [];
  const other = data.find((person) => String(person.id || "") !== String(pageId || "")) ?? data[0];
  return {
    psid: String(other?.id || "").trim(),
    name: String(other?.name || "").trim() || "Facebook user",
  };
}

function isRecent(isoOrMs, hours = LOOKBACK_HOURS) {
  const ts = typeof isoOrMs === "number" ? isoOrMs : Date.parse(String(isoOrMs || ""));
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts <= hours * 60 * 60 * 1000;
}

async function graphGet(path, accessToken, searchParams = {}) {
  const params = new URLSearchParams({ ...searchParams, access_token: accessToken });
  const response = await fetch(`https://graph.facebook.com/v21.0/${path}?${params.toString()}`);
  const payload = await response.json();
  return { ok: response.ok, status: response.status, payload };
}

/**
 * Sync inbound Messenger messages into the local unread store.
 * ADD-ONLY: never mark read / remove unread based on Graph inbox state.
 * Staff reading/replying in Meta Inbox must NOT clear badges — only the
 * web app's explicit mark-read POST (open customer) clears them.
 */
async function syncUnreadFromGraph(rawToken) {
  if (!rawToken) {
    return { synced: 0, error: null, pageName: null, skipped: true };
  }

  const pageId = process.env.FACEBOOK_PAGE_ID?.trim() || DEFAULT_KIDDAI_PAGE_ID;

  try {
    const result = await graphGet(`${pageId}/conversations`, rawToken, {
      platform: "messenger",
      // Intentionally omit relying on unread_count — Graph "read" is not our clear signal.
      fields: "participants,updated_time,snippet,messages.limit(5){message,from,created_time,id}",
      limit: "25",
    });

    if (!result.ok) {
      console.log(
        "facebook-notifications: conversations unavailable",
        result.payload?.error?.message || result.status,
      );
      return { synced: 0, error: null, pageName: null, skipped: true };
    }

    const incoming = [];
    for (const conversation of result.payload.data ?? []) {
      const { psid, name } = participantName(conversation.participants, pageId);
      if (!psid) {
        continue;
      }

      const messages = conversation.messages?.data ?? [];
      for (const latest of messages) {
        const fromId = String(latest?.from?.id || "");
        if (!fromId || fromId === pageId) {
          continue; // Page/staff message — not a customer noti
        }
        if (!isRecent(latest?.created_time, LOOKBACK_HOURS)) {
          continue;
        }

        const mid = String(latest?.id || `${psid}-${latest?.created_time || Date.now()}`);
        const text = typeof latest?.message === "string" ? latest.message.trim() : "";
        const preview = text || "New Messenger message";

        incoming.push({
          id: mid,
          psid,
          mid,
          senderName: name,
          preview: preview.slice(0, 160),
          receivedAt: new Date(latest?.created_time || Date.now()).toISOString(),
          pageId,
          read: false,
        });
      }
    }

    // One noti per customer (latest inbound), keep newest first.
    // addNotifications skips ids already in the store (including ones marked read),
    // so sync never resurrects a cleared unread or wipes open-app clear state.
    const byPsid = new Map();
    for (const item of incoming) {
      const existing = byPsid.get(item.psid);
      if (!existing || Date.parse(item.receivedAt) > Date.parse(existing.receivedAt)) {
        byPsid.set(item.psid, item);
      }
    }
    const deduped = [...byPsid.values()];

    if (deduped.length > 0) {
      await addNotifications(deduped);
    }

    return {
      synced: deduped.length,
      error: null,
      pageName: "Kiddai",
      pageId,
    };
  } catch (error) {
    console.log("facebook-notifications: graph sync failed", error instanceof Error ? error.message : error);
    return {
      synced: 0,
      error: null,
      pageName: null,
      skipped: true,
    };
  }
}

export async function handler(event) {
  const method = event.httpMethod || "GET";

  if (method === "OPTIONS") {
    return json(204, {});
  }

  try {
    if (method === "GET") {
      const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim() || "";
      const sync = await syncUnreadFromGraph(pageAccessToken);
      if (sync.synced > 0) {
        console.log("facebook-notifications: synced", sync.synced, "from Graph");
      }

      const all = await readNotifications();
      const unread = all.filter((item) => !item.read);
      return json(200, {
        unreadCount: unread.length,
        notifications: unread,
        sync,
      });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const unread = await markNotificationsRead({
        ids: Array.isArray(body.ids) ? body.ids.map(String) : [],
        psids: Array.isArray(body.psids) ? body.psids.map(String) : [],
        senderNames: Array.isArray(body.senderNames)
          ? body.senderNames.map(String)
          : body.senderName
            ? [String(body.senderName)]
            : [],
      });

      return json(200, {
        unreadCount: unread.length,
        notifications: unread,
      });
    }

    return json(405, { error: "Method not allowed" });
  } catch (error) {
    console.log("facebook-notifications: fatal", error instanceof Error ? error.message : error);
    return json(500, {
      error: error instanceof Error ? error.message : "Facebook notifications API failed.",
    });
  }
}
