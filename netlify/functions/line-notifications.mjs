import { markNotificationsRead, readNotifications } from "./_line-store.mjs";

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

/** Booleans only — never expose secret values. */
function lineConfigStatus() {
  return {
    hasChannelSecret: Boolean(process.env.LINE_CHANNEL_SECRET?.trim()),
    hasAccessToken: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()),
    hasChannelId: Boolean(process.env.LINE_CHANNEL_ID?.trim()),
  };
}

export async function handler(event) {
  const method = event.httpMethod || "GET";

  if (method === "OPTIONS") {
    return json(204, {});
  }

  try {
    if (method === "GET") {
      // LINE has no conversations sync equivalent to Messenger Graph;
      // unread comes from webhook-stored Blobs only. Cleared only via POST mark-read.
      const all = await readNotifications();
      const unread = all.filter((item) => !item.read);
      const config = lineConfigStatus();
      return json(200, {
        unreadCount: unread.length,
        notifications: unread,
        sync: { synced: 0, skipped: true, reason: "webhook-only" },
        config,
        hint:
          unread.length === 0 && (!config.hasAccessToken || !config.hasChannelSecret)
            ? "LINE env vars missing on this Netlify site. Set LINE_CHANNEL_SECRET + LINE_CHANNEL_ACCESS_TOKEN, point webhook to /api/line/webhook, then redeploy."
            : unread.length === 0
              ? "No unread LINE messages in store. Confirm LINE Developers webhook URL points at this site and a customer message was sent after webhook was enabled."
              : undefined,
      });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const unread = await markNotificationsRead({
        ids: Array.isArray(body.ids) ? body.ids.map(String) : [],
        userIds: Array.isArray(body.userIds)
          ? body.userIds.map(String)
          : Array.isArray(body.psids)
            ? body.psids.map(String)
            : [],
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
    console.log("line-notifications: fatal", error instanceof Error ? error.message : error);
    // Soft-fail for missing Blobs / tokens — empty unread keeps the UI quiet.
    return json(200, {
      unreadCount: 0,
      notifications: [],
      error: error instanceof Error ? error.message : "LINE notifications API failed.",
      config: lineConfigStatus(),
    });
  }
}
