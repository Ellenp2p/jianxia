import { createMiddleware } from "@tanstack/react-start";

const KEY = "jianxia-admin";

export function readAdminToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeAdminToken(value: string) {
  window.sessionStorage.setItem(KEY, value);
}

export function clearAdminToken() {
  window.sessionStorage.removeItem(KEY);
}

export const adminMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => next({ sendContext: { adminToken: readAdminToken() } }))
  .server(async ({ next, context }) => {
    const { assertAdmin } = await import("./admin-session.server");
    await assertAdmin(context.adminToken);
    return next();
  });
