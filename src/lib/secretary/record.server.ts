import { getSql } from "@/lib/db";
import { answerCommand, loginCodeOf } from "./commands";
import { widgetHashOk } from "./telegram-auth";
import { newSecret, openSeal, seal, secretHash } from "./crypto.server";
import { DRILL, DRILL_TALKS } from "./drill";
import { applyIncoming, applyTalk, DEFAULT_SETTINGS, fold } from "./logic";
import { commandFromUpdate, observeUpdate } from "./parse";
import { present, shrinkPreview, tokenOk, type SecretBody, type Snapshot } from "./snapshot";
import type { ArchiveItem, HistoryRow, Settings } from "./types";

type Row = { cipher: string; version: number; webhook_hash: string | null };

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function seededBody(): SecretBody {
  const folded = fold(DRILL, DEFAULT_SETTINGS, DRILL_TALKS);
  return {
    settings: DEFAULT_SETTINGS,
    items: folded.items,
    logs: folded.logs,
    enrolledPrivate: folded.enrolledPrivate,
    enrolledGroup: folded.enrolledGroup,
    people: folded.people,
    history: folded.history,
    updateOffset: 0,
    botName: "",
    botUsername: "",
    webhookSecret: "",
    serverListening: false,
    lastUpdateId: 0,
    loginChallenge: null,
    loginGrant: null,
  };
}

function parseBody(cipher: string): SecretBody {
  const raw: unknown = JSON.parse(openSeal(cipher));
  if (!raw || typeof raw !== "object") return seededBody();
  const row = raw as Partial<SecretBody>;
  const base = seededBody();
  return {
    ...base,
    ...row,
    settings: { ...DEFAULT_SETTINGS, ...(row.settings ?? {}) },
    items: Array.isArray(row.items) ? row.items : base.items,
    logs: Array.isArray(row.logs) ? row.logs : base.logs,
    people: Array.isArray(row.people) ? row.people : base.people,
    history: Array.isArray(row.history) ? row.history : base.history,
    enrolledPrivate: Array.isArray(row.enrolledPrivate) ? row.enrolledPrivate : [],
    enrolledGroup: Array.isArray(row.enrolledGroup) ? row.enrolledGroup : [],
  };
}

async function readRow(userId: string): Promise<Row | null> {
  const sql = await getSql();
  const rows = await sql<Row>`
    select cipher, version, webhook_hash from secretary_vault where user_id = ${userId}
  `;
  return rows[0] ?? null;
}

async function insertBody(userId: string, body: SecretBody): Promise<Snapshot> {
  const sql = await getSql();
  const hash = body.webhookSecret ? secretHash(body.webhookSecret) : null;
  await sql`
    insert into secretary_vault (user_id, cipher, version, webhook_hash)
    values (${userId}, ${seal(JSON.stringify(shrinkBody(body)))}, 1, ${hash})
    on conflict (user_id) do nothing
  `;
  const row = await readRow(userId);
  if (!row) throw new Error("档案没有写进去");
  return present(parseBody(row.cipher), Number(row.version));
}

function shrinkBody(body: SecretBody): SecretBody {
  return {
    ...body,
    items: body.items.slice(0, 400).map((item) => ({ ...item, preview: shrinkPreview(item.preview) })),
    history: body.history.slice(0, 500).map((row) => ({ ...row, preview: shrinkPreview(row.preview) })),
    logs: body.logs.slice(0, 300),
    people: body.people.slice(0, 400),
  };
}

export async function loadVault(userId: string): Promise<Snapshot> {
  const row = await readRow(userId);
  if (!row) return insertBody(userId, seededBody());
  return present(parseBody(row.cipher), Number(row.version));
}

export async function readVaultToken(userId: string, polling: boolean): Promise<string> {
  const token = await tokenFor(userId);
  if (!tokenOk(token)) throw new Error("先把 Bot Token 锁进服务器");
  if (!polling) return token;
  const row = await readRow(userId);
  const body = row ? parseBody(row.cipher) : null;
  if (body?.serverListening) throw new Error("已经交给服务器，这台页面不用再拉");
  return token;
}

async function tokenFor(userId: string): Promise<string> {
  const row = await readRow(userId);
  if (!row) return "";
  return parseBody(row.cipher).settings.token.trim();
}

async function writeBody(userId: string, body: SecretBody, expected: number): Promise<boolean> {
  const sql = await getSql();
  const hash = body.serverListening && body.webhookSecret ? secretHash(body.webhookSecret) : null;
  const rows = await sql<{ version: number }>`
    update secretary_vault
    set cipher = ${seal(JSON.stringify(shrinkBody(body)))},
        version = version + 1,
        webhook_hash = ${hash},
        updated_at = now()
    where user_id = ${userId} and version = ${expected}
    returning version
  `;
  return rows.length > 0;
}

export type CommitInput = {
  revision: number;
  settings: Settings;
  items: ArchiveItem[];
  logs: SecretBody["logs"];
  enrolledPrivate: string[];
  enrolledGroup: string[];
  people: SecretBody["people"];
  history: HistoryRow[];
  updateOffset: number;
  botName: string;
  botUsername: string;
};

export async function commitVault(userId: string, input: CommitInput): Promise<Snapshot & { conflict: boolean }> {
  let row = await readRow(userId);
  if (!row) {
    const created = await insertBody(userId, seededBody());
    return { ...created, conflict: true };
  }
  if (Number(row.version) !== input.revision) {
    return { ...present(parseBody(row.cipher), Number(row.version)), conflict: true };
  }
  const current = parseBody(row.cipher);
  const incomingToken = input.settings.token.trim();
  const token = tokenOk(incomingToken) ? incomingToken : current.settings.token;
  const next: SecretBody = shrinkBody({
    ...current,
    settings: { ...input.settings, token, adminId: (input.settings.adminId ?? "").replace(/[^\d]/g, "").slice(0, 16) },
    items: input.items,
    logs: input.logs,
    enrolledPrivate: input.enrolledPrivate,
    enrolledGroup: input.enrolledGroup,
    people: input.people,
    history: input.history,
    updateOffset: current.serverListening ? current.updateOffset : input.updateOffset,
    botName: input.botName,
    botUsername: input.botUsername,
  });
  const ok = await writeBody(userId, next, input.revision);
  if (!ok) {
    row = await readRow(userId);
    if (!row) throw new Error("档案丢失了");
    return { ...present(parseBody(row.cipher), Number(row.version)), conflict: true };
  }
  return { ...present(next, input.revision + 1), conflict: false };
}

export async function rememberToken(userId: string, token: string): Promise<void> {
  const trimmed = token.trim();
  if (!tokenOk(trimmed)) throw new Error("Bot Token 格式不对。打开 @BotFather，用 /newbot 或 /token 复制那一串。");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readRow(userId);
    const body = row ? parseBody(row.cipher) : seededBody();
    const expected = row ? Number(row.version) : 0;
    body.settings = { ...body.settings, token: trimmed };
    if (!row) {
      await insertBody(userId, body);
      return;
    }
    if (await writeBody(userId, body, expected)) return;
  }
  throw new Error("Token 没锁上，请再试一次");
}

async function telegram(token: string, method: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!json || typeof json !== "object" || !("ok" in json)) throw new Error("Telegram 没有返回可识别的结果");
  const body = json as { ok: boolean; description?: string; result?: unknown };
  if (!body.ok) throw new Error((body.description || "Telegram 拒绝了这次请求").split(token).join("***"));
  return body.result ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export async function userOwnsFile(userId: string, fileId: string): Promise<string> {
  const token = await tokenFor(userId);
  if (!token) throw new Error("还没有把 Token 锁进服务器");
  const row = await readRow(userId);
  const items = row ? parseBody(row.cipher).items : [];
  if (!items.some((item) => item.fileId === fileId)) throw new Error("这个文件不在你的档案里");
  return token;
}

async function withBody(userId: string, change: (body: SecretBody) => Promise<void> | void): Promise<Snapshot> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readRow(userId);
    if (!row) {
      await insertBody(userId, seededBody());
      continue;
    }
    const body = parseBody(row.cipher);
    await change(body);
    if (await writeBody(userId, body, Number(row.version))) return present(body, Number(row.version) + 1);
  }
  throw new Error("档案正在被另一边写入，请再试一次");
}

export async function armServer(userId: string, origin: string): Promise<Snapshot> {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("这个地址不能交给 Telegram");
  }
  if (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    throw new Error("预览页面外网进不来。部署之后，在正式站点上再点「交给服务器」。");
  }
  const token = await tokenFor(userId);
  if (!token) throw new Error("先把 Bot Token 锁进服务器");
  const secret = newSecret();
  await telegram(token, "setWebhook", {
    url: `${url.origin}/api/telegram`,
    secret_token: secret,
    allowed_updates: ["message", "channel_post"],
    drop_pending_updates: false,
  });
  return withBody(userId, (body) => {
    body.webhookSecret = secret;
    body.serverListening = true;
    body.logs = [
      {
        id: uid("log"),
        at: Date.now(),
        level: "info" as const,
        title: "交给服务器了",
        detail: "页面关掉也会继续记。只有你填的那个隐藏 ID 能在私聊里查档。",
        chatTitle: "",
      },
      ...body.logs,
    ].slice(0, 300);
  });
}

export async function disarmServer(userId: string): Promise<Snapshot> {
  const token = await tokenFor(userId);
  if (token) {
    await telegram(token, "deleteWebhook", { drop_pending_updates: false }).catch(() => undefined);
  }
  return withBody(userId, (body) => {
    body.serverListening = false;
    body.webhookSecret = "";
  });
}

async function thumbDataUrl(token: string, fileId: string): Promise<string> {
  const meta = asRecord(await telegram(token, "getFile", { file_id: fileId }));
  const filePath = typeof meta?.file_path === "string" ? meta.file_path : "";
  const fileSize = typeof meta?.file_size === "number" ? meta.file_size : 0;
  if (!filePath || fileSize > 180_000) return "";
  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${encodeURI(filePath)}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!fileRes.ok) return "";
  const mime = fileRes.headers.get("content-type") || "";
  if (!mime.startsWith("image/")) return "";
  const buf = Buffer.from(await fileRes.arrayBuffer());
  if (buf.byteLength > 180_000) return "";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function acceptUpdate(userId: string, update: unknown): Promise<void> {
  const token = await tokenFor(userId);
  await withBody(userId, async (body) => {
    const row = asRecord(update);
    const updateId = typeof row?.update_id === "number" ? row.update_id : null;
    if (updateId === null || updateId <= body.lastUpdateId) return;
    body.lastUpdateId = updateId;
    const observed = observeUpdate(update);
    const command = commandFromUpdate(update);
    const login = loginAttempt(update);
    if (login) {
      const challenge = body.loginChallenge;
      const fresh = Boolean(challenge && challenge.code === login.code && challenge.exp > Date.now());
      if (fresh) {
        const admin = (body.settings.adminId ?? "").trim();
        const ok = admin.length > 0 && login.userId === admin;
        body.loginGrant = { code: login.code, userId: login.userId, ok, exp: Date.now() + 5 * 60 * 1000 };
        body.loginChallenge = null;
        if (token) {
          await telegram(token, "sendMessage", {
            chat_id: Number(login.chatId),
            text: ok ? "是管理员。回到网页就会进入笺匣。" : "不是管理员，不返回档案。",
          }).catch(() => undefined);
        }
      }
      return;
    }
    if (command && token) {
      const reply = answerCommand({
        text: command.text,
        userId: command.userId,
        adminId: body.settings.adminId ?? "",
        people: body.people,
        history: body.history,
        now: Date.now(),
      });
      if (reply) {
        await telegram(token, "sendMessage", {
          chat_id: Number(command.chatId),
          text: reply.slice(0, 4000),
          disable_web_page_preview: true,
        }).catch(() => undefined);
      }
    }
    let fold = {
      items: body.items,
      logs: body.logs,
      enrolledPrivate: body.enrolledPrivate,
      enrolledGroup: body.enrolledGroup,
      people: body.people,
      history: body.history,
    };
    for (const speaker of observed.speakers) {
      if (!observed.media || speaker.hiddenId !== observed.media.senderId) fold = applyTalk(speaker, fold);
    }
    const media = observed.media;
    if (media) {
      let preview = "";
      if (token && media.previewFileId) {
        preview = await thumbDataUrl(token, media.previewFileId).catch(() => "");
      }
      fold = applyIncoming(
        {
          ...media,
          preview,
          mediaUrl: null,
          visualHash: "",
          origin: "live",
        },
        fold,
        body.settings,
        () => uid("rec"),
        Date.now(),
      );
    }
    body.items = fold.items;
    body.logs = fold.logs;
    body.enrolledPrivate = fold.enrolledPrivate;
    body.enrolledGroup = fold.enrolledGroup;
    body.people = fold.people;
    body.history = fold.history;
  });
}

function loginAttempt(update: unknown): { code: string; userId: string; chatId: string } | null {
  const row = asRecord(update);
  const message = row ? asRecord(row.message) : null;
  if (!message) return null;
  const text = typeof message.text === "string" ? message.text : "";
  const code = loginCodeOf(text);
  if (!code) return null;
  const chat = asRecord(message.chat);
  const from = asRecord(message.from);
  if (!chat || chat.type !== "private") return null;
  const userId = typeof from?.id === "number" ? String(from.id) : "";
  const chatId = typeof chat.id === "number" ? String(chat.id) : "";
  if (!userId || userId !== chatId) return null;
  return { code, userId, chatId };
}

export async function findUserByWebhook(secret: string): Promise<string | null> {
  if (!secret || secret.length < 16 || secret.length > 256) return null;
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from secretary_vault where webhook_hash = ${secretHash(secret)}
  `;
  return rows[0]?.user_id ?? null;
}

export const VAULT_ID = "admin";

export async function readAdminId(): Promise<string> {
  const row = await readRow(VAULT_ID);
  if (!row) return "";
  return (parseBody(row.cipher).settings.adminId ?? "").trim();
}

export async function gateView(sessionId: string | null): Promise<{
  needsSetup: boolean;
  botUsername: string;
  signedIn: boolean;
}> {
  const row = await readRow(VAULT_ID);
  const body = row ? parseBody(row.cipher) : null;
  const adminId = (body?.settings.adminId ?? "").trim();
  const token = body?.settings.token.trim() ?? "";
  const ready = tokenOk(token) && /^\d{4,16}$/.test(adminId);
  return {
    needsSetup: !ready,
    botUsername: body?.botUsername ?? "",
    signedIn: Boolean(ready && sessionId && sessionId === adminId),
  };
}

export async function claimAdmin(token: string, adminId: string): Promise<{ botUsername: string }> {
  const trimmed = token.trim();
  const id = adminId.replace(/[^\d]/g, "").slice(0, 16);
  if (!tokenOk(trimmed)) throw new Error("Bot Token 格式不对");
  if (!/^\d{4,16}$/.test(id)) throw new Error("管理员要填 Telegram 的数字 ID");
  const me = asRecord(await telegram(trimmed, "getMe", {}));
  const username = typeof me?.username === "string" ? me.username : "";
  const name = typeof me?.first_name === "string" ? me.first_name : "机器人";
  const row = await readRow(VAULT_ID);
  if (!row) {
    const body = seededBody();
    body.settings = { ...body.settings, token: trimmed, adminId: id };
    body.botUsername = username;
    body.botName = name;
    await insertBody(VAULT_ID, body);
    return { botUsername: username };
  }
  const current = parseBody(row.cipher);
  if (tokenOk(current.settings.token) && current.settings.token.trim() !== trimmed) {
    throw new Error("Token 和服务器上锁着的不一致");
  }
  current.settings = { ...current.settings, token: trimmed, adminId: id };
  current.botUsername = username || current.botUsername;
  current.botName = name || current.botName;
  if (!(await writeBody(VAULT_ID, current, Number(row.version)))) throw new Error("没写上，再试一次");
  return { botUsername: current.botUsername };
}

export async function beginChallenge(): Promise<{ code: string; botUsername: string; url: string }> {
  const row = await readRow(VAULT_ID);
  if (!row) throw new Error("先填写 Bot Token 和管理员 ID");
  const current = parseBody(row.cipher);
  if (!current.botUsername) throw new Error("还不知道机器人的用户名");
  const code = Math.random().toString(36).slice(2, 10);
  current.loginChallenge = { code, exp: Date.now() + 5 * 60 * 1000 };
  current.loginGrant = null;
  if (!(await writeBody(VAULT_ID, current, Number(row.version)))) throw new Error("登录口令没生成，再试一次");
  return {
    code,
    botUsername: current.botUsername,
    url: `https://t.me/${current.botUsername}?start=login_${code}`,
  };
}

async function pullPending(): Promise<void> {
  const row = await readRow(VAULT_ID);
  if (!row) return;
  const body = parseBody(row.cipher);
  if (body.serverListening) return;
  const token = body.settings.token.trim();
  if (!tokenOk(token)) return;
  const result = await telegram(token, "getUpdates", {
    offset: body.updateOffset > 0 ? body.updateOffset : undefined,
    limit: 25,
    timeout: 0,
    allowed_updates: ["message", "channel_post"],
  });
  const updates = Array.isArray(result) ? result : [];
  let offset = body.updateOffset;
  for (const update of updates) {
    const rec = asRecord(update);
    const updateId = typeof rec?.update_id === "number" ? rec.update_id : null;
    await acceptUpdate(VAULT_ID, update);
    if (updateId !== null) offset = updateId + 1;
  }
  if (offset !== body.updateOffset) {
    await withBody(VAULT_ID, (next) => {
      next.updateOffset = offset;
    });
  }
}

export async function finishChallenge(): Promise<{ ok: true; telegramId: string } | { ok: false; reason: "wait" | "not-admin" }> {
  await pullPending().catch(() => undefined);
  const row = await readRow(VAULT_ID);
  if (!row) return { ok: false, reason: "wait" };
  const body = parseBody(row.cipher);
  const grant = body.loginGrant;
  if (!grant || grant.exp < Date.now()) return { ok: false, reason: "wait" };
  if (!grant.ok) return { ok: false, reason: "not-admin" };
  body.loginGrant = null;
  await writeBody(VAULT_ID, body, Number(row.version));
  return { ok: true, telegramId: grant.userId };
}

export async function acceptWidget(input: {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  photoUrl: string;
  authDate: string;
  hash: string;
}): Promise<{ ok: true; telegramId: string } | { ok: false; reason: "not-admin" | "bad" }> {
  const token = await tokenFor(VAULT_ID);
  const adminId = await readAdminId();
  if (!token || !adminId) return { ok: false, reason: "bad" };
  const authDate = Number(input.authDate);
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86400) return { ok: false, reason: "bad" };
  const fields: Record<string, string> = {
    id: input.id,
    first_name: input.firstName,
    last_name: input.lastName,
    username: input.username,
    photo_url: input.photoUrl,
    auth_date: input.authDate,
  };
  if (!widgetHashOk(token, fields, input.hash)) return { ok: false, reason: "bad" };
  if (input.id !== adminId) return { ok: false, reason: "not-admin" };
  return { ok: true, telegramId: input.id };
}
