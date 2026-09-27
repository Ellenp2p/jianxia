import { createFileRoute } from "@tanstack/react-router";
import { acceptUpdate, findUserByWebhook } from "@/lib/secretary/record.server";

export const Route = createFileRoute("/api/telegram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        const userId = await findUserByWebhook(secret);
        if (!userId) return new Response("unauthorized", { status: 401 });
        const update: unknown = await request.json().catch(() => null);
        try {
          await acceptUpdate(userId, update);
        } catch {
          return new Response("retry", { status: 500 });
        }
        return new Response("ok");
      },
    },
  },
});
