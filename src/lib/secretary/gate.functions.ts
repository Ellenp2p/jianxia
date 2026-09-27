import { createServerFn } from "@tanstack/react-start";

function tokenOf(data: unknown): string {
  if (!data || typeof data !== "object" || !("token" in data)) return "";
  const token = (data as { token?: unknown }).token;
  return typeof token === "string" ? token : "";
}

async function publish(telegramId: string): Promise<string> {
  const { signAdminSession } = await import("./telegram-auth");
  const session = signAdminSession(telegramId);
  try {
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie("jianxia_admin", session, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 12 * 60 * 60 });
  } catch {
    /* the page also keeps the session itself */
  }
  return session;
}

export const gateStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ token: tokenOf(data) }))
  .handler(async ({ data }) => {
    const { adminIdFromSession } = await import("./telegram-auth");
    const { gateView } = await import("./record.server");
    return gateView(adminIdFromSession(data.token));
  });

export const gateSetup = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const row = data && typeof data === "object" ? (data as { token?: unknown; adminId?: unknown }) : {};
    if (typeof row.token !== "string" || typeof row.adminId !== "string") throw new Error("请求不完整");
    return { token: row.token, adminId: row.adminId };
  })
  .handler(async ({ data }) => {
    const { claimAdmin } = await import("./record.server");
    return claimAdmin(data.token, data.adminId);
  });

export const gateChallenge = createServerFn({ method: "POST" })
  .handler(async () => {
    const { beginChallenge } = await import("./record.server");
    return beginChallenge();
  });

export const gateFinish = createServerFn({ method: "POST" })
  .handler(async () => {
    const { finishChallenge } = await import("./record.server");
    const result = await finishChallenge();
    if (!result.ok) return result;
    return { ok: true as const, session: await publish(result.telegramId) };
  });

export const gateWidget = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const text = (key: string) => {
      const value = row[key];
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      return "";
    };
    return {
      id: text("id"),
      firstName: text("first_name"),
      lastName: text("last_name"),
      username: text("username"),
      photoUrl: text("photo_url"),
      authDate: text("auth_date"),
      hash: text("hash"),
    };
  })
  .handler(async ({ data }) => {
    const { acceptWidget } = await import("./record.server");
    const result = await acceptWidget(data);
    if (!result.ok) return result;
    return { ok: true as const, session: await publish(result.telegramId) };
  });
