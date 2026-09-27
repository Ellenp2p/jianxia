import type { ChatType, MediaKind, ParsedMedia, Reveal, Speaker } from "./types";
import { parseCommand } from "./commands.ts";

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type Size = {
  fileId: string;
  unique: string;
  width: number;
  height: number;
  bytes: number | null;
};

function readSize(value: unknown): Size | null {
  const row = record(value);
  if (!row) return null;
  const fileId = str(row.file_id);
  const unique = str(row.file_unique_id);
  if (!fileId || !unique) return null;
  return {
    fileId,
    unique,
    width: num(row.width) ?? 0,
    height: num(row.height) ?? 0,
    bytes: num(row.file_size),
  };
}

function pickPhoto(sizes: Size[]): { file: Size; preview: Size } {
  const file = [...sizes].sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? sizes[0];
  const mid = sizes.filter((size) => size.width >= 160 && size.width <= 640);
  const pool = mid.length > 0 ? mid : sizes;
  const preview = [...pool].sort(
    (a, b) => Math.abs(a.width - 360) - Math.abs(b.width - 360),
  )[0] ?? file;
  return { file, preview };
}

function chatOf(message: Record<string, unknown>): {
  chatId: string;
  chatTitle: string;
  chatUsername: string | null;
  chatType: ChatType;
} | null {
  const chat = record(message.chat);
  if (!chat) return null;
  const id = num(chat.id) ?? (str(chat.id) ? Number(str(chat.id)) : null);
  const idText = num(chat.id) !== null ? String(chat.id) : str(chat.id);
  if (!idText || id === null) return null;
  const type = str(chat.type);
  const chatType: ChatType =
    type === "channel" || type === "private" || type === "group" || type === "supergroup"
      ? type
      : "private";
  const title =
    str(chat.title) ||
    [str(chat.first_name), str(chat.last_name)].filter(Boolean).join(" ") ||
    "未命名聊天";
  return {
    chatId: idText,
    chatTitle: title,
    chatUsername: str(chat.username),
    chatType,
  };
}

function personOf(value: unknown, at: number): Speaker | null {
  const row = record(value);
  if (!row) return null;
  const idText = num(row.id) !== null ? String(row.id) : str(row.id);
  if (!idText) return null;
  const displayName =
    [str(row.first_name), str(row.last_name)].filter(Boolean).join(" ") ||
    str(row.title) ||
    str(row.sender_user_name) ||
    "未命名";
  return {
    hiddenId: idText,
    displayName,
    username: str(row.username),
    at,
  };
}

function revealOf(message: Record<string, unknown>, media: Record<string, unknown> | null): Reveal {
  const ttl = num(message.ttl_seconds) ?? (media ? num(media.ttl_seconds) : null);
  if (message.view_once === true || message.is_view_once === true || (ttl !== null && ttl > 0)) return "flash";
  if (message.has_media_spoiler === true) return "spoiler";
  return "open";
}

function extraSpeakers(message: Record<string, unknown>, at: number): Speaker[] {
  const found: Speaker[] = [];
  const origin = record(message.forward_origin);
  if (origin) {
    const user = personOf(origin.sender_user, at);
    const chat = personOf(origin.chat, at) ?? personOf(origin.sender_chat, at);
    if (user) found.push(user);
    if (chat) found.push(chat);
  }
  const legacy = personOf(message.forward_from, at);
  if (legacy) found.push(legacy);
  const forwardChat = personOf(message.forward_from_chat, at);
  if (forwardChat) found.push(forwardChat);
  return found;
}
function baseOf(message: Record<string, unknown>, chat: NonNullable<ReturnType<typeof chatOf>>) {
  const messageId = num(message.message_id);
  const date = num(message.date);
  if (messageId === null || date === null) return null;
  return {
    ...chat,
    messageId,
    caption: str(message.caption) ?? "",
    occurredAt: date * 1000,
  };
}

function identityOf(message: Record<string, unknown>, chat: NonNullable<ReturnType<typeof chatOf>>, at: number) {
  const from = personOf(message.from, at);
  const onBehalf = personOf(message.sender_chat, at);
  const asChat = personOf(message.chat, at);
  const primary = {
    ...(from ?? onBehalf ?? asChat ?? {
      hiddenId: chat.chatId,
      displayName: chat.chatTitle,
      username: chat.chatUsername,
      at,
    }),
    where: chat.chatType,
  };
  const speakers: Speaker[] = [primary];
  for (const extra of extraSpeakers(message, at)) {
    if (!speakers.some((speaker) => speaker.hiddenId === extra.hiddenId)) speakers.push(extra);
  }
  return { primary, speakers };
}

function withIdentity(
  base: NonNullable<ReturnType<typeof baseOf>>,
  primary: Speaker,
  reveal: Reveal,
  rest: Omit<ParsedMedia, keyof typeof base | "senderId" | "senderName" | "senderUsername" | "reveal">,
): ParsedMedia {
  return {
    ...base,
    ...rest,
    senderId: primary.hiddenId,
    senderName: primary.displayName,
    senderUsername: primary.username,
    reveal,
  };
}

export type Observation = {
  speakers: Speaker[];
  media: ParsedMedia | null;
};

export function observeUpdate(update: unknown): Observation {
  const row = record(update);
  if (!row) return { speakers: [], media: null };
  const message = record(row.message) ?? record(row.channel_post);
  if (!message) return { speakers: [], media: null };
  const chat = chatOf(message);
  if (!chat) return { speakers: [], media: null };
  const base = baseOf(message, chat);
  if (!base) return { speakers: [], media: null };
  const { primary, speakers } = identityOf(message, chat, base.occurredAt);

  const photos = Array.isArray(message.photo) ? message.photo.map(readSize).filter((size): size is Size => !!size) : [];
  if (photos.length > 0) {
    const picked = pickPhoto(photos);
    return {
      speakers,
      media: withIdentity(base, primary, revealOf(message, null), {
        kind: "photo",
        fileId: picked.file.fileId,
        fileUniqueId: picked.file.unique,
        previewFileId: picked.preview.fileId,
        width: picked.file.width,
        height: picked.file.height,
        duration: null,
        bytes: picked.file.bytes,
      }),
    };
  }

  const video = record(message.video) ?? record(message.video_note) ?? record(message.animation);
  if (video) {
    const file = readSize(video);
    if (file) {
      const thumb = readSize(video.thumbnail) ?? readSize(video.thumb);
      const kind: MediaKind = message.animation ? "animation" : "video";
      return {
        speakers,
        media: withIdentity(base, primary, revealOf(message, video), {
          kind,
          fileId: file.fileId,
          fileUniqueId: file.unique,
          previewFileId: thumb?.fileId ?? null,
          width: file.width,
          height: file.height,
          duration: num(video.duration),
          bytes: file.bytes,
        }),
      };
    }
  }

  const doc = record(message.document);
  if (doc) {
    const mime = str(doc.mime_type) ?? "";
    const file = readSize(doc);
    if (file && (mime.startsWith("image/") || mime.startsWith("video/"))) {
      const thumb = readSize(doc.thumbnail) ?? readSize(doc.thumb);
      return {
        speakers,
        media: withIdentity(base, primary, revealOf(message, doc), {
          kind: "document",
          fileId: file.fileId,
          fileUniqueId: file.unique,
          previewFileId: thumb?.fileId ?? null,
          width: file.width,
          height: file.height,
          duration: null,
          bytes: file.bytes,
        }),
      };
    }
  }

  const reveal = revealOf(message, null);
  if (reveal !== "open") {
    return {
      speakers,
      media: withIdentity(base, primary, reveal, {
        kind: "photo",
        fileId: "",
        fileUniqueId: `once-${chat.chatId}-${base.messageId}`,
        previewFileId: null,
        width: 0,
        height: 0,
        duration: null,
        bytes: null,
      }),
    };
  }

  return { speakers, media: null };
}

export function mediaFromUpdate(update: unknown): ParsedMedia | null {
  return observeUpdate(update).media;
}

export function commandFromUpdate(update: unknown): { userId: string; chatId: string; text: string } | null {
  const row = record(update);
  const message = row ? record(row.message) : null;
  if (!message) return null;
  const text = str(message.text);
  if (!text || !parseCommand(text)) return null;
  const chat = chatOf(message);
  if (!chat || chat.chatType !== "private") return null;
  const from = personOf(message.from, 0);
  const userId = from?.hiddenId ?? chat.chatId;
  if (userId !== chat.chatId) return null;
  return { userId, chatId: chat.chatId, text: text.trim() };
}
