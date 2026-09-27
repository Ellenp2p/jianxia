import { Archive, Radio, ScrollText, SlidersHorizontal, Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { ArchivePanel } from "@/components/secretary/archive-panel";
import { Button } from "@/components/secretary/bits";
import { LedgerPanel } from "@/components/secretary/ledger-panel";
import { RulesPanel } from "@/components/secretary/rules-panel";
import { PeoplePanel } from "@/components/secretary/people-panel";
import { DRILL, DRILL_TALKS } from "@/lib/secretary/drill";
import { armDesk, disarmDesk, loadDesk, saveDesk } from "@/lib/secretary/desk.functions";
import { clearAdminToken } from "@/lib/secretary/gate.middleware";
import { pullTelegram, uid } from "@/lib/secretary/live";
import type { Snapshot } from "@/lib/secretary/snapshot";
import { cn } from "@/lib/cn";
import { useSecretary, type DeskView } from "@/lib/secretary/store";

const NAV: { id: DeskView; label: string; icon: typeof Archive }[] = [
  { id: "archive", label: "归档", icon: Archive },
  { id: "people", label: "人物", icon: Users },
  { id: "ledger", label: "流水", icon: ScrollText },
  { id: "rules", label: "规则", icon: SlidersHorizontal },
];

export function SecretaryDesk() {
  const view = useSecretary((s) => s.view);
  const listening = useSecretary((s) => s.listening);
  const drillRunning = useSecretary((s) => s.drillRunning);
  const token = useSecretary((s) => s.settings.token);
  const items = useSecretary((s) => s.items);
  const lastError = useSecretary((s) => s.lastError);
  const ready = useSecretary((s) => s.ready);
  const serverListening = useSecretary((s) => s.serverListening);
  const peopleCount = useSecretary((s) => s.people.length);
  const kept = items.filter((item) => item.status === "kept").length;
  const dups = items.filter((item) => item.status === "duplicate").length;
  const stopDrill = useRef(false);

  const echo = useRef(false);

  function applySnapshot(snap: Snapshot) {
    echo.current = true;
    useSecretary.setState({
      settings: snap.settings,
      items: snap.items,
      logs: snap.logs,
      enrolledPrivate: snap.enrolledPrivate,
      enrolledGroup: snap.enrolledGroup,
      people: snap.people,
      history: snap.history,
      updateOffset: snap.updateOffset,
      botName: snap.botName,
      botUsername: snap.botUsername,
      revision: snap.revision,
      tokenOnFile: snap.tokenOnFile,
      serverListening: snap.serverListening,
      ready: true,
      listening: snap.serverListening ? false : useSecretary.getState().listening,
    });
    echo.current = false;
  }

  useEffect(() => {
    try {
      window.localStorage.removeItem("jianxia-v2");
    } catch {
      /* the old copy may already be gone */
    }
    let stop = false;
    let flight = false;
    let again = false;
    void loadDesk()
      .then((snap) => {
        if (!stop) applySnapshot(snap);
      })
      .catch((error: unknown) => {
        if (!stop) {
          useSecretary.setState({
            ready: true,
            lastError: error instanceof Error ? error.message : "档案没有取回来",
          });
        }
      });
    async function push() {
      const state = useSecretary.getState();
      if (!state.ready) return;
      if (flight) {
        again = true;
        return;
      }
      flight = true;
      try {
        const saved = await saveDesk({
          data: {
            revision: state.revision,
            settings: state.settings,
            items: state.items,
            logs: state.logs,
            enrolledPrivate: state.enrolledPrivate,
            enrolledGroup: state.enrolledGroup,
            people: state.people,
            history: state.history,
            updateOffset: state.updateOffset,
            botName: state.botName,
            botUsername: state.botUsername,
          },
        });
        if (!stop) applySnapshot(saved);
      } catch (error) {
        if (!stop) useSecretary.setState({ lastError: error instanceof Error ? error.message : "没有存上" });
      } finally {
        flight = false;
        if (again && !stop) {
          again = false;
          void push();
        }
      }
    }
    let timer = 0;
    const unsub = useSecretary.subscribe((state, prev) => {
      if (echo.current || !state.ready || !prev) return;
      const changed =
        state.items !== prev.items ||
        state.logs !== prev.logs ||
        state.people !== prev.people ||
        state.history !== prev.history ||
        state.settings !== prev.settings ||
        state.updateOffset !== prev.updateOffset ||
        state.enrolledPrivate !== prev.enrolledPrivate ||
        state.enrolledGroup !== prev.enrolledGroup ||
        state.botName !== prev.botName ||
        state.botUsername !== prev.botUsername;
      if (!changed) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void push(), 600);
    });
    return () => {
      stop = true;
      unsub();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!serverListening) return;
    let stop = false;
    const timer = window.setInterval(() => {
      void loadDesk()
        .then((snap) => {
          if (!stop) applySnapshot(snap);
        })
        .catch(() => undefined);
    }, 6000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [serverListening]);

  useEffect(() => {
    if (!listening || serverListening) return;
    let cancel = false;
    let timer = 0;
    const tick = async () => {
      if (cancel) return;
      const previous = useSecretary.getState().lastError;
      try {
        await pullTelegram();
        if (!cancel) useSecretary.setState({ lastError: null, lastPullAt: Date.now() });
      } catch (error) {
        const message = error instanceof Error ? error.message : "拉取失败";
        if (!cancel) {
          useSecretary.setState({ lastError: message });
          if (previous !== message) {
            useSecretary.getState().addLog({
              id: uid("log"),
              at: Date.now(),
              level: "error",
              title: "拉取失败",
              detail: message,
              chatTitle: "",
            });
          }
        }
      }
      if (!cancel) timer = window.setTimeout(() => void tick(), 4000);
    };
    void tick();
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [listening, token, serverListening]);

  function startListening() {
    const state = useSecretary.getState();
    if (state.serverListening) {
      useSecretary.setState({ lastError: "已经交给服务器了，页面不用再拉。" });
      return;
    }
    if (!state.tokenOnFile && !state.settings.token.trim()) {
      useSecretary.setState({
        view: "rules",
        lastError: "先在规则里贴上 Bot Token。",
      });
      return;
    }
    useSecretary.getState().addLog({
      id: uid("log"),
      at: Date.now(),
      level: "info",
      title: "开始监听",
      detail: "这个页面开着时，会每隔几秒向 Telegram 拉取新消息。",
      chatTitle: "",
    });
    useSecretary.setState({ listening: true, lastError: null });
  }

  async function handToServer() {
    if (useSecretary.getState().serverListening) {
      try {
        applySnapshot(await disarmDesk());
        useSecretary.setState({ lastError: null });
      } catch (error) {
        useSecretary.setState({ lastError: error instanceof Error ? error.message : "没有停下来" });
      }
      return;
    }
    const state = useSecretary.getState();
    if (!state.tokenOnFile && !state.settings.token.trim()) {
      useSecretary.setState({ view: "rules", lastError: "先在规则里贴上 Bot Token。" });
      return;
    }
    useSecretary.setState({ listening: false });
    try {
      applySnapshot(await armDesk({ data: { origin: window.location.origin } }));
      useSecretary.setState({ lastError: null });
    } catch (error) {
      useSecretary.setState({ lastError: error instanceof Error ? error.message : "没有交给服务器" });
    }
  }

  async function runDrill() {
    if (useSecretary.getState().drillRunning) {
      stopDrill.current = true;
      useSecretary.setState({ drillRunning: false });
      return;
    }
    stopDrill.current = false;
    useSecretary.getState().prepareDrill();
    useSecretary.getState().addLog({
      id: uid("log"),
      at: Date.now(),
      level: "info",
      title: "演练开始",
      detail: "按当前规则重放一轮样本，并记下每个人的隐藏 ID、名字和闪照。",
      chatTitle: "",
    });
    const events = [
      ...DRILL_TALKS.map((talk) => ({ at: talk.at, talk, step: null })),
      ...DRILL.map((step) => ({ at: step.occurredAt, talk: null, step })),
    ].sort((a, b) => a.at - b.at);
    for (const event of events) {
      if (stopDrill.current) return;
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      if (stopDrill.current) return;
      if (event.talk) useSecretary.getState().noteTalk(event.talk);
      if (event.step) useSecretary.getState().ingest(event.step);
    }
    if (stopDrill.current) return;
    useSecretary.getState().addLog({
      id: uid("log"),
      at: Date.now(),
      level: "info",
      title: "演练结束",
      detail: "改一下规则再跑，跳过和去重会跟着变。",
      chatTitle: "",
    });
    useSecretary.setState({ drillRunning: false });
  }

  const titles: Record<DeskView, string> = {
    archive: "归档",
    people: "人物",
    ledger: "流水",
    rules: "规则",
  };

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="lg:flex">
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:bg-rail lg:px-5 lg:py-6 lg:text-rail-fg">
          <Brand />
          <nav className="mt-8 flex flex-col gap-1">
            {NAV.map((item) => (
              <NavButton key={item.id} item={item} current={view} />
            ))}
          </nav>
          <dl className="mt-auto space-y-3 border-t border-rail-fg/15 pt-5 text-sm">
            <Stat k="主档" v={String(kept)} />
            <Stat k="去掉的重复" v={String(dups)} />
            <Stat k="人物" v={String(peopleCount)} />
          </dl>
        </aside>
        <div className="min-w-0 flex-1 pb-24 lg:pb-0">
          <header className="sticky top-0 z-20 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur-sm lg:px-8">
            <div className="flex items-center justify-between gap-3 lg:hidden">
              <Brand light />
              <ListenDot
                on={listening || serverListening}
                label={serverListening ? "服务器在听" : listening ? "正在听" : "未监听"}
                className="inline-flex lg:hidden"
              />
              <button
                type="button"
                onClick={() => {
                  clearAdminToken();
                  window.location.reload();
                }}
                className="min-h-11 rounded-full px-3 text-sm text-muted"
              >
                退出
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between lg:mt-0">
              <div>
                <h1 className="sr-only">笺匣，电报秘书</h1>
                <p className="hidden text-sm text-muted lg:block">电报秘书</p>
                <h2 className="font-serif text-3xl text-balance">{titles[view]}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ListenDot
                  on={listening || serverListening}
                  label={serverListening ? "服务器在听" : listening ? "正在听" : "未监听"}
                  className="hidden lg:inline-flex"
                />
                {serverListening ? (
                  <Button tone="ink" onClick={() => void handToServer()}>
                    停止服务器
                  </Button>
                ) : listening ? (
                  <Button tone="ink" onClick={() => useSecretary.setState({ listening: false })}>
                    停止监听
                  </Button>
                ) : (
                  <Button tone="seal" onClick={startListening}>
                    <Radio className="size-4" />
                    开始监听
                  </Button>
                )}
                {!serverListening && (
                  <Button onClick={() => void handToServer()}>交给服务器</Button>
                )}
                <Button onClick={() => void runDrill()}>{drillRunning ? "停止演练" : "跑一轮演练"}</Button>
                <Button tone="ghost" onClick={exportArchive}>
                  导出记录
                </Button>
              </div>
            </div>
            {lastError && <p className="mt-3 text-sm text-pretty text-seal">{lastError}</p>}
          </header>
          <main className="px-4 py-5 lg:px-8 lg:py-6">
            {!ready ? (
              <p className="text-sm text-muted">正在从服务器取回你的档案。</p>
            ) : (
              <>
                {view === "archive" && <ArchivePanel />}
                {view === "people" && <PeoplePanel />}
                {view === "ledger" && <LedgerPanel />}
                {view === "rules" && <RulesPanel />}
              </>
            )}
          </main>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-sheet lg:hidden">
        <ul className="grid grid-cols-4">
          {NAV.map((item) => {
            const Icon = item.icon;
            const on = view === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => useSecretary.setState({ view: item.id })}
                  className={on ? "flex min-h-14 w-full flex-col items-center justify-center gap-1 text-seal" : "flex min-h-14 w-full flex-col items-center justify-center gap-1 text-muted"}
                >
                  <Icon className="size-5" />
                  <span className="text-xs">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-11 place-items-center rounded-lg bg-seal font-serif text-xl text-seal-ink">匣</div>
      <div>
        <p className={light ? "font-serif text-xl" : "font-serif text-xl text-rail-fg"}>笺匣</p>
        {light ? (
          <p className="text-sm text-muted">电报秘书</p>
        ) : (
          <p className="text-sm text-rail-muted">替你收下图片和视频</p>
        )}
      </div>
    </div>
  );
}

function NavButton({ item, current }: { item: (typeof NAV)[number]; current: DeskView }) {
  const Icon = item.icon;
  const on = current === item.id;
  return (
    <button
      type="button"
      onClick={() => useSecretary.setState({ view: item.id })}
      className={
        on
          ? "flex min-h-11 items-center gap-3 rounded-2xl bg-rail-fg/10 px-3 text-left text-rail-fg"
          : "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-left text-rail-muted"
      }
    >
      <Icon className="size-4" />
      {item.label}
    </button>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-rail-muted">{k}</dt>
      <dd className="font-serif text-xl text-rail-fg tabular-nums">{v}</dd>
    </div>
  );
}

function ListenDot({ on, label, className }: { on: boolean; label: string; className: string }) {
  return (
    <span className={cn("items-center gap-2 text-sm text-muted", className)}>
      <span className={on ? "seal-pulse size-2 rounded-full bg-seal" : "size-2 rounded-full bg-line"} />
      {label}
    </span>
  );
}

function exportArchive() {
  const { items, logs, settings, enrolledPrivate, enrolledGroup, people, history } = useSecretary.getState();
  const payload = {
    exportedAt: new Date().toISOString(),
    settings: { ...settings, token: settings.token ? "已隐藏" : "" },
    enrolledPrivate,
    enrolledGroup,
    people,
    history: history.map((row) => ({
      ...row,
      preview: row.preview.startsWith("data:") ? "" : row.preview,
    })),
    items: items.map((item) => ({
      ...item,
      preview: item.preview.startsWith("data:") ? "" : item.preview,
    })),
    logs,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "jianxia-archive.json";
  link.click();
  URL.revokeObjectURL(url);
}
