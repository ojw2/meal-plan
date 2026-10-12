"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AppEvent } from "@/lib/events";
import { affects, backoffMs, type LiveScope as Scope } from "@/lib/live/scope";

type Register = (scope: Scope) => () => void;

const RegisterContext = createContext<Register>(() => () => {});

/** Coalesces bursts of events (e.g. copy last week) into one refetch. */
const REFRESH_DELAY_MS = 100;

/**
 * Keeps an SSE connection to `/api/events` (SPEC §5) and refetches the
 * current screen when an event touches what it shows (see `LiveScope`).
 * Reconnects with backoff, and refetches everything after reconnecting,
 * since events may have been missed meanwhile. Coming back to a hidden tab
 * also reconnects: phones often drop the connection in the background
 * without telling the page.
 *
 * `<html data-live>` reports the connection state ("open" or "connecting").
 */
export function LiveSync({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [scopes] = useState(() => new Set<Scope>());
  const [register] = useState<Register>(() => (scope: Scope) => {
    scopes.add(scope);
    return () => scopes.delete(scope);
  });

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let connectedBefore = false;
    let wasHidden = false;

    const setStatus = (status: "open" | "connecting") => {
      document.documentElement.dataset.live = status;
    };
    const scheduleRefresh = () => {
      clearTimeout(refresh);
      refresh = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
    };

    function connect() {
      clearTimeout(retry);
      source?.close();
      setStatus("connecting");
      const es = new EventSource("/api/events");
      source = es;
      es.onopen = () => {
        failures = 0;
        setStatus("open");
        if (connectedBefore) scheduleRefresh();
        connectedBefore = true;
      };
      es.onmessage = (msg) => {
        let event: AppEvent;
        try {
          event = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (affects(event, [...scopes])) scheduleRefresh();
      };
      es.onerror = () => {
        // Take over from the browser's fixed retry so we can back off.
        es.close();
        if (source !== es) return;
        setStatus("connecting");
        retry = setTimeout(connect, backoffMs(++failures));
      };
    }

    const onVisibility = () => {
      if (document.hidden) {
        wasHidden = true;
      } else if (wasHidden) {
        wasHidden = false;
        failures = 0;
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(retry);
      clearTimeout(refresh);
      source?.close();
      source = null;
      delete document.documentElement.dataset.live;
    };
  }, [router, scopes]);

  return <RegisterContext value={register}>{children}</RegisterContext>;
}

/**
 * Declares what the current screen shows, so it refetches on matching
 * events. Screens without one still refetch on household-wide changes.
 */
export function LiveScope(props: Scope) {
  const register = useContext(RegisterContext);
  const key = JSON.stringify(props);
  useEffect(() => register(JSON.parse(key)), [register, key]);
  return null;
}
