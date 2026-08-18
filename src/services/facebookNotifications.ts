export type FacebookNotification = {
  id: string;
  psid: string;
  mid: string;
  senderName: string;
  preview: string;
  receivedAt: string;
  pageId: string;
  read: boolean;
};

export type FacebookNotificationsResponse = {
  unreadCount: number;
  notifications: FacebookNotification[];
  error?: string;
  syncError?: string | null;
  pageName?: string | null;
};

/** Sheet convention: trailing `line@` marks this row as a LINE contact (not Facebook). */
const LINE_MARKER_RE = /\s*line@$/iu;

/** True if the sheet customer name has the intentional trailing `line@` marker. Check before strip. */
export function customerHasLineMarker(customerName: string) {
  return LINE_MARKER_RE.test(customerName.trim());
}

/** Strip intentional sheet marker ` line@` / `line@` (case-insensitive) from either side. */
export function stripLineMarker(value: string) {
  return value.replace(LINE_MARKER_RE, "").trim();
}

function normalizeName(value: string) {
  return stripLineMarker(value).toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

export function notificationMatchesCustomer(senderName: string, customerName: string) {
  const left = normalizeName(senderName);
  const right = normalizeName(customerName);
  if (!left || !right || left === "facebook user" || left === "line user") {
    return false;
  }
  if (left === right) {
    return true;
  }
  // Prefer exact match when either side is very short — loose includes causes garbage hits (e.g. "Al").
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length < 3) {
    return false;
  }
  return longer.includes(shorter);
}

/**
 * Sheet convention: `line@` → LINE only; no marker → Facebook only.
 * Name matching still strips `line@` so Messenger/LINE display names can match the base name.
 */
export function notificationAppliesToCustomer(
  senderName: string,
  customerName: string,
  source: "facebook" | "line",
) {
  const isLineCustomer = customerHasLineMarker(customerName);
  if (isLineCustomer && source !== "line") {
    return false;
  }
  if (!isLineCustomer && source !== "facebook") {
    return false;
  }
  return notificationMatchesCustomer(senderName, customerName);
}

export async function fetchFacebookNotifications(): Promise<FacebookNotificationsResponse> {
  try {
    const response = await fetch("/api/facebook/notifications", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json()) as FacebookNotificationsResponse & {
      sync?: { error?: string | null; pageName?: string | null };
    };
    if (!response.ok) {
      return { unreadCount: 0, notifications: [], error: payload.error || "Unable to load notifications." };
    }
    return {
      unreadCount: payload.unreadCount ?? payload.notifications?.length ?? 0,
      notifications: payload.notifications ?? [],
      syncError: payload.sync?.error ?? null,
      pageName: payload.sync?.pageName ?? null,
    };
  } catch {
    return { unreadCount: 0, notifications: [] };
  }
}

export async function markFacebookNotificationsRead(options: {
  ids?: string[];
  psids?: string[];
  senderNames?: string[];
}): Promise<FacebookNotificationsResponse> {
  try {
    const response = await fetch("/api/facebook/notifications", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    });
    const payload = (await response.json()) as FacebookNotificationsResponse;
    if (!response.ok) {
      return { unreadCount: 0, notifications: [], error: payload.error || "Unable to mark notifications read." };
    }
    return {
      unreadCount: payload.unreadCount ?? payload.notifications?.length ?? 0,
      notifications: payload.notifications ?? [],
    };
  } catch {
    return { unreadCount: 0, notifications: [] };
  }
}
