import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions, users } from "@/db/schema";
import { authenticate } from "@/lib/auth/login";
import {
  SESSION_TTL_MS,
  createSession,
  deleteSession,
  hashToken,
  validateSession,
} from "@/lib/auth/session";
import { db, resetDb, seedHousehold, seedUser } from "./helpers/db";

beforeEach(async () => {
  await resetDb();
  await seedHousehold();
});

describe("authenticate", () => {
  it("signs in adults with a password and kids with a PIN", async () => {
    const adult = await seedUser({ username: "alex", secret: "password123" });
    const kid = await seedUser({ username: "sam", role: "kid", secret: "4321" });
    expect(await authenticate(db(), "alex", "password123")).toEqual({ ok: true, userId: adult.id });
    expect(await authenticate(db(), "sam", "4321")).toEqual({ ok: true, userId: kid.id });
  });

  it("matches usernames case-insensitively", async () => {
    const adult = await seedUser({ username: "alex" });
    expect(await authenticate(db(), "  ALEX ", "password123")).toEqual({ ok: true, userId: adult.id });
  });

  it("gives the same answer for a wrong secret and an unknown user", async () => {
    await seedUser({ username: "alex" });
    expect(await authenticate(db(), "alex", "wrong-password")).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticate(db(), "nobody", "password123")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects archived members", async () => {
    const adult = await seedUser({ username: "alex" });
    await db().update(users).set({ archivedAt: new Date() }).where(eq(users.id, adult.id));
    expect(await authenticate(db(), "alex", "password123")).toEqual({ ok: false, reason: "invalid" });
  });

  it("locks a username after 5 failures, even for the right secret, then unlocks", async () => {
    await seedUser({ username: "sam", role: "kid", secret: "1234" });
    const t0 = new Date();
    for (let i = 0; i < 5; i++) {
      const at = new Date(t0.getTime() + i * 1000);
      expect((await authenticate(db(), "sam", "0000", at)).ok).toBe(false);
    }
    const locked = await authenticate(db(), "sam", "1234", new Date(t0.getTime() + 6000));
    expect(locked).toMatchObject({ ok: false, reason: "locked" });

    const later = new Date(t0.getTime() + 16 * 60 * 1000);
    expect((await authenticate(db(), "sam", "1234", later)).ok).toBe(true);
  });

  it("lockout is per username", async () => {
    await seedUser({ username: "alex" });
    for (let i = 0; i < 5; i++) await authenticate(db(), "mallory", "guess");
    expect((await authenticate(db(), "alex", "password123")).ok).toBe(true);
  });
});

describe("sessions", () => {
  it("round-trips a token to the user without storing the raw token", async () => {
    const adult = await seedUser({ username: "alex", displayName: "Alex" });
    const token = await createSession(db(), adult.id);
    const [row] = await db().select().from(sessions);
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);
    expect(await validateSession(db(), token)).toEqual({
      id: adult.id,
      displayName: "Alex",
      username: "alex",
      role: "adult",
      sessionId: hashToken(token),
    });
  });

  it("rejects unknown, expired, and deleted sessions", async () => {
    const adult = await seedUser({ username: "alex" });
    expect(await validateSession(db(), "bogus")).toBeNull();

    const t0 = new Date("2026-01-01T00:00:00Z");
    const token = await createSession(db(), adult.id, t0);
    expect(await validateSession(db(), token, new Date(t0.getTime() + SESSION_TTL_MS + 1))).toBeNull();

    const token2 = await createSession(db(), adult.id);
    await deleteSession(db(), token2);
    expect(await validateSession(db(), token2)).toBeNull();
  });

  it("rejects sessions of archived members", async () => {
    const adult = await seedUser({ username: "alex" });
    const token = await createSession(db(), adult.id);
    await db().update(users).set({ archivedAt: new Date() }).where(eq(users.id, adult.id));
    expect(await validateSession(db(), token)).toBeNull();
  });

  it("extends the expiry on use (rolling 90 days)", async () => {
    const adult = await seedUser({ username: "alex" });
    const t0 = new Date("2026-01-01T00:00:00Z");
    const token = await createSession(db(), adult.id, t0);
    const t1 = new Date(t0.getTime() + 60 * 24 * 60 * 60 * 1000); // day 60
    expect(await validateSession(db(), token, t1)).not.toBeNull();
    const [row] = await db().select().from(sessions);
    expect(row.expiresAt.getTime()).toBe(t1.getTime() + SESSION_TTL_MS);
    // Day 120 would be past the original expiry, but the session was extended.
    expect(await validateSession(db(), token, new Date(t0.getTime() + 120 * 86_400_000))).not.toBeNull();
  });
});
