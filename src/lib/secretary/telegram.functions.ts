import { createServerFn } from "@tanstack/react-start";
import { adminMiddleware } from "./gate.middleware";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/;
const METHODS = ["getMe", "getUpdates", "getChat", "getFile", "sendMessage"] as const;
type TgMethod = (typeof METHODS)[number];

const METHOD_KEYS: Record<TgMethod, string[]> = {
  getMe: [],
  getUpdates: ["offset", "limit", "timeout", "allowed_updates"],
  getChat: ["chat_id"],
  getFile: ["file_id"],
  sendMessage: ["chat_id", "text"],
};

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };

function asJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => asJson(item));
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = asJson(item);
    }
    return out;
  }
  return null;
}

function assertToken(value: unknown): string {
  if (typeof value !== "string" || !TOKEN_RE.test(value.trim())) {
    throw new Error("Bot Token 格式不对。打开 @BotFather，用 /newbot 或 /token 复制那一串。");
  }
  return value.trim();
}

function pickPayload(method: TgMethod, raw: unknown): Record<string, unknown> {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const payload: Record<string, unknown> = {};
  for (const key of METHOD_KEYS[method]) {
    if (key in source) payload[key] = source[key];
  }
  if (method === "getUpdates") {
    payload.timeout = 0;
    const limit = typeof payload.limit === "number" ? payload.limit : 25;
    payload.limit = Math.max(1, Math.min(50, Math.floor(limit)));
    payload.allowed_updates = ["message", "channel_post"];
    if (typeof payload.offset !== "number" || payload.offset <= 0) delete payload.offset;
  }
  if (method === "sendMessage") {
    const rawId = payload.chat_id;
    const chatId = typeof rawId === "number" ? rawId : typeof rawId === "string" && /^-?\d+$/.test(rawId) ? Number(rawId) : NaN;
    const text = typeof payload.text === "string" ? payload.text.slice(0, 4000) : "";
    if (!Number.isSafeInteger(chatId)) throw new Error("聊天编号不对");
    if (!text) throw new Error("没有可发送的文字");
    return { chat_id: chatId, text, disable_web_page_preview: true };
  }
  return payload;
}

function scrub(message: string, token: string): string {
  return token ? message.split(token).join("***") : message;
}

async function callTelegram(token: string, method: TgMethod, payload: Record<string, unknown>): Promise<Json> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络失败";
    throw new Error(scrub(message, token));
  }
  const json: unknown = await response.json().catch(() => null);
  if (!json || typeof json !== "object" || !("ok" in json)) {
    throw new Error("Telegram 没有返回可识别的结果");
  }
  const body = json as { ok: boolean; description?: string; result?: unknown };
  if (!body.ok) throw new Error(body.description || "Telegram 拒绝了这次请求");
  return asJson(body.result ?? null);
}

export const telegramCall = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("请求不完整");
    const row = data as { token?: unknown; method?: unknown; payload?: unknown };
    const token = typeof row.token === "string" && row.token.trim() ? assertToken(row.token) : "";
    if (typeof row.method !== "string" || !METHODS.includes(row.method as TgMethod)) {
      throw new Error("不允许的 Telegram 方法");
    }
    const method = row.method as TgMethod;
    return { token, method, payload: pickPayload(method, row.payload) };
  })
  .handler(async ({ data }) => {
    const { readVaultToken, rememberToken, VAULT_ID } = await import("./record.server");
    if (data.token) await rememberToken(VAULT_ID, data.token);
    const token = await readVaultToken(VAULT_ID, data.method === "getUpdates");
    return callTelegram(token, data.method, data.payload);
  });

export const telegramThumb = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("请求不完整");
    const row = data as { fileId?: unknown };
    if (typeof row.fileId !== "string" || row.fileId.length < 8 || row.fileId.length > 400) {
      throw new Error("文件编号不对");
    }
    return { fileId: row.fileId };
  })
  .handler(async ({ data }) => {
    const { readVaultToken, VAULT_ID } = await import("./record.server");
    const token = await readVaultToken(VAULT_ID, false);
    const meta = await callTelegram(token, "getFile", { file_id: data.fileId });
    const row = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
    const filePath = typeof row.file_path === "string" ? row.file_path : "";
    const fileSize = typeof row.file_size === "number" ? row.file_size : 0;
    if (!filePath) return { dataUrl: null as string | null };
    if (fileSize > 180_000) return { dataUrl: null as string | null };
    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${encodeURI(filePath)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!fileRes.ok) return { dataUrl: null as string | null };
    const mime = fileRes.headers.get("content-type") || "image/jpeg";
    if (!mime.startsWith("image/")) return { dataUrl: null as string | null };
    const buf = await fileRes.arrayBuffer();
    if (buf.byteLength > 180_000) return { dataUrl: null as string | null };
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return { dataUrl: `data:${mime};base64,${btoa(binary)}` };
  });
