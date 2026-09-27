import type {
  ArchiveItem,
  ChatType,
  HistoryRow,
  Incoming,
  LogEntry,
  MediaKind,
  Person,
  Reveal,
  Settings,
  Source,
  Speaker,
  Via,
} from "./types";

export type FoldState = {
  items: ArchiveItem[];
  logs: LogEntry[];
  enrolledPrivate: string[];
  enrolledGroup: string[];
  people: Person[];
  history: HistoryRow[];
};

export type Decision = {
  level: "kept" | "duplicate" | "skip";
  via: Via | null;
  enroll: "private" | "group" | null;
  duplicateOfId: string | null;
  duplicateReason: "file" | "visual" | null;
  title: string;
  detail: string;
};

export const DEFAULT_SETTINGS: Settings = {
  token: "",
  photos: true,
  videos: true,
  animations: false,
  documents: true,
  watchNewPrivate: true,
  watchNewGroups: false,
  visualDedupe: true,
  visualThreshold: 8,
  flashes: true,
  adminId: "",
  sources: [
    {
      id: "src-hedeng",
      query: "@hedeng_daily",
      resolvedId: "-100100",
      resolvedTitle: "河灯日报",
      resolvedUsername: "hedeng_daily",
      status: "idle",
      error: null,
    },
    {
      id: "src-yetan",
      query: "@yetan_studio",
      resolvedId: "-100200",
      resolvedTitle: "夜摊影像",
      resolvedUsername: "yetan_studio",
      status: "idle",
      error: null,
    },
    {
      id: "src-qiqi",
      query: "@qiqi_weekly",
      resolvedId: "-100300",
      resolvedTitle: "器物手记",
      resolvedUsername: "qiqi_weekly",
      status: "idle",
      error: null,
    },
  ],
};

export function emptyFold(): FoldState {
  return { items: [], logs: [], enrolledPrivate: [], enrolledGroup: [], people: [], history: [] };
}

export function hamming(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let bits = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number.parseInt(a[i] ?? "", 16) ^ Number.parseInt(b[i] ?? "", 16);
    if (!Number.isFinite(x)) return 64;
    bits += countBits(x);
  }
  return bits;
}

function countBits(n: number): number {
  let c = 0;
  let v = n;
  while (v > 0) {
    c += v & 1;
    v >>= 1;
  }
  return c;
}

export function formatStamp(ts: number): string {
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function revealLabel(reveal: Reveal): string {
  if (reveal === "flash") return "闪照";
  if (reveal === "spoiler") return "遮罩";
  return "普通";
}

function rememberPlace(places: ChatType[] | undefined, where: ChatType | undefined): ChatType[] {
  const next = places ? [...places] : [];
  if (where && !next.includes(where)) next.push(where);
  return next;
}

export function noteSpeaker(people: Person[], speaker: Speaker): Person[] {
  const idx = people.findIndex((person) => person.hiddenId === speaker.hiddenId);
  if (idx < 0) {
    const created: Person = {
      hiddenId: speaker.hiddenId,
      displayName: speaker.displayName,
      username: speaker.username,
      firstSeen: speaker.at,
      lastSeen: speaker.at,
      speakCount: 1,
      names: [{ at: speaker.at, displayName: speaker.displayName, username: speaker.username }],
      places: rememberPlace(undefined, speaker.where),
    };
    return [created, ...people].slice(0, 400);
  }
  const current = people[idx];
  if (!current) return people;
  const changed = current.displayName !== speaker.displayName || current.username !== speaker.username;
  const next: Person = {
    ...current,
    displayName: speaker.displayName,
    username: speaker.username,
    lastSeen: Math.max(current.lastSeen, speaker.at),
    firstSeen: Math.min(current.firstSeen, speaker.at),
    speakCount: current.speakCount + 1,
    names: changed
      ? [...current.names, { at: speaker.at, displayName: speaker.displayName, username: speaker.username }]
      : current.names,
    places: rememberPlace(current.places, speaker.where),
  };
  return [next, ...people.filter((person) => person.hiddenId !== speaker.hiddenId)].slice(0, 400);
}

export function chatTypeLabel(type: ChatType): string {
  if (type === "channel") return "频道";
  if (type === "private") return "私聊";
  if (type === "supergroup") return "超级群";
  return "群";
}

export function viaLabel(via: Via | null): string {
  if (via === "list") return "来源名单";
  if (via === "new-private") return "新的私聊";
  return via === "new-group" ? "新的群" : "未收录";
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function sourceMatches(incoming: Pick<Incoming, "chatId" | "chatTitle" | "chatUsername">, sources: Source[]): boolean {
  return sources.some((src) => {
    const query = src.query.trim();
    const n = norm(query);
    if (query && (query === incoming.chatId || n === incoming.chatId.toLowerCase())) return true;
    if (src.resolvedId && src.resolvedId === incoming.chatId) return true;
    if (incoming.chatUsername) {
      const user = norm(incoming.chatUsername);
      if (n && n === user) return true;
      if (src.resolvedUsername && norm(src.resolvedUsername) === user) return true;
    }
    const title = incoming.chatTitle.trim().toLowerCase();
    if (n && n === title) return true;
    if (src.resolvedTitle && src.resolvedTitle.trim().toLowerCase() === title) return true;
    return false;
  });
}

export function kindLabel(kind: MediaKind): string {
  if (kind === "photo") return "图片";
  if (kind === "video") return "视频";
  if (kind === "animation") return "动图";
  return "文件";
}

function kindEnabled(kind: MediaKind, settings: Settings): boolean {
  if (kind === "photo") return settings.photos;
  if (kind === "video") return settings.videos;
  if (kind === "animation") return settings.animations;
  return settings.documents;
}

export function classify(incoming: Incoming, state: FoldState, settings: Settings): Decision {
  const where = incoming.chatTitle;
  const listed = sourceMatches(incoming, settings.sources);
  let via: Via | null = null;
  let enroll: "private" | "group" | null = null;

  if (listed) {
    via = "list";
  } else if (incoming.chatType === "private" && settings.watchNewPrivate) {
    via = "new-private";
    if (!state.enrolledPrivate.includes(incoming.chatId)) enroll = "private";
  } else if (
    (incoming.chatType === "group" || incoming.chatType === "supergroup") &&
    settings.watchNewGroups
  ) {
    via = "new-group";
    if (!state.enrolledGroup.includes(incoming.chatId)) enroll = "group";
  }

  if (!via) {
    const scope =
      incoming.chatType === "channel"
        ? "频道不在来源名单里"
        : incoming.chatType === "private"
          ? "没有打开「新的私聊」，这个人也没有单独指定"
          : "没有打开「新的群」，这个群也不在名单里";
    return {
      level: "skip",
      via: null,
      enroll: null,
      duplicateOfId: null,
      duplicateReason: null,
      title: `跳过 · ${where}`,
      detail: `${scope}。`,
    };
  }

  if (!kindEnabled(incoming.kind, settings) && !(incoming.reveal !== "open" && settings.flashes)) {
    return {
      level: "skip",
      via,
      enroll,
      duplicateOfId: null,
      duplicateReason: null,
      title: `跳过${kindLabel(incoming.kind)} · ${where}`,
      detail: `规则里没有收录${kindLabel(incoming.kind)}。`,
    };
  }

  const kept = state.items.filter((item) => item.status === "kept");
  const fileHit = kept.find((item) => item.fileUniqueId === incoming.fileUniqueId);
  if (fileHit) {
    return {
      level: "duplicate",
      via,
      enroll,
      duplicateOfId: fileHit.id,
      duplicateReason: "file",
      title: `重复文件 · ${incoming.caption || where}`,
      detail: `和「${fileHit.caption || fileHit.chatTitle}」是同一个 Telegram 文件，没有再次放进主档。`,
    };
  }

  if (settings.visualDedupe && incoming.visualHash) {
    const visualHit = kept.find(
      (item) =>
        item.visualHash.length > 0 &&
        hamming(item.visualHash, incoming.visualHash) <= settings.visualThreshold,
    );
    if (visualHit) {
      return {
        level: "duplicate",
        via,
        enroll,
        duplicateOfId: visualHit.id,
        duplicateReason: "visual",
        title: `画面相近 · ${incoming.caption || where}`,
        detail: `和「${visualHit.caption || visualHit.chatTitle}」画面几乎一样，没有再次放进主档。`,
      };
    }
  }

  return {
    level: "kept",
    via,
    enroll,
    duplicateOfId: null,
    duplicateReason: null,
    title: `收下${kindLabel(incoming.kind)} · ${incoming.caption || where}`,
    detail: `从${where}进来，依据「${viaLabel(via)}」。`,
  };
}

export function applyTalk(speaker: Speaker, state: FoldState): FoldState {
  return { ...state, people: noteSpeaker(state.people, speaker) };
}

export function applyIncoming(
  incoming: Incoming,
  state: FoldState,
  settings: Settings,
  idFactory: () => string,
  savedAt = incoming.occurredAt,
): FoldState {
  const people = noteSpeaker(state.people, {
    hiddenId: incoming.senderId,
    displayName: incoming.senderName,
    username: incoming.senderUsername,
    at: incoming.occurredAt,
    where: incoming.chatType,
  });
  const decision = classify(incoming, { ...state, people }, settings);
  const log: LogEntry = {
    id: idFactory(),
    at: incoming.occurredAt,
    level: decision.level,
    title: decision.title,
    detail: decision.detail,
    chatTitle: incoming.chatTitle,
  };
  let enrolledPrivate = state.enrolledPrivate;
  let enrolledGroup = state.enrolledGroup;
  if (decision.enroll === "private") enrolledPrivate = [...enrolledPrivate, incoming.chatId];
  if (decision.enroll === "group") enrolledGroup = [...enrolledGroup, incoming.chatId];
  const logs = [log, ...state.logs].slice(0, 300);

  if (decision.level === "skip") {
    return { ...state, people, logs, enrolledPrivate, enrolledGroup };
  }

  let preview = incoming.preview;
  let mediaUrl = incoming.mediaUrl;
  if (decision.duplicateOfId && (!preview || !mediaUrl)) {
    const orig = state.items.find((item) => item.id === decision.duplicateOfId);
    if (orig) {
      if (!preview) preview = orig.preview;
      if (!mediaUrl) mediaUrl = orig.mediaUrl;
    }
  }

  const item: ArchiveItem = {
    ...incoming,
    preview,
    mediaUrl,
    id: idFactory(),
    savedAt,
    status: decision.level === "kept" ? "kept" : "duplicate",
    duplicateOfId: decision.duplicateOfId,
    duplicateReason: decision.duplicateReason,
    via: decision.via,
  };
  const row: HistoryRow = {
    id: idFactory(),
    at: incoming.occurredAt,
    hiddenId: incoming.senderId,
    displayName: incoming.senderName,
    username: incoming.senderUsername,
    kind: incoming.kind,
    reveal: incoming.reveal,
    caption: incoming.caption,
    chatTitle: incoming.chatTitle,
    chatId: incoming.chatId,
    chatType: incoming.chatType,
    status: item.status,
    fileUniqueId: incoming.fileUniqueId,
    preview,
    archiveId: item.id,
  };

  return {
    items: [item, ...state.items].slice(0, 400),
    logs,
    enrolledPrivate,
    enrolledGroup,
    people,
    history: [row, ...state.history].slice(0, 500),
  };
}

export function fold(steps: Incoming[], settings: Settings, talks: Speaker[] = []): FoldState {
  let n = 0;
  const nextId = () => {
    n += 1;
    return `rec-${n}`;
  };
  const events: { at: number; apply: (state: FoldState) => FoldState }[] = [
    ...talks.map((talk) => ({
      at: talk.at,
      apply: (state: FoldState) => applyTalk(talk, state),
    })),
    ...steps.map((step) => ({
      at: step.occurredAt,
      apply: (state: FoldState) => applyIncoming(step, state, settings, nextId),
    })),
  ];
  events.sort((a, b) => a.at - b.at);
  return events.reduce((state, event) => event.apply(state), emptyFold());
}
