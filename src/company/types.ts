export type CompanyRole = "admin" | "installer" | "designer" | "purchasing" | "cnc" | "member";

export type CompanyUser = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  roles: string[];
};

export type InboxTab = "all" | "unread" | "mine" | "install" | "groups" | "communities";

export type InboxMessagePreview = {
  preview: string;
  createdAt: string;
  senderName: string;
};

export type InboxGroup = {
  id: number;
  name: string;
  kind: "group" | "community";
  jobRef: string | null;
  customerName: string | null;
  designerName: string | null;
  stage: string | null;
  installDate: string | null;
  notes: string | null;
  member: boolean;
  memberCount: number;
  unreadCount: number;
  lastMessage: InboxMessagePreview | null;
};

export type InboxPayload = {
  tab: InboxTab;
  groups: InboxGroup[];
  unreadTotal: number;
};

export type JobHistoryEntry = {
  stage: string;
  note: string | null;
  createdAt: string;
};

export type JobRemake = {
  id: number;
  note: string;
  createdAt: string;
};

export type CompanyJob = {
  id: number;
  jobRef: string;
  refKind: "estimate" | "queue";
  customerName: string;
  designerName: string | null;
  stage: string;
  installDate: string | null;
  deadline: string | null;
  notes: string | null;
  history: JobHistoryEntry[];
  remakes: JobRemake[];
};

export type GroupMember = {
  id: number;
  displayName: string;
  role: string;
};

export type ChatAttachment = {
  id: number;
  fileName: string;
  kind: "image" | "video" | "file";
  mediaType: string;
  url: string;
};

export type ChatMessage = {
  id: number;
  body: string | null;
  department: string | null;
  kind: "message" | "work_order";
  pinned: boolean;
  prepare: string[];
  createdAt: string;
  mine: boolean;
  sender: { id: number; displayName: string };
  reply: { id: number; body: string | null; senderName: string | null } | null;
  attachments: ChatAttachment[];
};

export type GroupThread = {
  group: {
    id: number;
    name: string;
    kind: "group" | "community";
    job: CompanyJob | null;
    members: GroupMember[];
  };
  messages: ChatMessage[];
};
