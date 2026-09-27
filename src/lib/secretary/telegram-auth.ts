import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { vaultMaterial } from "./crypto.server.ts";

export function widgetHashOk(token: string, fields: Record<string, string>, hash: string): boolean {
  const data = Object.keys(fields)
    .filter((key) => key !== "hash" && fields[key] !== "")
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secret = createHash("sha256").update(token).digest();
  const mac = createHmac("sha256", secret).update(data).digest("hex");
  const left = Buffer.from(mac);
  const right = Buffer.from(hash);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function material(): string {
  return vaultMaterial();
}

export function signAdminSession(telegramId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ id: telegramId, exp: now + 12 * 60 * 60 * 1000 })).toString("base64url");
  const sig = createHmac("sha256", material()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function adminIdFromSession(token: string, now = Date.now()): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", material()).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { id?: unknown; exp?: unknown };
    if (typeof parsed.id !== "string" || !/^\d{4,16}$/.test(parsed.id)) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
    return parsed.id;
  } catch {
    return null;
  }
}
