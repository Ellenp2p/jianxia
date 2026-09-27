import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SecretaryDesk } from "@/components/secretary/desk";
import { gateChallenge, gateFinish, gateSetup, gateStatus, gateWidget } from "@/lib/secretary/gate.functions";
import { clearAdminToken, readAdminToken, writeAdminToken } from "@/lib/secretary/gate.middleware";

export const Route = createFileRoute("/")({ component: Home });

type Phase = "loading" | "setup" | "login" | "denied" | "app";

function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [botUsername, setBotUsername] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [adminId, setAdminId] = useState("");
  const [link, setLink] = useState("");
  const [waiting, setWaiting] = useState(false);

  async function refresh() {
    const status = await gateStatus({ data: { token: readAdminToken() } });
    setBotUsername(status.botUsername);
    if (status.signedIn) setPhase("app");
    else if (status.needsSetup) setPhase("setup");
    else setPhase("login");
  }

  useEffect(() => {
    void refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "打不开");
      setPhase("setup");
    });
  }, []);

  useEffect(() => {
    if (phase !== "login" || !botUsername) return;
    const host = document.getElementById("tg-login");
    if (!host) return;
    host.replaceChildren();
    const win = window as Window & { onTelegramAuth?: (user: Record<string, string>) => void };
    win.onTelegramAuth = (user) => {
      void gateWidget({ data: user })
        .then((result) => {
          if (!result.ok || !("session" in result)) {
            clearAdminToken();
            setPhase("denied");
            return;
          }
          writeAdminToken(result.session);
          setPhase("app");
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : "登录失败");
        });
    };
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    host.appendChild(script);
  }, [phase, botUsername]);

  async function saveSetup() {
    setError("");
    try {
      const saved = await gateSetup({ data: { token, adminId } });
      setBotUsername(saved.botUsername);
      setToken("");
      setPhase("login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没保存");
    }
  }

  async function startLogin() {
    setError("");
    setWaiting(true);
    try {
      const challenge = await gateChallenge();
      setLink(challenge.url);
      setBotUsername(challenge.botUsername);
      for (let i = 0; i < 40; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const result = await gateFinish();
        if (result.ok && "session" in result) {
          writeAdminToken(result.session);
          setPhase("app");
          return;
        }
        if (!result.ok && result.reason === "not-admin") {
          clearAdminToken();
          setPhase("denied");
          return;
        }
      }
      setError("还没收到 Telegram 的确认。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setWaiting(false);
    }
  }

  if (phase === "app") return <SecretaryDesk />;
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 text-ink">
      <div className="w-full max-w-sm">
        <p className="font-serif text-3xl">笺匣</p>
        <p className="mt-2 text-sm text-pretty text-muted">用 Telegram 登录。只有管理员那个号能看到档案，别的号什么都不返回。</p>
        {phase === "loading" && <p className="mt-6 text-sm text-muted">正在确认登录。</p>}
        {phase === "setup" && (
          <div className="mt-6 space-y-3">
            <label className="block text-sm">
              Bot Token
              <input value={token} onChange={(event) => setToken(event.target.value)} className="mt-1 min-h-11 w-full rounded-2xl border border-line bg-sheet px-3" autoComplete="off" />
            </label>
            <label className="block text-sm">
              管理员数字 ID
              <input value={adminId} onChange={(event) => setAdminId(event.target.value)} inputMode="numeric" className="mt-1 min-h-11 w-full rounded-2xl border border-line bg-sheet px-3" />
            </label>
            <button type="button" onClick={() => void saveSetup()} className="min-h-11 w-full rounded-full bg-ink px-4 text-sm text-paper">
              保存管理员
            </button>
          </div>
        )}
        {phase === "login" && (
          <div className="mt-6 space-y-4">
            <div id="tg-login" />
            <button type="button" onClick={() => void startLogin()} disabled={waiting} className="min-h-11 w-full rounded-full bg-seal px-4 text-sm text-seal-ink">
              {waiting ? "等 Telegram 确认" : "打开 Telegram 登录"}
            </button>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className="block text-sm text-seal">
                如果按钮没反应，点这里去私聊机器人
              </a>
            )}
            <button type="button" onClick={() => setPhase("setup")} className="text-sm text-muted">
              改管理员 ID
            </button>
          </div>
        )}
        {phase === "denied" && (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-pretty">这个 Telegram 不是管理员，不返回档案。</p>
            <button type="button" onClick={() => setPhase("login")} className="min-h-11 rounded-full border border-line bg-sheet px-4 text-sm">
              换一个号
            </button>
          </div>
        )}
        {error && <p className="mt-4 text-sm text-pretty text-seal">{error}</p>}
      </div>
    </main>
  );
}
