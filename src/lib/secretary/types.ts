export type MediaKind = "photo" | "video" | "animation" | "document";
export type ChatType = "private" | "group" | "supergroup" | "channel";
export type Via = "list" | "new-private" | "new-group";
export type Reveal = "open" | "flash" | "spoiler";

export type Source = {
  id: string;
  query: string;
  resolvedId: string | null;
  resolvedTitle: string | null;
  resolvedUsername: string | null;
  status: "idle" | "ok" | "error";
  error: string | null;
};

export type Settings = {
  token: string;
  photos: boolean;
  videos: boolean;
  animations: boolean;
  documents: boolean;
  watchNewPrivate: boolean;
  watchNewGroups: boolean;
  visualDedupe: boolean;
  visualThreshold: number;
  flashes: boolean;
  adminId: string;
  sources: Source[];
};

export type Incoming = {
  fileUniqueId: string;
  fileId: string;
  kind: MediaKind;
  chatId: string;
  chatTitle: string;
  chatUsername: string | null;
  chatType: ChatType;
  messageId: number;
  caption: string;
  occurredAt: number;
  width: number;
  height: number;
  duration: number | null;
  bytes: number | null;
  preview: string;
  mediaUrl: string | null;
  visualHash: string;
  origin: "drill" | "live";
  senderId: string;
  senderName: string;
  senderUsername: string | null;
  reveal: Reveal;
};

export type ArchiveItem = Incoming & {
  id: string;
  savedAt: number;
  status: "kept" | "duplicate";
  duplicateOfId: string | null;
  duplicateReason: "file" | "visual" | null;
  via: Via | null;
};

export type LogLevel = "kept" | "duplicate" | "skip" | "info" | "error";

export type LogEntry = {
  id: string;
  at: number;
  level: LogLevel;
  title: string;
  detail: string;
  chatTitle: string;
};

export type ParsedMedia = {
  fileUniqueId: string;
  fileId: string;
  previewFileId: string | null;
  kind: MediaKind;
  chatId: string;
  chatTitle: string;
  chatUsername: string | null;
  chatType: ChatType;
  messageId: number;
  caption: string;
  occurredAt: number;
  width: number;
  height: number;
  duration: number | null;
  bytes: number | null;
  senderId: string;
  senderName: string;
  senderUsername: string | null;
  reveal: Reveal;
};

export type Speaker = {
  hiddenId: string;
  displayName: string;
  username: string | null;
  at: number;
  where?: ChatType;
};

export type NameSnap = {
  at: number;
  displayName: string;
  username: string | null;
};

export type Person = {
  hiddenId: string;
  displayName: string;
  username: string | null;
  firstSeen: number;
  lastSeen: number;
  speakCount: number;
  names: NameSnap[];
  places: ChatType[];
};

export type HistoryRow = {
  id: string;
  at: number;
  hiddenId: string;
  displayName: string;
  username: string | null;
  kind: MediaKind;
  reveal: Reveal;
  caption: string;
  chatTitle: string;
  chatId: string;
  chatType: ChatType;
  status: "kept" | "duplicate";
  fileUniqueId: string;
  preview: string;
  archiveId: string;
};
