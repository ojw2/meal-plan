import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions, users } from "@/db/schema";
import { authenticate } from "@/lib/auth/login";
import { createSession, validateSession } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/errors";
import { getCookSchedule, setCookSchedule } from "@/lib/services/household";
import {
  archiveMember,
  changeRole,
  createMember,
  listMembers,
  resetCredential,
  restoreMember,
  updateMemberProfile,
} from "@/lib/services/members";
import { cookOf, db, resetDb, seedDinner, seedHousehold, seedUser } from "./helpers/db";

const NOW = new Date("2026-10-12T16:00:00Z"); // Monday in New York

beforeEach(async () => {
  await resetDb();
  await seedHousehold("America/New_York");
});

describe("permissions", () => {
  it("kids can't perform any member mutation", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    const attempts = [
      createMember(db(), kid, { displayName: "X", username: "x", role: "kid", secret: "1234" }),
      updateMemberProfile(db(), kid, alex.id, { displayName: "X", username: "x" }),
      resetCredential(db(), kid, alex.id, "newpassword1"),
      changeRole(db(), kid, alex.id, "kid", "1234"),
      archiveMember(db(), kid, alex.id),
      restoreMember(db(), kid, alex.id),
    ];
    for (const p of attempts) await expect(p).rejects.toThrow(ForbiddenError);
  });
});

describe("createMember", () => {
  it("requires a password for adults and a 4–6 digit PIN for kids", async () => {
    const alex = await seedUser({ username: "alex" });
    await expect(
      createMember(db(), alex, { displayName: "Kid", username: "kid", role: "kid", secret: "12" }),
    ).rejects.toThrow("PIN must be 4–6 digits");
    await expect(
      createMember(db(), alex, { displayName: "Bo", username: "bo", role: "adult", secret: "short" }),
    ).rejects.toThrow("at least 8");
    await createMember(db(), alex, { displayName: "Kid", username: "kid", role: "kid", secret: "123456" });
    expect((await authenticate(db(), "kid", "123456")).ok).toBe(true);
  });

  it("rejects duplicate usernames regardless of case, including archived members", async () => {
    const alex = await seedUser({ username: "alex" });
    const old = await seedUser({ username: "old" });
    await db().update(users).set({ archivedAt: new Date() }).where(eq(users.id, old.id));
    await expect(
      createMember(db(), alex, { displayName: "A", username: "ALEX", role: "kid", secret: "1234" }),
    ).rejects.toThrow("already taken");
    await expect(
      createMember(db(), alex, { displayName: "O", username: "old", role: "kid", secret: "1234" }),
    ).rejects.toThrow("already taken");
  });
});

describe("archiveMember", () => {
  it("never removes the last active adult", async () => {
    const alex = await seedUser({ username: "alex" });
    await seedUser({ username: "sam", role: "kid" });
    await expect(archiveMember(db(), alex, alex.id, NOW)).rejects.toThrow("at least one active adult");
  });

  it("keeps history, unassigns upcoming nights, clears schedule, and signs them out", async () => {
    const alex = await seedUser({ username: "alex" });
    const bo = await seedUser({ username: "bo" });
    await setCookSchedule(db(), alex, { 2: bo.id, 4: alex.id }, NOW);
    const past = await seedDinner("2026-10-10", bo.id);
    const today = await seedDinner("2026-10-12", bo.id);
    const future = await seedDinner("2026-10-20", bo.id, { cookManuallySet: true });
    const othersNight = await seedDinner("2026-10-21", alex.id);
    const token = await createSession(db(), bo.id);

    await archiveMember(db(), alex, bo.id, NOW);

    expect(await cookOf(past)).toBe(bo.id);
    expect(await cookOf(today)).toBeNull();
    expect(await cookOf(future)).toBeNull();
    expect(await cookOf(othersNight)).toBe(alex.id);
    expect(await getCookSchedule(db())).toEqual({ 4: alex.id });
    expect(await validateSession(db(), token)).toBeNull();
    expect((await authenticate(db(), "bo", "password123")).ok).toBe(false);

    const bo2 = (await listMembers(db())).find((m) => m.id === bo.id)!;
    expect(bo2.archivedAt).not.toBeNull();
  });

  it("can be undone with restore", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    await archiveMember(db(), alex, kid.id, NOW);
    await restoreMember(db(), alex, kid.id);
    expect((await authenticate(db(), "sam", "1234")).ok).toBe(true);
  });
});

describe("changeRole", () => {
  it("never demotes the last active adult", async () => {
    const alex = await seedUser({ username: "alex" });
    await expect(changeRole(db(), alex, alex.id, "kid", "1234", NOW)).rejects.toThrow(
      "at least one active adult",
    );
  });

  it("swaps the credential type and releases cook duties when demoting", async () => {
    const alex = await seedUser({ username: "alex" });
    const bo = await seedUser({ username: "bo" });
    await setCookSchedule(db(), alex, { 5: bo.id }, NOW);
    const future = await seedDinner("2026-10-16", bo.id);

    await changeRole(db(), alex, bo.id, "kid", "9876", NOW);

    expect(await cookOf(future)).toBeNull();
    expect(await getCookSchedule(db())).toEqual({});
    expect((await authenticate(db(), "bo", "password123")).ok).toBe(false);
    expect((await authenticate(db(), "bo", "9876")).ok).toBe(true);

    await changeRole(db(), alex, bo.id, "adult", "brandnewpass", NOW);
    expect((await authenticate(db(), "bo", "brandnewpass")).ok).toBe(true);
  });

  it("validates the new credential against the new role", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(changeRole(db(), alex, kid.id, "adult", "1234", NOW)).rejects.toThrow("at least 8");
  });
});

describe("resetCredential", () => {
  it("sets a new secret and signs the member out everywhere", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    const token = await createSession(db(), kid.id);
    await resetCredential(db(), alex, kid.id, "5555");
    expect((await authenticate(db(), "sam", "5555")).ok).toBe(true);
    expect(await validateSession(db(), token)).toBeNull();
  });

  it("keeps your own session when resetting your own password", async () => {
    const alex = await seedUser({ username: "alex" });
    await createSession(db(), alex.id);
    await resetCredential(db(), alex, alex.id, "anotherpass1");
    expect(await db().select().from(sessions).where(eq(sessions.userId, alex.id))).toHaveLength(1);
  });

  it("rejects a password for a kid", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(resetCredential(db(), alex, kid.id, "password123")).rejects.toThrow(/PIN/);
  });
});

describe("updateMemberProfile", () => {
  it("renames members but keeps usernames unique", async () => {
    const alex = await seedUser({ username: "alex" });
    const bo = await seedUser({ username: "bo" });
    await updateMemberProfile(db(), alex, bo.id, { displayName: "Bo B", username: "bobby" });
    expect((await listMembers(db())).find((m) => m.id === bo.id)).toMatchObject({
      displayName: "Bo B",
      username: "bobby",
    });
    await expect(
      updateMemberProfile(db(), alex, bo.id, { displayName: "Bo", username: "Alex" }),
    ).rejects.toThrow("already taken");
  });
});
