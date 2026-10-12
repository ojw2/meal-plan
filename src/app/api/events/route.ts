import { cookies } from "next/headers";
import { getDb } from "@/db";
import { SESSION_COOKIE, validateSession } from "@/lib/auth/session";
import { eventStream } from "@/lib/live/stream";

/**
 * Real-time sync (SPEC §5): every signed-in member, kids included, gets the
 * stream of change events and refetches what's on screen.
 */
export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const db = getDb();
  if (!token || !(await validateSession(db, token))) {
    return new Response("Sign in again.", { status: 401 });
  }
  const stream = eventStream({
    signal: req.signal,
    isSessionValid: async () => Boolean(await validateSession(db, token)),
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform stops response compression, which would buffer events.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
