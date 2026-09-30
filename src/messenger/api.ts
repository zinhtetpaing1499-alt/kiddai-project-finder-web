import type { ChatMessage, GroupDetail, InboxGroup, MemberUpdate, Person } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const raw = await response.text();
  let payload: (T & { error?: string }) | null = null;
  try {
    payload = raw ? (JSON.parse(raw) as T & { error?: string }) : null;
  } catch {
    throw new Error("The messenger server did not respond.");
  }
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed.");
  }
  return payload as T;
}

export function listPeople(): Promise<{ people: Person[] }> {
  return request("/api/messenger/people");
}

export function inbox(personId: string): Promise<{ groups: InboxGroup[] }> {
  return request(`/api/messenger/inbox?personId=${encodeURIComponent(personId)}`);
}

export function groupDetail(groupId: string, personId: string): Promise<GroupDetail> {
  return request(`/api/messenger/groups/${encodeURIComponent(groupId)}?personId=${encodeURIComponent(personId)}`);
}

export function setQueue(groupId: string, personId: string, queueNumber: string): Promise<{ group: InboxGroup }> {
  return request(`/api/messenger/groups/${encodeURIComponent(groupId)}`, {
    method: "PATCH",
    body: JSON.stringify({ personId, queueNumber }),
  });
}

export function createGroup(personId: string): Promise<{ group: InboxGroup }> {
  return request("/api/messenger/groups", {
    method: "POST",
    body: JSON.stringify({ personId }),
  });
}

export function addMember(groupId: string, personId: string, name: string): Promise<MemberUpdate> {
  return request(`/api/messenger/groups/${encodeURIComponent(groupId)}/members`, {
    method: "POST",
    body: JSON.stringify({ personId, name }),
  });
}

export function removeMember(groupId: string, personId: string, memberId: string): Promise<{ members: Person[] }> {
  return request(
    `/api/messenger/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}?personId=${encodeURIComponent(personId)}`,
    { method: "DELETE" },
  );
}

export function sendText(groupId: string, personId: string, text: string): Promise<{ message: ChatMessage }> {
  return request(`/api/messenger/groups/${encodeURIComponent(groupId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ personId, kind: "text", text }),
  });
}

export function sendPhoto(groupId: string, personId: string, photoDataUrl: string): Promise<{ message: ChatMessage }> {
  return request(`/api/messenger/groups/${encodeURIComponent(groupId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ personId, kind: "photo", photoDataUrl }),
  });
}

export function markRead(groupId: string, personId: string): Promise<{ ok: boolean }> {
  return request(`/api/messenger/groups/${encodeURIComponent(groupId)}/read`, {
    method: "POST",
    body: JSON.stringify({ personId }),
  });
}

export function setMuted(groupId: string, personId: string, muted: boolean): Promise<{ muted: boolean }> {
  return request(`/api/messenger/groups/${encodeURIComponent(groupId)}/mute`, {
    method: "POST",
    body: JSON.stringify({ personId, muted }),
  });
}

export function createPerson(personId: string, name: string): Promise<{ person: Person }> {
  return request("/api/messenger/people", {
    method: "POST",
    body: JSON.stringify({ personId, name }),
  });
}

export function renamePerson(personId: string, targetId: string, name: string): Promise<{ person: Person }> {
  return request(`/api/messenger/people/${encodeURIComponent(targetId)}`, {
    method: "PATCH",
    body: JSON.stringify({ personId, name }),
  });
}

export function readPhotoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choose a photo."));
      return;
    }
    if (file.size > 4_000_000) {
      reject(new Error("Photo is too large."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(file);
  });
}
