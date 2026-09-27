import { Download, Play, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { readAdminToken } from "@/lib/secretary/gate.middleware";
import { Button } from "@/components/secretary/bits";
import {
  chatTypeLabel,
  formatBytes,
  formatDuration,
  formatStamp,
  kindLabel,
  revealLabel,
  viaLabel,
} from "@/lib/secretary/logic";
import { useSecretary, type ArchiveFilter } from "@/lib/secretary/store";
import type { ArchiveItem } from "@/lib/secretary/types";

const FILTERS: { id: ArchiveFilter; label: string }[] = [
  { id: "kept", label: "主档" },
  { id: "duplicate", label: "重复" },
  { id: "photo", label: "图片" },
  { id: "video", label: "视频" },
  { id: "all", label: "全部" },
];

function matches(item: ArchiveItem, filter: ArchiveFilter, query: string): boolean {
  if (filter === "kept" && item.status !== "kept") return false;
  if (filter === "duplicate" && item.status !== "duplicate") return false;
  if (filter === "photo" && item.kind !== "photo") return false;
  if (filter === "video" && item.kind !== "video") return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${item.caption} ${item.chatTitle} ${item.chatUsername ?? ""} ${item.fileUniqueId}`.toLowerCase();
  return hay.includes(q);
}

export function ArchivePanel() {
  const items = useSecretary((s) => s.items);
  const filter = useSecretary((s) => s.filter);
  const query = useSecretary((s) => s.query);
  const selectedId = useSecretary((s) => s.selectedId);
  const token = useSecretary((s) => s.settings.token);
  const tokenOnFile = useSecretary((s) => s.tokenOnFile);
  const visible = useMemo(
    () => items.filter((item) => matches(item, filter, query)),
    [items, filter, query],
  );
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const onlyDrill = items.length > 0 && items.every((item) => item.origin === "drill");

  return (
    <div>
      {onlyDrill && !token.trim() && !tokenOnFile && (
        <p className="mb-5 max-w-3xl text-sm text-pretty text-muted">
          下面是演练样本，去重和来源规则已经按真消息走了一遍。贴上 Bot Token
          并开始监听后，会改收电报频道和新聊天里的原件。
        </p>
      )}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => useSecretary.setState({ filter: item.id })}
              className={
                filter === item.id
                  ? "min-h-11 shrink-0 rounded-full bg-ink px-4 text-sm text-paper"
                  : "min-h-11 shrink-0 rounded-full border border-line bg-sheet px-4 text-sm text-ink"
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <span className="sr-only">搜索档案</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(event) => useSecretary.setState({ query: event.target.value })}
            placeholder="搜标题或聊天"
            className="h-11 w-full rounded-full border border-line bg-sheet pr-4 pl-10 text-sm outline-none focus:border-ink"
          />
        </label>
      </div>
      {visible.length === 0 ? (
        <EmptyArchive hasAny={items.length > 0} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => (
            <li key={item.id}>
              <Card item={item} />
            </li>
          ))}
        </ul>
      )}
      {selected && <Detail item={selected} />}
    </div>
  );
}

function EmptyArchive({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-sheet px-6 py-16 text-center">
      <p className="font-serif text-2xl text-balance">
        {hasAny ? "这个筛选下没有记录" : "档案还是空的"}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-pretty text-muted">
        {hasAny
          ? "换一个筛选，或者把搜索清掉。"
          : "跑一轮演练看看去重，或者在规则里接上机器人，开始收图片和视频。"}
      </p>
    </div>
  );
}

function Card({ item }: { item: ArchiveItem }) {
  const duplicate = item.status === "duplicate";
  return (
    <button
      type="button"
      onClick={() => useSecretary.getState().select(item.id)}
      className="w-full overflow-hidden rounded-3xl border border-line bg-sheet text-left"
    >
      <div className="relative frame bg-paper">
        {item.preview ? (
          <img src={item.preview} alt={item.caption || item.chatTitle} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-end p-4">
            <p className="font-serif text-2xl text-balance">{item.caption || kindLabel(item.kind)}</p>
          </div>
        )}
        {(item.kind === "video" || item.kind === "animation") && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-rail px-2.5 py-1 text-xs text-rail-fg">
            <Play className="size-3" aria-hidden="true" />
            {item.duration ? formatDuration(item.duration) : kindLabel(item.kind)}
          </span>
        )}
        {item.reveal !== "open" && (
          <span className="seal-mark absolute top-3 left-3 px-2 py-1 text-xs">{revealLabel(item.reveal)}</span>
        )}
        {duplicate && <span className="seal-mark absolute top-3 right-3 px-2 py-1 text-xs">重复</span>}
      </div>
      <div className="space-y-1 px-4 py-3">
        <p className="truncate font-serif text-xl">{item.caption || "无标题"}</p>
        <p className="truncate text-sm text-muted">
          {item.senderName} · {item.senderId} · {formatStamp(item.occurredAt)}
        </p>
      </div>
    </button>
  );
}

function Detail({ item }: { item: ArchiveItem }) {
  const items = useSecretary((s) => s.items);
  const token = useSecretary((s) => s.settings.token);
  const tokenOnFile = useSecretary((s) => s.tokenOnFile);
  const original = item.duplicateOfId ? items.find((row) => row.id === item.duplicateOfId) : null;
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [fullError, setFullError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setFullUrl(null);
    setFullError(null);
    setLoading(false);
  }, [item.id]);

  useEffect(() => {
    return () => {
      if (fullUrl?.startsWith("blob:")) URL.revokeObjectURL(fullUrl);
    };
  }, [fullUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") useSecretary.getState().select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

          const isMotion = item.kind === "video" || item.kind === "animation";
          const playable = fullUrl || item.mediaUrl;
          const still = !isMotion ? fullUrl || item.preview : item.preview;

  async function loadOriginal() {
    setLoading(true);
    setFullError(null);
    try {
      const bearer = readAdminToken();
      const res = await fetch("/api/telegram-file", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ fileId: item.fileId }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "原件没有拉下来";
        throw new Error(message);
      }
      const blob = await res.blob();
      setFullUrl(URL.createObjectURL(blob));
    } catch (error) {
      setFullError(error instanceof Error ? error.message : "原件没有拉下来");
    } finally {
      setLoading(false);
    }
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(item.fileUniqueId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/40" onClick={() => useSecretary.getState().select(null)}>
      <article
        className="h-full w-full overflow-y-auto bg-sheet sm:max-w-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <p className="text-sm text-muted">{item.status === "kept" ? "主档" : "重复记录"}</p>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => useSecretary.getState().select(null)}
            className="grid size-11 place-items-center rounded-full border border-line"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 pb-8">
          {isMotion && playable ? (
            <video
              key={playable}
              src={playable}
              poster={item.preview || undefined}
              controls
              playsInline
              className="w-full rounded-2xl bg-rail"
            />
          ) : still ? (
            <img src={still} alt={item.caption || item.chatTitle} className="w-full rounded-2xl" />
          ) : (
            <div className="grid frame place-items-center rounded-2xl bg-paper px-6">
              <p className="font-serif text-2xl text-balance">{item.caption || "没有预览"}</p>
            </div>
          )}
          <h3 className="mt-5 font-serif text-3xl text-balance">{item.caption || "无标题"}</h3>
          <p className="mt-2 text-sm text-muted">
            {item.chatTitle}
            {item.chatUsername ? ` · @${item.chatUsername}` : ""} · {chatTypeLabel(item.chatType)}
          </p>
          <dl className="mt-5 space-y-3 text-sm">
            <Row k="说话的人" v={item.senderName} />
            <Row k="隐藏 ID" v={item.senderId} />
            <Row k="当时用户名" v={item.senderUsername ? `@${item.senderUsername}` : "没有"} />
            <Row k="形态" v={revealLabel(item.reveal)} />
            <Row k="类型" v={kindLabel(item.kind)} />
            <Row k="依据" v={viaLabel(item.via)} />
            <Row k="来源" v={item.origin === "drill" ? "演练" : "电报"} />
            {item.width > 0 && <Row k="尺寸" v={`${item.width} × ${item.height}`} />}
            {item.duration !== null && <Row k="时长" v={formatDuration(item.duration)} />}
            {item.bytes !== null && <Row k="大小" v={formatBytes(item.bytes)} />}
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted">文件指纹</dt>
              <dd className="max-w-xs text-right break-all">{item.fileUniqueId}</dd>
            </div>
          </dl>
          {item.status === "duplicate" && (
            <p className="mt-4 text-sm text-pretty text-muted">
              {item.duplicateReason === "visual"
                ? "画面和已收录的一条几乎一样，所以没有再进主档。"
                : "Telegram 判定这是同一个文件，所以没有再进主档。"}
              {original ? ` 先收到的是「${original.caption || original.chatTitle}」。` : ""}
            </p>
          )}
          {original && (
            <Button className="mt-3" onClick={() => useSecretary.getState().select(original.id)}>
              查看先收到的那条
            </Button>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button tone="ghost" onClick={() => void copyId()}>
              {copied ? "已复制" : "复制指纹"}
            </Button>
            {item.origin === "live" && (token.trim() || tokenOnFile) && (
              <Button tone="ink" onClick={() => void loadOriginal()} disabled={loading}>
                <Download className="size-4" />
                {loading ? "正在取原件" : "查看原件"}
              </Button>
            )}
          </div>
          {fullError && <p className="mt-3 text-sm text-seal">{fullError}</p>}
        </div>
      </article>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
