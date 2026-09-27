import { getRequest } from "@tanstack/react-start/server";
import { adminIdFromSession } from "./telegram-auth";

function cookieId(): string | null {
  const request = getRequest();
  const raw = request?.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)jianxia_admin=([^;]+)/.exec(raw);
  if (!match?.[1]) return null;
  return adminIdFromSession(decodeURIComponent(match[1]));
}

export async function assertAdmin(bearer?: string): Promise<void> {
  const id = (bearer ? adminIdFromSession(bearer) : null) ?? cookieId();
  if (!id) throw new Error("先用 Telegram 登录");
  const { readAdminId } = await import("./record.server");
  const adminId = await readAdminId();
  if (!adminId || id !== adminId) throw new Error("不是管理员");
}
