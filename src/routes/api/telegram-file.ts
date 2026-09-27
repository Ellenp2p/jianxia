import { createFileRoute } from "@tanstack/react-router";
import { assertAdmin } from "@/lib/secretary/admin-session.server";
import { userOwnsFile, VAULT_ID } from "@/lib/secretary/record.server";

const MAX_BYTES = 12 * 1024 * 1024;

function scrub(message: string, token: string): string {
  return token ? message.split(token).join("***") : message;
}

export const Route = createFileRoute("/api/telegram-file")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let token = "";
        try {
          const header = request.headers.get("authorization") ?? "";
          const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
          await assertAdmin(bearer);
          const body: unknown = await request.json();
          const row = body && typeof body === "object" ? (body as { fileId?: unknown }) : {};
          if (typeof row.fileId !== "string" || row.fileId.length < 8 || row.fileId.length > 400) {
            return Response.json({ error: "文件编号不对" }, { status: 400 });
          }
          token = await userOwnsFile(VAULT_ID, row.fileId);
          const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ file_id: row.fileId }),
            signal: AbortSignal.timeout(20_000),
          });
          const meta: unknown = await metaRes.json().catch(() => null);
          const parsed = meta && typeof meta === "object" ? (meta as { ok?: boolean; description?: string; result?: { file_path?: string; file_size?: number } }) : {};
          if (!parsed.ok || !parsed.result?.file_path) {
            return Response.json({ error: parsed.description || "取不到这个文件" }, { status: 400 });
          }
          if ((parsed.result.file_size ?? 0) > MAX_BYTES) {
            return Response.json({ error: "文件超过 12 MB，没有拉下来。档案里仍保留记录和预览。" }, { status: 413 });
          }
          const fileRes = await fetch(
            `https://api.telegram.org/file/bot${token}/${encodeURI(parsed.result.file_path)}`,
            { signal: AbortSignal.timeout(30_000) },
          );
          if (!fileRes.ok || !fileRes.body) {
            return Response.json({ error: "Telegram 没有把文件传过来" }, { status: 502 });
          }
          return new Response(fileRes.body, {
            headers: {
              "content-type": fileRes.headers.get("content-type") || "application/octet-stream",
              "cache-control": "private, max-age=600",
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "拉取失败";
          return Response.json({ error: scrub(message, token) }, { status: 500 });
        }
      },
    },
  },
});
