import { notificationAppliesToCustomer } from "../services/facebookNotifications";
import type { FacebookNotification } from "../services/facebookNotifications";
import type { LineNotification } from "../services/lineNotifications";

export const DESIGNERS = ["Tod", "Do", "Kram", "Rung", "Han", "Steve", "Ton"] as const;
export const CUSTOMER_CACHE_VERSION = 1;
export const FINISHED_CACHE_VERSION = 3;
export const CUSTOMER_LISTS_CHANGED_EVENT = "kiddai.customerListsChanged";

export type CustomerMode = "deposit" | "selling";
export type DesignerName = (typeof DESIGNERS)[number];

export type MessagingNotification = {
  id: string;
  channelKey: string;
  senderName: string;
  preview: string;
  receivedAt: string;
  source: "facebook" | "line";
};

type CachedCustomerName = {
  customerName: string;
};

export function notifyCustomerListsChanged() {
  window.dispatchEvent(new Event(CUSTOMER_LISTS_CHANGED_EVENT));
}

export function mergeMessagingNotifications(
  facebook: FacebookNotification[],
  line: LineNotification[],
): MessagingNotification[] {
  const merged: MessagingNotification[] = [
    ...facebook.map((item) => ({
      id: `fb:${item.id}`,
      channelKey: item.psid,
      senderName: item.senderName,
      preview: item.preview,
      receivedAt: item.receivedAt,
      source: "facebook" as const,
    })),
    ...line.map((item) => ({
      id: `line:${item.id}`,
      channelKey: item.userId,
      senderName: item.senderName,
      preview: item.preview,
      receivedAt: item.receivedAt,
      source: "line" as const,
    })),
  ];
  merged.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return merged;
}

export function countDistinctCustomersWithUnread(
  records: CachedCustomerName[],
  notifications: MessagingNotification[],
) {
  if (records.length === 0 || notifications.length === 0) {
    return 0;
  }
  const seen = new Set<string>();
  let count = 0;
  for (const record of records) {
    const key = record.customerName.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    if (
      notifications.some((item) =>
        notificationAppliesToCustomer(item.senderName, record.customerName, item.source),
      )
    ) {
      seen.add(key);
      count += 1;
    }
  }
  return count;
}

function readCachedRecords(mode: CustomerMode): CachedCustomerName[] {
  const records: CachedCustomerName[] = [];
  for (const designer of DESIGNERS) {
    const rawValue = window.localStorage.getItem(
      `kiddai.customerWorkspace.${CUSTOMER_CACHE_VERSION}.${mode}.${designer}`,
    );
    if (!rawValue) {
      continue;
    }
    try {
      const parsed = JSON.parse(rawValue) as {
        version?: number;
        mode?: string;
        records?: CachedCustomerName[];
      };
      if (
        parsed.version !== CUSTOMER_CACHE_VERSION ||
        parsed.mode !== mode ||
        !Array.isArray(parsed.records)
      ) {
        continue;
      }
      for (const record of parsed.records) {
        if (typeof record?.customerName === "string") {
          records.push({ customerName: record.customerName });
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
  }
  return records;
}

function readFinishedRecords(): CachedCustomerName[] {
  try {
    const rawValue = window.localStorage.getItem(
      `kiddai.depositStageFinished.${FINISHED_CACHE_VERSION}`,
    );
    if (!rawValue) {
      return [];
    }
    const parsed = JSON.parse(rawValue) as {
      version?: number;
      records?: CachedCustomerName[];
    };
    if (parsed.version !== FINISHED_CACHE_VERSION || !Array.isArray(parsed.records)) {
      return [];
    }
    return parsed.records.filter(
      (record): record is CachedCustomerName => typeof record?.customerName === "string",
    );
  } catch {
    return [];
  }
}

export function countSellingWorkspaceUnread(notifications: MessagingNotification[]) {
  return countDistinctCustomersWithUnread(readCachedRecords("selling"), notifications);
}

export function countDepositWorkspaceUnread(notifications: MessagingNotification[]) {
  return countDistinctCustomersWithUnread(
    [...readCachedRecords("deposit"), ...readFinishedRecords()],
    notifications,
  );
}

export function formatNotiCount(count: number) {
  return count > 9 ? "9+" : String(count);
}
