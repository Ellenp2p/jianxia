import { createServerFn } from "@tanstack/react-start";
import { adminMiddleware } from "./gate.middleware";
import type { CommitInput } from "./record.server";
import type { Snapshot } from "./snapshot";

function asCommit(data: unknown): CommitInput {
  if (!data || typeof data !== "object") throw new Error("请求不完整");
  const row = data as Partial<CommitInput>;
  if (typeof row.revision !== "number" || !row.settings) throw new Error("请求不完整");
  return {
    revision: row.revision,
    settings: row.settings,
    items: Array.isArray(row.items) ? row.items : [],
    logs: Array.isArray(row.logs) ? row.logs : [],
    enrolledPrivate: Array.isArray(row.enrolledPrivate) ? row.enrolledPrivate : [],
    enrolledGroup: Array.isArray(row.enrolledGroup) ? row.enrolledGroup : [],
    people: Array.isArray(row.people) ? row.people : [],
    history: Array.isArray(row.history) ? row.history : [],
    updateOffset: typeof row.updateOffset === "number" ? row.updateOffset : 0,
    botName: typeof row.botName === "string" ? row.botName : "",
    botUsername: typeof row.botUsername === "string" ? row.botUsername : "",
  };
}

export const loadDesk = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async (): Promise<Snapshot> => {
    const { loadVault, VAULT_ID } = await import("./record.server");
    return loadVault(VAULT_ID);
  });

export const saveDesk = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator((data: unknown) => asCommit(data))
  .handler(async ({ data }) => {
    const { commitVault, VAULT_ID } = await import("./record.server");
    return commitVault(VAULT_ID, data);
  });

export const armDesk = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator((data: unknown) => {
    const origin = data && typeof data === "object" && "origin" in data ? (data as { origin?: unknown }).origin : "";
    if (typeof origin !== "string" || origin.length < 8 || origin.length > 200) throw new Error("这个地址不能交给 Telegram");
    return { origin };
  })
  .handler(async ({ data }) => {
    const { armServer, VAULT_ID } = await import("./record.server");
    return armServer(VAULT_ID, data.origin);
  });

export const disarmDesk = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .handler(async () => {
    const { disarmServer, VAULT_ID } = await import("./record.server");
    return disarmServer(VAULT_ID);
  });
