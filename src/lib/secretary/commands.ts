import { formatStamp, kindLabel, revealLabel } from "./logic.ts";
import type { ChatType, HistoryRow, Person } from "./types.ts";

export type Scope = "all" | "private" | "group" | "channel";
export type When = "all" | "today" | "yesterday" | "week" | "month";

export type ViewQuery = {
  scope: Scope;
  when: When;
  flashOnly: boolean;
  text: string;
  page: number;
};

export const OPEN_QUERY: ViewQuery = {
  scope: "all",
  when: "all",
  flashOnly: false,
  text: "",
  page: 1,
};

const PAGE = 8;
const SHIFT = 8 * 60 * 60 * 1000;

type Window = { from: number; to: number };

function zonedParts(ts: number) {
  const d = new Date(ts + SHIFT);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}

function startOfDay(now: number): number {
  const z = zonedParts(now);
  return Date.UTC(z.y, z.m, z.day) - SHIFT;
}

export function timeWindow(when: When, now: number): Window | null {
  if (when === "all") return null;
  const start = startOfDay(now);
  if (when === "today") return { from: start, to: start + 86_400_000 };
  if (when === "yesterday") return { from: start - 86_400_000, to: start };
  if (when === "week") return { from: now - 7 * 86_400_000, to: Number.POSITIVE_INFINITY };
  const z = zonedParts(now);
  return { from: Date.UTC(z.y, z.m, 1) - SHIFT, to: Date.UTC(z.y, z.m + 1, 1) - SHIFT };
}

function inWindow(at: number, when: When, now: number): boolean {
  const window = timeWindow(when, now);
  if (!window) return true;
  return at >= window.from && at < window.to;
}

function overlaps(start: number, end: number, when: When, now: number): boolean {
  const window = timeWindow(when, now);
  if (!window) return true;
  return end >= window.from && start < window.to;
}

export function historyScope(row: HistoryRow): Exclude<Scope, "all"> {
  const type: ChatType | undefined = row.chatType;
  if (type === "private") return "private";
  if (type === "group" || type === "supergroup") return "group";
  if (type === "channel") return "channel";
  if (row.chatId.startsWith("-100")) return "channel";
  if (row.chatId.startsWith("-")) return "group";
  return "private";
}

function personScopes(person: Person, history: HistoryRow[]): Set<Exclude<Scope, "all">> {
  const set = new Set<Exclude<Scope, "all">>();
  for (const place of person.places ?? []) {
    if (place === "private") set.add("private");
    else if (place === "channel") set.add("channel");
    else set.add("group");
  }
  for (const row of history) {
    if (row.hiddenId === person.hiddenId) set.add(historyScope(row));
  }
  return set;
}

function blob(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => !!part).join(" ").toLowerCase();
}

export function matchHistory(row: HistoryRow, query: ViewQuery, now: number): boolean {
  if (query.flashOnly && row.reveal === "open") return false;
  if (query.scope !== "all" && historyScope(row) !== query.scope) return false;
  if (!inWindow(row.at, query.when, now)) return false;
  const needle = query.text.trim().toLowerCase();
  if (!needle) return true;
  return blob([row.caption, row.displayName, row.username, row.hiddenId, row.chatTitle, row.chatId]).includes(needle);
}

export function matchPerson(person: Person, history: HistoryRow[], query: ViewQuery, now: number): boolean {
  if (query.flashOnly) {
    return history.some((row) => row.hiddenId === person.hiddenId && matchHistory(row, query, now));
  }
  if (!overlaps(person.firstSeen, person.lastSeen, query.when, now)) return false;
  if (query.scope !== "all" && !personScopes(person, history).has(query.scope)) return false;
  const needle = query.text.trim().toLowerCase();
  if (!needle) return true;
  const names = person.names.flatMap((snap) => [snap.displayName, snap.username ?? ""]);
  return blob([person.displayName, person.username, person.hiddenId, ...names]).includes(needle);
}

function scopeLabel(scope: Scope): string {
  if (scope === "private") return "私聊";
  if (scope === "group") return "群聊";
  if (scope === "channel") return "频道";
  return "全部";
}

function whenLabel(when: When): string {
  if (when === "today") return "今天";
  if (when === "yesterday") return "昨天";
  if (when === "week") return "近7天";
  if (when === "month") return "本月";
  return "全部时间";
}

export function describeQuery(query: ViewQuery): string {
  const bits = [scopeLabel(query.scope), whenLabel(query.when)];
  if (query.flashOnly) bits.push("闪照");
  if (query.text.trim()) bits.push(query.text.trim());
  return bits.join(" · ");
}

function pageOf<T>(rows: T[], page: number): { slice: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * PAGE;
  return { slice: rows.slice(start, start + PAGE), page: current, pages };
}

export function peopleReply(people: Person[], history: HistoryRow[], query: ViewQuery, now: number): string {
  const matched = people.filter((person) => matchPerson(person, history, query, now));
  const { slice, page, pages } = pageOf(matched, query.page);
  const lines = [`人物 · ${describeQuery(query)}`, `共 ${matched.length} 人，第 ${page}/${pages} 页`, ""];
  if (slice.length === 0) lines.push("这个筛选下没有人。");
  for (const person of slice) {
    const user = person.username ? `@${person.username}` : "没有用户名";
    lines.push(`${person.displayName} ${user}`);
    lines.push(`隐藏 ID ${person.hiddenId} · 说过 ${person.speakCount} 次 · 最近 ${formatStamp(person.lastSeen)}`);
    const names = person.names.map((snap) => `${snap.displayName}${snap.username ? ` @${snap.username}` : ""}`).join(" → ");
    lines.push(names);
    lines.push("");
  }
  if (page < pages) lines.push(`下一页：原命令后面加 页${page + 1}`);
  return lines.join("\n").trim();
}

export function historyReply(history: HistoryRow[], query: ViewQuery, now: number): string {
  const matched = history.filter((row) => matchHistory(row, query, now));
  const { slice, page, pages } = pageOf(matched, query.page);
  const lines = [`媒体 · ${describeQuery(query)}`, `共 ${matched.length} 条，第 ${page}/${pages} 页`, ""];
  if (slice.length === 0) lines.push("这个筛选下没有照片或视频。");
  for (const row of slice) {
    const user = row.username ? `@${row.username}` : "没有用户名";
    const mark = row.reveal === "open" ? "普通" : revealLabel(row.reveal);
    const dup = row.status === "duplicate" ? " · 重复" : "";
    lines.push(`${formatStamp(row.at)} · ${scopeLabel(historyScope(row))} · ${kindLabel(row.kind)} · ${mark}${dup}`);
    lines.push(`${row.displayName} ${user} · ${row.hiddenId}`);
    lines.push(row.caption || row.chatTitle);
    lines.push("");
  }
  if (page < pages) lines.push(`下一页：原命令后面加 页${page + 1}`);
  return lines.join("\n").trim();
}

export function helpReply(): string {
  return [
    "只回复你本人的私聊。别人发来一律不回档案。页面要开着，并且正在监听。",
    "",
    "直接发中文就行，不必加斜杠：",
    "帮助",
    "我的id",
    "人 私聊 昨天",
    "谁 群 本月",
    "历史 频道 近7天 闪照",
    "记录 私聊 闪照 页2",
    "",
    "英文斜杠命令同样有效：/id /help /people /history",
  ].join("\n");
}

export function idReply(userId: string): string {
  return `你的隐藏 ID 是 ${userId}。这只是你自己的编号，不是档案。把它填进笺匣规则里的管理员之后，再发「人」或「历史」。`;
}

type CommandName = "id" | "help" | "people" | "history";

const NAMES: Record<string, CommandName> = {
  id: "id",
  我的id: "id",
  编号: "id",
  help: "help",
  start: "help",
  帮助: "help",
  命令: "help",
  怎么用: "help",
  人: "people",
  谁: "people",
  people: "people",
  人物: "people",
  史: "history",
  history: "history",
  记录: "history",
  历史: "history",
  查看: "history",
};

export function parseCommand(text: string): { name: CommandName; query: ViewQuery } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const [head, ...rest] = trimmed.split(/\s+/);
  let word = head ?? "";
  if (word.startsWith("/")) word = word.slice(1).split("@")[0] ?? "";
  word = word.toLowerCase();
  const name = NAMES[word];
  if (!name) return null;
  const query: ViewQuery = { ...OPEN_QUERY };
  const leftover: string[] = [];
  for (const token of rest) {
    const scope = takeScope(token);
    const when = takeWhen(token);
    const page = /^(?:页|p)(\d+)$/i.exec(token) ?? /^第(\d+)页$/.exec(token);
    if (scope) query.scope = scope;
    else if (when) query.when = when;
    else if (token === "闪照" || token === "遮罩" || token.toLowerCase() === "flash") query.flashOnly = true;
    else if (page?.[1]) query.page = Math.max(1, Number(page[1]));
    else leftover.push(token);
  }
  query.text = leftover.join(" ");
  return { name, query };
}

export function loginCodeOf(text: string): string | null {
  const trimmed = text.trim();
  const start = /^\/start(?:@[A-Za-z0-9_]+)?\s+login_([A-Za-z0-9]{6,12})$/i.exec(trimmed);
  if (start?.[1]) return start[1].toLowerCase();
  const word = /^(?:登录|登陆)\s+([A-Za-z0-9]{6,12})$/.exec(trimmed);
  return word?.[1]?.toLowerCase() ?? null;
}

export function answerCommand(input: {
  text: string;
  userId: string;
  adminId: string;
  people: Person[];
  history: HistoryRow[];
  now: number;
}): string | null {
  if (loginCodeOf(input.text)) return null;
  const parsed = parseCommand(input.text);
  if (!parsed) return null;
  if (parsed.name === "id") return idReply(input.userId);
  const admin = input.adminId.trim();
  if (!admin || admin !== input.userId) return null;
  if (parsed.name === "help") return helpReply();
  if (parsed.name === "people") return peopleReply(input.people, input.history, parsed.query, input.now);
  return historyReply(input.history, parsed.query, input.now);
}

function takeScope(token: string): Scope | null {
  if (token === "私聊" || token === "private" || token === "pm") return "private";
  if (token === "群" || token === "群聊" || token === "group") return "group";
  if (token === "频道" || token === "channel") return "channel";
  if (token === "全部") return "all";
  return null;
}

function takeWhen(token: string): When | null {
  if (token === "今天" || token === "today") return "today";
  if (token === "昨天" || token === "yesterday") return "yesterday";
  if (token === "7天" || token === "近7天" || token === "本周" || token === "week") return "week";
  if (token === "本月" || token === "month") return "month";
  if (token === "全部时间") return "all";
  return null;
}
