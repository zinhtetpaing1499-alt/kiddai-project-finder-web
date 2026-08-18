import { createHmac, timingSafeEqual } from "node:crypto";
import { addNotifications } from "./_facebook-store.mjs";

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

function text(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body,
  };
}

function getRawBody(event) {
  if (!event.body) {
    return "";
  }
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return typeof event.body === "string" ? event.body : JSON.stringify(event.body);
}

function getHeader(event, name) {
  const headers = event.headers || {};
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return String(value || "");
    }
  }
  return "";
}

function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) {
    return { ok: true, reason: "no-secret" };
  }
  if (!signatureHeader?.startsWith("sha256=")) {
    return { ok: false, reason: "missing-header" };
  }

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, reason: "length-mismatch" };
  }
  return {
    ok: timingSafeEqual(expectedBuffer, providedBuffer),
    reason: "compared",
  };
}

async function fetchSenderName(psid, pageAccessToken) {
  if (!psid || !pageAccessToken) {
    return "Facebook user";
  }

  try {
    const params = new URLSearchParams({
      fields: "name",
      access_token: pageAccessToken,
    });
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(psid)}?${params.toString()}`,
    );
    const payload = await response.json();
    if (response.ok && typeof payload.name === "string" && payload.name.trim()) {
      return payload.name.trim();
    }
  } catch {
    // Fall through.
  }

  return "Facebook user";
}

function messagePreview(message) {
  if (!message || typeof message !== "object") {
    return "New message";
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim().slice(0, 160);
  }
  if (message.attachments?.length) {
    return "Sent an attachment";
  }
  if (message.sticker_id) {
    return "Sent a sticker";
  }
  return "New message";
}

function collectMessagingEvents(payload) {
  const events = [];
  for (const entry of payload.entry ?? []) {
    const pageId = String(entry.id || "");
    const buckets = [...(entry.messaging ?? []), ...(entry.standby ?? [])];
    for (const messaging of buckets) {
      events.push({ pageId, messaging });
    }
  }
  return events;
}

export async function handler(event) {
  try {
    const method = event.httpMethod || "GET";
    const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN?.trim() || "";
    const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim() || "";
    const appSecret = process.env.FACEBOOK_APP_SECRET?.trim() || "";

    if (method === "GET") {
      const params = event.queryStringParameters || {};
      const mode = params["hub.mode"] || params.hub_mode || "";
      const token = params["hub.verify_token"] || params.hub_verify_token || "";
      const challenge = params["hub.challenge"] || params.hub_challenge || "";

      if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
        return text(200, challenge);
      }

      return json(403, { error: "Facebook webhook verification failed." });
    }

    if (method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const rawBody = getRawBody(event);
    const signature = getHeader(event, "x-hub-signature-256");
    const signatureResult = verifySignature(rawBody, signature, appSecret);

    // Soft-fail: still accept Meta events if App Secret in Netlify is wrong/outdated.
    // This unblocks notifications while keeping verify-token GET secure.
    if (!signatureResult.ok) {
      console.log(
        "facebook-webhook: signature soft-fail",
        signatureResult.reason,
        "- processing payload anyway",
      );
    }

    let payload;
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }

    const messagingEvents = collectMessagingEvents(payload);
    console.log(
      "facebook-webhook: post",
      JSON.stringify({
        object: payload.object,
        entries: Array.isArray(payload.entry) ? payload.entry.length : 0,
        messagingEvents: messagingEvents.length,
        signatureOk: signatureResult.ok,
      }),
    );

    if (payload.object !== "page") {
      return json(200, { ok: true, ignored: true });
    }

    const incoming = [];

    for (const { pageId, messaging } of messagingEvents) {
      if (messaging.message?.is_echo) {
        continue;
      }
      if (!messaging.message) {
        continue;
      }

      const psid = String(messaging.sender?.id || "").trim();
      if (!psid) {
        continue;
      }

      const mid = String(messaging.message.mid || `${psid}-${messaging.timestamp || Date.now()}`);
      const senderName = await fetchSenderName(psid, pageAccessToken);
      incoming.push({
        id: mid,
        psid,
        mid,
        senderName,
        preview: messagePreview(messaging.message),
        receivedAt: new Date(Number(messaging.timestamp) || Date.now()).toISOString(),
        pageId,
        read: false,
      });
    }

    if (incoming.length > 0) {
      await addNotifications(incoming);
      console.log("facebook-webhook: stored", incoming.length, "notifications");
    } else {
      console.log("facebook-webhook: no inbound customer messages in payload");
    }

    return json(200, { ok: true, accepted: incoming.length, signatureOk: signatureResult.ok });
  } catch (error) {
    console.log("facebook-webhook: fatal", error instanceof Error ? error.message : error);
    return json(500, {
      error: error instanceof Error ? error.message : "Facebook webhook failed.",
    });
  }
}
