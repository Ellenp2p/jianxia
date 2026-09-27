import { useMemo, useState } from "react";
import {
  OPEN_QUERY,
  describeQuery,
  matchHistory,
  matchPerson,
  type Scope,
  type ViewQuery,
  type When,
} from "@/lib/secretary/commands";
import { formatStamp, kindLabel, revealLabel } from "@/lib/secretary/logic";
import { useSecretary } from "@/lib/secretary/store";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "private", label: "私聊" },
  { id: "group", label: "群聊" },
  { id: "channel", label: "频道" },
];

const WHENS: { id: When; label: string }[] = [
  { id: "all", label: "全部时间" },
  { id: "today", label: "今天" },
  { id: "yesterday", label: "昨天" },
  { id: "week", label: "近7天" },
  { id: "month", label: "本月" },
];

export function PeoplePanel() {
  const people = useSecretary((s) => s.people);
  const history = useSecretary((s) => s.history);
  const [personId, setPersonId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const [when, setWhen] = useState<When>("all");
  const [onlyFlash, setOnlyFlash] = useState(false);
  const [keyword, setKeyword] = useState("");
  const query: ViewQuery = { ...OPEN_QUERY, scope, when, flashOnly: onlyFlash, text: keyword };
  const now = Date.now();
  const shownPeople = useMemo(
    () => people.filter((person) => matchPerson(person, history, query, now)),
    [people, history, scope, when, onlyFlash, keyword],
  );
  const person = people.find((item) => item.hiddenId === personId) ?? null;
  const rows = useMemo(
    () => history.filter((row) => matchHistory(row, personId ? { ...query, text: query.text } : query, now) && (!personId || row.hiddenId === personId)),
    [history, personId, scope, when, onlyFlash, keyword],
  );

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-pretty text-muted">
        每有人开口，就按隐藏 ID 更新这一行。表面名或用户名和上次不同，会再记一笔。下面的筛选，和私聊里发「人 私聊 昨天」「历史 群 闪照」是同一套。
      </p>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((item) => (
            <Chip key={item.id} on={scope === item.id} onClick={() => setScope(item.id)}>
              {item.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {WHENS.map((item) => (
            <Chip key={item.id} on={when === item.id} onClick={() => setWhen(item.id)}>
              {item.label}
            </Chip>
          ))}
          <Chip on={onlyFlash} onClick={() => setOnlyFlash((value) => !value)}>
            只看闪照和遮罩
          </Chip>
        </div>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="名字、用户名、隐藏 ID 或标题"
          className="h-11 w-full rounded-2xl border border-line bg-sheet px-3 text-sm outline-none focus:border-ink"
        />
        <p className="text-sm text-muted">{describeQuery(query)}</p>
      </div>
      <section>
        <h3 className="mb-3 font-serif text-2xl">说话的人</h3>
        {shownPeople.length === 0 ? (
          <Empty text="这个筛选下没有人" />
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-line bg-sheet">
            <table className="w-max min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <Th>表面名</Th>
                  <Th>用户名</Th>
                  <Th>隐藏 ID</Th>
                  <Th>名字记录</Th>
                  <Th>最近</Th>
                </tr>
              </thead>
              <tbody>
                {shownPeople.map((item) => {
                  const on = item.hiddenId === personId;
                  return (
                    <tr
                      key={item.hiddenId}
                      className={on ? "bg-paper" : undefined}
                    >
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          className="min-h-11 text-left font-medium"
                          onClick={() => setPersonId(on ? null : item.hiddenId)}
                        >
                          {item.displayName}
                        </button>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{item.username ? `@${item.username}` : "没有"}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{item.hiddenId}</td>
                      <td className="px-3 py-3 tabular-nums">{item.names.length}</td>
                      <td className="px-3 py-3 whitespace-nowrap tabular-nums">{formatStamp(item.lastSeen)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {person && (
        <section>
          <h3 className="mb-1 font-serif text-2xl text-balance">{person.displayName} 的名字</h3>
          <p className="mb-3 text-sm text-muted">
            隐藏 ID {person.hiddenId}
            {person.hiddenId.startsWith("-") ? " · 这是频道或群，不是个人账号" : " · 个人账号，改用户名也不会变"}
            。说过 {person.speakCount} 次。
          </p>
          <div className="overflow-x-auto rounded-3xl border border-line bg-sheet">
            <table className="w-max min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <Th>时间</Th>
                  <Th>表面名</Th>
                  <Th>用户名</Th>
                </tr>
              </thead>
              <tbody>
                {[...person.names].reverse().map((snap) => (
                  <tr key={`${snap.at}-${snap.displayName}-${snap.username ?? ""}`} className="border-b border-line last:border-0">
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{formatStamp(snap.at)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{snap.displayName}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{snap.username ? `@${snap.username}` : "没有"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h3 className="font-serif text-2xl">{person ? `${person.displayName} 的媒体` : "全部媒体历史"}</h3>
        </div>
        {rows.length === 0 ? (
          <Empty text="这个筛选下没有照片或视频" />
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-line bg-sheet">
            <table className="w-max min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <Th>时间</Th>
                  <Th>隐藏 ID</Th>
                  <Th>表面名</Th>
                  <Th>用户名</Th>
                  <Th>类型</Th>
                  <Th>形态</Th>
                  <Th>内容</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{formatStamp(row.at)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{row.hiddenId}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{row.displayName}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{row.username ? `@${row.username}` : "没有"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{kindLabel(row.kind)}</td>
                    <td className={row.reveal === "open" ? "px-3 py-3 whitespace-nowrap" : "px-3 py-3 whitespace-nowrap text-seal"}>{revealLabel(row.reveal)}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        className="min-h-11 text-left"
                        onClick={() => {
                          useSecretary.getState().select(row.archiveId);
                          useSecretary.setState({ view: "archive" });
                        }}
                      >
                        {row.caption || "无标题"}
                        {row.status === "duplicate" ? " · 重复" : ""}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Chip({ on, children, onClick }: { on: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        on
          ? "min-h-11 rounded-full bg-ink px-4 text-sm text-paper"
          : "min-h-11 rounded-full border border-line bg-sheet px-4 text-sm"
      }
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: string }) {
  return <th className="px-3 py-3 font-medium whitespace-nowrap">{children}</th>;
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-sheet px-6 py-12 text-center">
      <p className="font-serif text-2xl">{text}</p>
    </div>
  );
}
