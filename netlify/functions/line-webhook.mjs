import { createHmac, timingSafeEqual } from "node:crypto";
import { addNotifications } from "./_line-store.mjs";

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

/**
 * LINE signature: Base64(HMAC-SHA256(channelSecret, rawBody))
 * Soft-fail when secret is missing/wrong so events are not dropped.
 */
function verifySignature(rawBody, signatureHeader, channelSecret) {
  if (!channelSecret) {
    return { ok: true, reason: "no-secret" };
  }
  if (!signatureHeader) {
    return { ok: false, reason: "missing-header" };
  }

  const expected = createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signatureHeader, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, reason: "length-mismatch" };
  }
  return {
    ok: timingSafeEqual(expectedBuffer, providedBuffer),
    reason: "compared",
  };
}

async function fetchDisplayName(userId, accessToken) {
  if (!userId || !accessToken) {
    return "LINE user";
  }

  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const payload = await response.json();
    if (response.ok && typeof payload.displayName === "string" && payload.displayName.trim()) {
      return payload.displayName.trim();
    }
    console.log(
      "line-webhook: profile unavailable",
      payload?.message || response.status,
      "userId=",
      userId.slice(0, 8),
    );
  } catch (error) {
    console.log("line-webhook: profile fetch failed", error instanceof Error ? error.message : error);
  }

  return "LINE user";
}

function messagePreview(message) {
  if (!message || typeof message !== "object") {
    return "New message";
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim().slice(0, 160);
  }
  const type = String(message.type || "").toLowerCase();
  if (type === "image") {
    return "Sent an image";
  }
  if (type === "video") {
    return "Sent a video";
  }
  if (type === "audio") {
    return "Sent an audio message";
  }
  if (type === "file") {
    return "Sent a file";
  }
  if (type === "sticker") {
    return "Sent a sticker";
  }
  if (type === "location") {
    return "Sent a location";
  }
  if (type) {
    return `Sent a ${type}`;
  }
  return "New message";
}

export async function handler(event) {
  try {
    const method = event.httpMethod || "GET";

    // LINE has no GET challenge; return ok for health checks / Netlify probes.
    if (method === "GET") {
      return text(200, "ok");
    }

    if (method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim() || "";
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || "";
    const channelId = process.env.LINE_CHANNEL_ID?.trim() || "";

    if (!accessToken) {
      console.log(
        "line-webhook: LINE_CHANNEL_ACCESS_TOKEN missing — profile names will be 'LINE user' and will not match sheet rows",
      );
    }
    if (!channelSecret) {
      console.log("line-webhook: LINE_CHANNEL_SECRET missing — signature check skipped");
    }

    const rawBody = getRawBody(event);
    const signature = getHeader(event, "x-line-signature");
    const signatureResult = verifySignature(rawBody, signature, channelSecret);

    // Soft-fail: still accept LINE events if Channel Secret in Netlify is wrong/outdated.
    if (!signatureResult.ok) {
      console.log(
        "line-webhook: signature soft-fail",
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

    const events = Array.isArray(payload.events) ? payload.events : [];
    const destination = String(payload.destination || channelId || "").trim();

    console.log(
      "line-webhook: post",
      JSON.stringify({
        events: events.length,
        destination: destination ? `${destination.slice(0, 8)}…` : "",
        signatureOk: signatureResult.ok,
        hasAccessToken: Boolean(accessToken),
      }),
    );

    const incoming = [];

    for (const lineEvent of events) {
      if (lineEvent?.type !== "message") {
        continue;
      }
      if (!lineEvent.message) {
        continue;
      }

      const userId = String(lineEvent.source?.userId || "").trim();
      if (!userId) {
        continue;
      }

      const mid = String(lineEvent.message.id || `${userId}-${lineEvent.timestamp || Date.now()}`);
      const senderName = await fetchDisplayName(userId, accessToken);
      incoming.push({
        id: mid,
        userId,
        mid,
        senderName,
        preview: messagePreview(lineEvent.message),
        receivedAt: new Date(Number(lineEvent.timestamp) || Date.now()).toISOString(),
        channelId: destination,
        read: false,
      });
    }

    if (incoming.length > 0) {
      await addNotifications(incoming);
      console.log("line-webhook: stored", incoming.length, "notifications");
    } else {
      console.log("line-webhook: no inbound user messages in payload");
    }

    // Always 200 quickly for LINE (retries on non-2xx).
    return json(200, { ok: true, accepted: incoming.length, signatureOk: signatureResult.ok });
  } catch (error) {
    console.log("line-webhook: fatal", error instanceof Error ? error.message : error);
    // Still 200 so LINE does not flood retries when Blobs/token is misconfigured.
    return json(200, {
      ok: false,
      error: error instanceof Error ? error.message : "LINE webhook failed.",
    });
  }
}
