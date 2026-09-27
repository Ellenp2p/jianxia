import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "v1";

export function vaultMaterial(): string {
  const fromEnv = process.env.BETTER_AUTH_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  const slot = globalThis as { __jianxiaVaultKey?: string };
  if (!slot.__jianxiaVaultKey) slot.__jianxiaVaultKey = randomBytes(32).toString("hex");
  return slot.__jianxiaVaultKey;
}

function material(): string {
  return vaultMaterial();
}

function key(): Buffer {
  return scryptSync(material(), "jianxia-vault-v1", 32);
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function openSeal(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error("档案密文无法识别");
  const iv = Buffer.from(parts[1] ?? "", "base64");
  const tag = Buffer.from(parts[2] ?? "", "base64");
  const data = Buffer.from(parts[3] ?? "", "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function secretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function newSecret(): string {
  return randomBytes(24).toString("hex");
}
