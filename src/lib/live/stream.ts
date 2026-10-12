import { subscribe } from "@/lib/events";

export const HEARTBEAT_MS = 25_000;

type Options = {
  /** Aborts when the client disconnects. */
  signal: AbortSignal;
  /** Checked on every heartbeat; the stream ends once the session is gone (signed out, member removed). */
  isSessionValid: () => Promise<boolean>;
  heartbeatMs?: number;
};

/**
 * A Server-Sent Events stream of every published `AppEvent` (SPEC §5). The
 * heartbeat comment keeps proxies (`tailscale serve`) from closing an idle
 * connection.
 */
export function eventStream({ signal, isSessionValid, heartbeatMs = HEARTBEAT_MS }: Options): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let stop = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const unsubscribe = subscribe((event) => send(`data: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(async () => {
        if (!(await isSessionValid().catch(() => true))) return close();
        send(": ping\n\n");
      }, heartbeatMs);

      stop = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        signal.removeEventListener("abort", close);
      };
      function close() {
        if (closed) return;
        stop();
        controller.close();
      }

      signal.addEventListener("abort", close);
      if (signal.aborted) return close();
      // Sent right away so the client knows it's connected.
      send(": connected\n\n");
    },
    cancel() {
      stop();
    },
  });
}
