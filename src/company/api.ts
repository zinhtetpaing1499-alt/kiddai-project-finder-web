import type { CompanyUser, GroupThread, InboxPayload, InboxTab } from "./types";

export class CompanyApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new CompanyApiError(response.status, payload.error || "The company portal could not complete that.");
  }
  return payload as T;
}

export function fetchSession() {
  return request<{ user: CompanyUser | null }>("/api/company/me");
}

export function login(username: string, password: string) {
  return request<{ user: CompanyUser }>("/api/company/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return request<{ ok: boolean }>("/api/company/logout", { method: "POST" });
}

export function fetchInbox(tab: InboxTab) {
  return request<InboxPayload>(`/api/company/inbox?tab=${encodeURIComponent(tab)}`);
}

export function fetchThread(groupId: number) {
  return request<GroupThread>(`/api/company/groups/${groupId}`);
}

export function markGroupRead(groupId: number) {
  return request<{ ok: boolean }>(`/api/company/groups/${groupId}/read`, { method: "POST" });
}

export function sendMessage(
  groupId: number,
  input: { body: string; files: File[]; kind?: "message" | "work_order"; prepare?: string; replyTo?: number },
) {
  const form = new FormData();
  form.set("body", input.body);
  if (input.kind) form.set("kind", input.kind);
  if (input.prepare) form.set("prepare", input.prepare);
  if (input.replyTo) form.set("replyTo", String(input.replyTo));
  for (const file of input.files) form.append("file", file);
  return request<GroupThread>(`/api/company/groups/${groupId}/messages`, {
    method: "POST",
    body: form,
  });
}

export function pinMessage(groupId: number, messageId: number) {
  return request<GroupThread>(`/api/company/groups/${groupId}/messages/${messageId}/pin`, { method: "POST" });
}
