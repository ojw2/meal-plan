import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { cookSchedule, dinners, dishes, users } from "@/db/schema";
import {
  displayNameSchema,
  hashSecret,
  passwordSchema,
  pinSchema,
  usernameSchema,
} from "@/lib/auth/credentials";
import { deleteUserSessions, type SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { householdToday } from "./household";
import { assertAdult } from "./permissions";

export type Role = "adult" | "kid";

export type Member = {
  id: string;
  displayName: string;
  username: string;
  role: Role;
  archivedAt: Date | null;
};

export const memberProfileSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema,
});

/** Validates a password for adults or a PIN for kids. */
export function secretSchemaFor(role: Role) {
  return role === "adult" ? passwordSchema : pinSchema;
}

const memberColumns = {
  id: users.id,
  displayName: users.displayName,
  username: users.username,
  role: users.role,
  archivedAt: users.archivedAt,
};

export async function listMembers(db: DbOrTx): Promise<Member[]> {
  return db
    .select(memberColumns)
    .from(users)
    .orderBy(sql`${users.archivedAt} is not null`, asc(users.role), asc(users.displayName));
}

export async function listActiveAdults(db: DbOrTx) {
  return db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.role, "adult"), isNull(users.archivedAt)))
    .orderBy(asc(users.displayName));
}

async function getMember(db: DbOrTx, id: string): Promise<Member> {
  const [m] = await db.select(memberColumns).from(users).where(eq(users.id, id));
  if (!m) throw new ServiceError("Member not found.", "not_found");
  return m;
}

async function assertUsernameFree(db: DbOrTx, username: string, exceptId?: string) {
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        sql`lower(${users.username}) = ${username.toLowerCase()}`,
        exceptId ? ne(users.id, exceptId) : undefined,
      ),
    );
  if (taken) throw new ServiceError("That username is already taken.", "conflict");
}

function credentialColumns(role: Role, secretHash: string) {
  return role === "adult"
    ? { passwordHash: secretHash, pinHash: null }
    : { passwordHash: null, pinHash: secretHash };
}

/** Serializes membership changes so the last-adult check can't race. */
async function lockMembers(tx: DbOrTx) {
  await tx.execute(sql`select pg_advisory_xact_lock(4242002)`);
}

async function assertAnotherActiveAdult(tx: DbOrTx, excludingId: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "adult"), isNull(users.archivedAt), ne(users.id, excludingId)));
  if (row.n === 0) {
    throw new ServiceError("The household needs at least one active adult.", "conflict");
  }
}

/**
 * A member who can no longer cook (archived or now a kid) loses their
 * default-schedule slots, and their dishes from today on become unassigned
 * (SPEC §2). Past dinners keep their name.
 */
async function releaseCookDuties(tx: DbOrTx, userId: string, today: string) {
  await tx.delete(cookSchedule).where(eq(cookSchedule.userId, userId));
  await tx
    .update(dishes)
    .set({ cookUserId: null, cookManuallySet: false })
    .where(
      and(
        eq(dishes.cookUserId, userId),
        sql`${dishes.dinnerId} in (select ${dinners.id} from ${dinners} where ${dinners.date} >= ${today})`,
      ),
    );
}

export async function createMember(
  db: DbOrTx,
  actor: SessionUser,
  input: { displayName: string; username: string; role: Role; secret: string },
) {
  assertAdult(actor);
  const profile = memberProfileSchema.parse(input);
  const secret = secretSchemaFor(input.role).parse(input.secret);
  await assertUsernameFree(db, profile.username);
  const [row] = await db
    .insert(users)
    .values({
      ...profile,
      role: input.role,
      ...credentialColumns(input.role, await hashSecret(secret)),
    })
    .returning({ id: users.id });
  return row.id;
}

export async function updateMemberProfile(
  db: DbOrTx,
  actor: SessionUser,
  id: string,
  input: { displayName: string; username: string },
) {
  assertAdult(actor);
  const profile = memberProfileSchema.parse(input);
  await getMember(db, id);
  await assertUsernameFree(db, profile.username, id);
  await db.update(users).set(profile).where(eq(users.id, id));
}

/** Sets a new password (adult) or PIN (kid) and signs the member out elsewhere. */
export async function resetCredential(db: DbOrTx, actor: SessionUser, id: string, secret: string) {
  assertAdult(actor);
  const member = await getMember(db, id);
  const valid = secretSchemaFor(member.role).parse(secret);
  await db
    .update(users)
    .set(credentialColumns(member.role, await hashSecret(valid)))
    .where(eq(users.id, id));
  // Resetting your own password keeps you signed in on this device.
  if (id !== actor.id) await deleteUserSessions(db, id);
}

/** Switching role requires a new credential, since adults and kids sign in differently. */
export async function changeRole(
  db: Db,
  actor: SessionUser,
  id: string,
  role: Role,
  secret: string,
  now = new Date(),
) {
  assertAdult(actor);
  const valid = secretSchemaFor(role).parse(secret);
  const secretHash = await hashSecret(valid);
  const today = await householdToday(db, now);
  await db.transaction(async (tx) => {
    await lockMembers(tx);
    const member = await getMember(tx, id);
    if (member.role === role) throw new ServiceError(`Already ${role === "adult" ? "an adult" : "a kid"}.`);
    if (role === "kid") {
      await assertAnotherActiveAdult(tx, id);
      await releaseCookDuties(tx, id, today);
    }
    await tx
      .update(users)
      .set({ role, ...credentialColumns(role, secretHash) })
      .where(eq(users.id, id));
    await deleteUserSessions(tx, id);
  });
}

export async function archiveMember(db: Db, actor: SessionUser, id: string, now = new Date()) {
  assertAdult(actor);
  const today = await householdToday(db, now);
  await db.transaction(async (tx) => {
    await lockMembers(tx);
    const member = await getMember(tx, id);
    if (member.archivedAt) return;
    if (member.role === "adult") await assertAnotherActiveAdult(tx, id);
    await releaseCookDuties(tx, id, today);
    await tx.update(users).set({ archivedAt: now }).where(eq(users.id, id));
    await deleteUserSessions(tx, id);
  });
}

export async function restoreMember(db: DbOrTx, actor: SessionUser, id: string) {
  assertAdult(actor);
  await getMember(db, id);
  await db.update(users).set({ archivedAt: null }).where(eq(users.id, id));
}
