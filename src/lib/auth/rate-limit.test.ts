import { describe, expect, it } from "vitest";
import { MAX_FAILURES, WINDOW_MS, lockedUntil, type Attempt } from "./rate-limit";

const now = new Date("2026-10-12T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const fail = (msAgo: number): Attempt => ({ success: false, attemptedAt: ago(msAgo) });
const ok = (msAgo: number): Attempt => ({ success: true, attemptedAt: ago(msAgo) });

describe("lockedUntil", () => {
  it("allows attempts below the threshold", () => {
    expect(lockedUntil([fail(1000), fail(2000), fail(3000), fail(4000)], now)).toBeNull();
  });

  it("locks after 5 failures, until the 5th-most-recent leaves the window", () => {
    const attempts = [1, 2, 3, 4, 5].map((m) => fail(m * 60_000));
    expect(lockedUntil(attempts, now)).toEqual(new Date(ago(5 * 60_000).getTime() + WINDOW_MS));
  });

  it("ignores failures older than the window", () => {
    const attempts = [fail(1000), fail(2000), fail(3000), fail(4000), fail(WINDOW_MS + 1)];
    expect(lockedUntil(attempts, now)).toBeNull();
  });

  it("only counts failures after the most recent success", () => {
    const attempts = [fail(1000), fail(2000), ok(3000), fail(4000), fail(5000), fail(6000), fail(7000)];
    expect(lockedUntil(attempts, now)).toBeNull();
  });

  it("is order-independent", () => {
    const attempts = Array.from({ length: MAX_FAILURES }, (_, i) => fail((i + 1) * 1000)).reverse();
    expect(lockedUntil(attempts, now)).not.toBeNull();
  });
});
