import { CUSTOMER_TASK_NOTES_KEY } from "../constants/storage";

export type CustomerTaskNote = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
};

type CustomerTaskNotesStore = Record<string, CustomerTaskNote[]>;

export function customerTaskNotesKey(
  mode: string,
  designer: string,
  projectNumber: string,
  customerName: string,
) {
  return `${mode}:${designer}:${projectNumber}:${customerName.trim().toLocaleLowerCase()}`;
}

function readStore(): CustomerTaskNotesStore {
  try {
    const rawValue = window.localStorage.getItem(CUSTOMER_TASK_NOTES_KEY);
    if (!rawValue) {
      return {};
    }
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as CustomerTaskNotesStore;
  } catch {
    return {};
  }
}

function writeStore(store: CustomerTaskNotesStore) {
  window.localStorage.setItem(CUSTOMER_TASK_NOTES_KEY, JSON.stringify(store));
}

export function readCustomerTaskNotes(key: string) {
  const notes = readStore()[key] ?? [];
  return notes.filter((note) => note && typeof note.text === "string");
}

export function readOpenCustomerTaskNotes(key: string) {
  return readCustomerTaskNotes(key).filter((note) => !note.done);
}

export function addCustomerTaskNote(key: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return readOpenCustomerTaskNotes(key);
  }

  const store = readStore();
  const nextNote: CustomerTaskNote = {
    id: crypto.randomUUID(),
    text: trimmed,
    done: false,
    createdAt: new Date().toISOString(),
  };
  store[key] = [...(store[key] ?? []), nextNote];
  writeStore(store);
  return store[key].filter((note) => !note.done);
}

export function completeCustomerTaskNote(key: string, noteId: string) {
  const store = readStore();
  const notes = store[key] ?? [];
  store[key] = notes.map((note) => (note.id === noteId ? { ...note, done: true } : note));
  writeStore(store);
  return store[key].filter((note) => !note.done);
}

export function countOpenCustomerTaskNotes(key: string) {
  return readOpenCustomerTaskNotes(key).length;
}
