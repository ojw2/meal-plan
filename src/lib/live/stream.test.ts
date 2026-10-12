import { describe, expect, it } from "vitest";
import { publish } from "@/lib/events";
import { eventStream } from "./stream";

const decoder = new TextDecoder();

function open(opts: { isSessionValid?: () => Promise<boolean>; heartbeatMs?: number } = {}) {
  const abort = new AbortController();
  const stream = eventStream({
    signal: abort.signal,
    isSessionValid: opts.isSessionValid ?? (async () => true),
    heartbeatMs: opts.heartbeatMs ?? 60_000,
  });
  const reader = stream.getReader();
  const next = async () => {
    const { value, done } = await reader.read();
    return done ? null : decoder.decode(value);
  };
  return { abort, reader, next };
}

describe("eventStream", () => {
  it("says it's connected, then relays each published event as an SSE message", async () => {
    const { abort, next } = open();
    expect(await next()).toBe(": connected\n\n");

    publish({ type: "grocery.updated", weekStart: "2026-10-12" });
    publish({ type: "household.updated" });
    expect(await next()).toBe(`data: {"type":"grocery.updated","weekStart":"2026-10-12"}\n\n`);
    expect(await next()).toBe(`data: {"type":"household.updated"}\n\n`);
    abort.abort();
  });

  it("ends when the client disconnects, and stops listening", async () => {
    const { abort, next } = open();
    await next();
    abort.abort();
    expect(await next()).toBeNull();
    // Publishing to a closed stream must not throw.
    expect(() => publish({ type: "rules.updated" })).not.toThrow();
  });

  it("sends heartbeats while the session is valid", async () => {
    const { abort, next } = open({ heartbeatMs: 5 });
    await next();
    expect(await next()).toBe(": ping\n\n");
    abort.abort();
  });

  it("ends at the next heartbeat once the session is gone", async () => {
    let valid = true;
    const { abort, next } = open({ heartbeatMs: 5, isSessionValid: async () => valid });
    await next();
    expect(await next()).toBe(": ping\n\n");
    valid = false;
    // Any heartbeat already queued, then the end.
    let chunk: string | null;
    do chunk = await next();
    while (chunk !== null);
    abort.abort();
  });

  it("keeps the stream open if the session can't be checked (e.g. a DB blip)", async () => {
    const { abort, next } = open({
      heartbeatMs: 5,
      isSessionValid: () => Promise.reject(new Error("db down")),
    });
    await next();
    expect(await next()).toBe(": ping\n\n");
    abort.abort();
  });
});
