import { queryOne } from "@/lib/db-http";
import { addClient, createSseStream } from "@/lib/caption-sse";
import { getSubtitleSettings } from "@/lib/subtitle-config";

export const dynamic = "force-dynamic";
export const preferredRegion = "auto";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });

  const source = await queryOne<{ userId: string; enabled: boolean }>(
    'SELECT "userId", "enabled" FROM "OBSSource" WHERE "token" = $1 AND "sourceKey" = $2 LIMIT 1',
    [token, "captions"],
  );
  if (!source || !source.enabled) return new Response("Forbidden", { status: 403 });

  const userId = source.userId;
  const config = await getSubtitleSettings(userId);
  if (!config.enabled) return new Response("Disabled", { status: 403 });

  const stream = createSseStream(userId, req.signal);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
