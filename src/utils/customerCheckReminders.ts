import { CUSTOMER_CHECK_REMINDERS_KEY, CUSTOMER_TASK_NOTES_KEY } from "../constants/storage";

type ReminderStore = Record<string, true>;

export function customerReminderKey(
  mode: string,
  designer: string,
  projectNumber: string,
  customerName: string,
) {
  return `${mode}:${designer}:${projectNumber}:${customerName.trim().toLocaleLowerCase()}`;
}

function readStore(): ReminderStore {
  try {
    const rawValue = window.localStorage.getItem(CUSTOMER_CHECK_REMINDERS_KEY);
    if (rawValue) {
      const parsed = JSON.parse(rawValue) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as ReminderStore;
      }
    }
  } catch {
    // Fall through and try the older notes list.
  }

  return migrateFromTaskNotes();
}

function migrateFromTaskNotes(): ReminderStore {
  try {
    const rawValue = window.localStorage.getItem(CUSTOMER_TASK_NOTES_KEY);
    if (!rawValue) {
      return {};
    }
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const migrated: ReminderStore = {};
    for (const [key, notes] of Object.entries(parsed as Record<string, { done?: boolean }[]>)) {
      if (Array.isArray(notes) && notes.some((note) => note && !note.done)) {
        migrated[key] = true;
      }
    }
    if (Object.keys(migrated).length > 0) {
      writeStore(migrated);
    }
    return migrated;
  } catch {
    return {};
  }
}

function writeStore(store: ReminderStore) {
  window.localStorage.setItem(CUSTOMER_CHECK_REMINDERS_KEY, JSON.stringify(store));
}

export function hasCustomerCheckReminder(key: string) {
  return Boolean(readStore()[key]);
}

export function setCustomerCheckReminder(key: string, enabled: boolean) {
  const store = readStore();
  if (enabled) {
    store[key] = true;
  } else {
    delete store[key];
  }
  writeStore(store);
  return enabled;
}

export function toggleCustomerCheckReminder(key: string) {
  return setCustomerCheckReminder(key, !hasCustomerCheckReminder(key));
}

export function countCustomerCheckReminders(keys: string[]) {
  const store = readStore();
  return keys.reduce((count, key) => count + (store[key] ? 1 : 0), 0);
}
