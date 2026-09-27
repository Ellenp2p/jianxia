import type { ArchiveItem, HistoryRow, LogEntry, Person, Settings } from "./types";

export type SecretBody = {
  settings: Settings;
  items: ArchiveItem[];
  logs: LogEntry[];
  enrolledPrivate: string[];
  enrolledGroup: string[];
  people: Person[];
  history: HistoryRow[];
  updateOffset: number;
  botName: string;
  botUsername: string;
  webhookSecret: string;
  serverListening: boolean;
  lastUpdateId: number;
  loginChallenge: { code: string; exp: number } | null;
  loginGrant: { code: string; userId: string; ok: boolean; exp: number } | null;
};

export type Snapshot = {
  revision: number;
  tokenOnFile: boolean;
  serverListening: boolean;
  botName: string;
  botUsername: string;
  updateOffset: number;
  settings: Settings;
  items: ArchiveItem[];
  logs: LogEntry[];
  enrolledPrivate: string[];
  enrolledGroup: string[];
  people: Person[];
  history: HistoryRow[];
};

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/;

export function tokenOk(value: string): boolean {
  return TOKEN_RE.test(value.trim());
}

export function shrinkPreview(value: string): string {
  if (value.startsWith("data:") && value.length > 48_000) return "";
  return value;
}

export function present(body: SecretBody, revision: number): Snapshot {
  return {
    revision,
    tokenOnFile: tokenOk(body.settings.token),
    serverListening: body.serverListening,
    botName: body.botName,
    botUsername: body.botUsername,
    updateOffset: body.updateOffset,
    settings: { ...body.settings, token: "" },
    items: body.items.map((item) => ({ ...item, preview: shrinkPreview(item.preview) })),
    logs: body.logs,
    enrolledPrivate: body.enrolledPrivate,
    enrolledGroup: body.enrolledGroup,
    people: body.people,
    history: body.history.map((row) => ({ ...row, preview: shrinkPreview(row.preview) })),
  };
}
