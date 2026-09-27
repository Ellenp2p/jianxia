import { averageHash } from "./hash";
import { classify } from "./logic";
import { answerCommand } from "./commands";
import { mediaFromUpdate, observeUpdate, commandFromUpdate } from "./parse";
import { useSecretary } from "./store";
import { telegramCall, telegramThumb } from "./telegram.functions";
import type { ParsedMedia } from "./types";

export function uid(prefix = "id"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export async function checkBot(): Promise<void> {
  const typed = useSecretary.getState().settings.token.trim();
  const onFile = useSecretary.getState().tokenOnFile;
  if (!typed && !onFile) throw new Error("先贴上 Bot Token");
  const me = await telegramCall({
    data: { ...(typed ? { token: typed } : {}), method: "getMe", payload: {} },
  });
  const row = asRecord(me);
  const username = typeof row?.username === "string" ? row.username : "";
  const name = typeof row?.first_name === "string" ? row.first_name : "机器人";
  useSecretary.setState({ botUsername: username, botName: name, lastError: null });
  useSecretary.getState().addLog({
    id: uid("log"),
    at: Date.now(),
    level: "info",
    title: "机器人已接上",
    detail: username ? `@${username} 可以代你拉取消息了。` : "getMe 已通过。",
    chatTitle: "",
  });
}

export async function resolveSource(id: string): Promise<void> {
  const { settings, updateSource } = useSecretary.getState();
  const src = settings.sources.find((item) => item.id === id);
  if (!src) return;
  const token = settings.token.trim();
  if (!token && !useSecretary.getState().tokenOnFile) {
    updateSource(id, { status: "error", error: "先贴上 Token，再核对这个来源" });
    return;
  }
  try {
    const chat = await telegramCall({
      data: { ...(token ? { token } : {}), method: "getChat", payload: { chat_id: src.query } },
    });
    const row = asRecord(chat);
    const titleParts = [row?.title, row?.first_name, row?.last_name].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    updateSource(id, {
      status: "ok",
      error: null,
      resolvedId: typeof row?.id === "number" ? String(row.id) : null,
      resolvedTitle: titleParts[0] ?? null,
      resolvedUsername: typeof row?.username === "string" ? row.username : null,
    });
  } catch (error) {
    updateSource(id, {
      status: "error",
      error: error instanceof Error ? error.message : "核对失败",
    });
  }
}

async function ingestParsed(parsed: ParsedMedia): Promise<void> {
  const state = useSecretary.getState();
  const shell = {
    fileUniqueId: parsed.fileUniqueId,
    fileId: parsed.fileId,
    kind: parsed.kind,
    chatId: parsed.chatId,
    chatTitle: parsed.chatTitle,
    chatUsername: parsed.chatUsername,
    chatType: parsed.chatType,
    messageId: parsed.messageId,
    caption: parsed.caption,
    occurredAt: parsed.occurredAt,
    width: parsed.width,
    height: parsed.height,
    duration: parsed.duration,
    bytes: parsed.bytes,
    preview: "",
    mediaUrl: null,
    visualHash: "",
    senderId: parsed.senderId,
    senderName: parsed.senderName,
    senderUsername: parsed.senderUsername,
    reveal: parsed.reveal,
    origin: "live" as const,
  };
  const first = classify(shell, state, state.settings);
  if (first.level === "skip" || first.duplicateReason === "file") {
    state.ingest(shell, Date.now());
    return;
  }
  let preview = "";
  let visualHash = "";
  if (parsed.previewFileId) {
    try {
      const thumb = await telegramThumb({
        data: { fileId: parsed.previewFileId },
      });
      preview = thumb.dataUrl ?? "";
      if (preview && state.settings.visualDedupe) visualHash = await averageHash(preview);
    } catch {
      preview = "";
    }
  }
  useSecretary.getState().ingest({ ...shell, preview, visualHash }, Date.now());
}

async function answerAdmin(command: { userId: string; chatId: string; text: string }): Promise<void> {
  const state = useSecretary.getState();
  const reply = answerCommand({
    text: command.text,
    userId: command.userId,
    adminId: state.settings.adminId ?? "",
    people: state.people,
    history: state.history,
    now: Date.now(),
  });
  if (!reply) return;
  await telegramCall({
    data: {
      method: "sendMessage",
      payload: { chat_id: command.chatId, text: reply },
    },
  });
  state.addLog({
    id: uid("log"),
    at: Date.now(),
    level: "info",
    title: "回复了管理员",
    detail: reply.split("\n")[0] ?? "已回复",
    chatTitle: "私聊",
  });
}

export async function pullTelegram(): Promise<void> {
  const state = useSecretary.getState();
  if (state.serverListening) throw new Error("已经交给服务器，这台页面不用再拉");
  const token = state.settings.token.trim();
  if (!token && !state.tokenOnFile) throw new Error("还没有 Bot Token");
  const result = await telegramCall({
    data: {
      ...(token ? { token } : {}),
      method: "getUpdates",
      payload: { offset: state.updateOffset, limit: 25, timeout: 0 },
    },
  });
  const updates = Array.isArray(result) ? result : [];
  for (const update of updates) {
    const row = asRecord(update);
    const updateId = typeof row?.update_id === "number" ? row.update_id : null;
    if (updateId === null) continue;
    const observed = observeUpdate(update);
    const command = commandFromUpdate(update);
    if (command) {
      try {
        await answerAdmin(command);
      } catch (error) {
        useSecretary.getState().addLog({
          id: uid("log"),
          at: Date.now(),
          level: "error",
          title: "管理员命令没发出去",
          detail: error instanceof Error ? error.message : "发送失败",
          chatTitle: "私聊",
        });
      }
    }
    const parsed = observed.media ?? mediaFromUpdate(update);
    if (parsed) await ingestParsed(parsed);
    else {
      for (const speaker of observed.speakers) useSecretary.getState().noteTalk(speaker);
    }
    if (parsed) {
      for (const speaker of observed.speakers) {
        if (speaker.hiddenId !== parsed.senderId) useSecretary.getState().noteTalk(speaker);
      }
    }
    useSecretary.getState().setOffset(updateId + 1);
  }
}
