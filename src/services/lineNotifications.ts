import {
  notificationAppliesToCustomer,
  notificationMatchesCustomer,
} from "./facebookNotifications";

export type LineNotification = {
  id: string;
  userId: string;
  mid: string;
  senderName: string;
  preview: string;
  receivedAt: string;
  channelId: string;
  read: boolean;
};

export type LineNotificationsResponse = {
  unreadCount: number;
  notifications: LineNotification[];
  error?: string;
};

export { notificationAppliesToCustomer, notificationMatchesCustomer };

export async function fetchLineNotifications(): Promise<LineNotificationsResponse> {
  try {
    const response = await fetch("/api/line/notifications", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json()) as LineNotificationsResponse;
    if (!response.ok) {
      return { unreadCount: 0, notifications: [], error: payload.error || "Unable to load LINE notifications." };
    }
    return {
      unreadCount: payload.unreadCount ?? payload.notifications?.length ?? 0,
      notifications: payload.notifications ?? [],
    };
  } catch {
    return { unreadCount: 0, notifications: [] };
  }
}

export async function markLineNotificationsRead(options: {
  ids?: string[];
  userIds?: string[];
  senderNames?: string[];
}): Promise<LineNotificationsResponse> {
  try {
    const response = await fetch("/api/line/notifications", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    });
    const payload = (await response.json()) as LineNotificationsResponse;
    if (!response.ok) {
      return { unreadCount: 0, notifications: [], error: payload.error || "Unable to mark LINE notifications read." };
    }
    return {
      unreadCount: payload.unreadCount ?? payload.notifications?.length ?? 0,
      notifications: payload.notifications ?? [],
    };
  } catch {
    return { unreadCount: 0, notifications: [] };
  }
}
