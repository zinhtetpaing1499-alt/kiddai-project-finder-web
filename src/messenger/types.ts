export type PersonRole = "admin" | "installer";

export type Person = {
  id: string;
  name: string;
  role: PersonRole;
  groupNames: string[];
};

export type InboxGroup = {
  id: string;
  name: string;
  muted: boolean;
  unread: boolean;
  preview: string;
  lastActivityAt: string;
  memberCount: number;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  kind: "text" | "photo";
  text: string | null;
  photoUrl: string | null;
  createdAt: string;
};

export type GroupDetail = {
  group: InboxGroup;
  members: Person[];
  messages: ChatMessage[];
};

export type MemberUpdate = {
  created: boolean;
  alreadyMember: boolean;
  members: Person[];
};
