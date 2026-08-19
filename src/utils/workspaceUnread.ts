import { notificationAppliesToCustomer } from "../services/facebookNotifications";
import type { FacebookNotification } from "../services/facebookNotifications";
import type { LineNotification } from "../services/lineNotifications";
import { customerReminderKey, hasCustomerCheckReminder } from "./customerCheckReminders";
import { matchDepositStageOwner } from "./depositStage";

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

type CachedCustomer = {
  customerName: string;
  projectNumber?: string;
  designer?: DesignerName;
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

function recordHasUnread(customerName: string, notifications: MessagingNotification[]) {
  return notifications.some((item) =>
    notificationAppliesToCustomer(item.senderName, customerName, item.source),
  );
}

export function countDistinctCustomersNeedingAttention(
  records: CachedCustomer[],
  notifications: MessagingNotification[],
  mode: CustomerMode,
) {
  const seen = new Set<string>();
  let count = 0;
  for (const record of records) {
    const identity = `${record.designer ?? ""}:${record.projectNumber ?? ""}:${record.customerName.trim().toLocaleLowerCase()}`;
    if (!record.customerName.trim() || seen.has(identity)) {
      continue;
    }
    const unread = recordHasUnread(record.customerName, notifications);
    const remind =
      record.designer && record.projectNumber
        ? hasCustomerCheckReminder(
            customerReminderKey(mode, record.designer, record.projectNumber, record.customerName),
          )
        : false;
    if (unread || remind) {
      seen.add(identity);
      count += 1;
    }
  }
  return count;
}

export function countAttentionForDesignerList(
  records: Array<{ customerName: string; projectNumber: string }>,
  notifications: MessagingNotification[],
  mode: CustomerMode,
  designer: DesignerName,
) {
  return countDistinctCustomersNeedingAttention(
    records.map((record) => ({ ...record, designer })),
    notifications,
    mode,
  );
}

function readCachedRecords(mode: CustomerMode): CachedCustomer[] {
  const records: CachedCustomer[] = [];
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
        records?: Array<{ customerName?: string; projectNumber?: string }>;
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
          records.push({
            customerName: record.customerName,
            projectNumber: typeof record.projectNumber === "string" ? record.projectNumber : undefined,
            designer,
          });
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
  }
  return records;
}

function readFinishedRecords(): CachedCustomer[] {
  try {
    const rawValue = window.localStorage.getItem(
      `kiddai.depositStageFinished.${FINISHED_CACHE_VERSION}`,
    );
    if (!rawValue) {
      return [];
    }
    const parsed = JSON.parse(rawValue) as {
      version?: number;
      records?: Array<{ customerName?: string; projectNumber?: string; owner?: string }>;
    };
    if (parsed.version !== FINISHED_CACHE_VERSION || !Array.isArray(parsed.records)) {
      return [];
    }
    const records: CachedCustomer[] = [];
    for (const record of parsed.records) {
      if (typeof record?.customerName !== "string") {
        continue;
      }
      const designer = DESIGNERS.find((name) => matchDepositStageOwner(record.owner ?? "", name));
      records.push({
        customerName: record.customerName,
        projectNumber: typeof record.projectNumber === "string" ? record.projectNumber : undefined,
        designer,
      });
    }
    return records;
  } catch {
    return [];
  }
}

export function countSellingWorkspaceUnread(notifications: MessagingNotification[]) {
  return countDistinctCustomersNeedingAttention(readCachedRecords("selling"), notifications, "selling");
}

export function countDepositWorkspaceUnread(notifications: MessagingNotification[]) {
  return countDistinctCustomersNeedingAttention(
    [...readCachedRecords("deposit"), ...readFinishedRecords()],
    notifications,
    "deposit",
  );
}

export function formatNotiCount(count: number) {
  return count > 9 ? "9+" : String(count);
}
