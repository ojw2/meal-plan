import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { loginAttempts, users } from "@/db/schema";
import { getDummyHash, verifySecret } from "./credentials";
import { WINDOW_MS, lockedUntil } from "./rate-limit";

export type LoginResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; until: Date };

/**
 * Checks a username + password (adults) or PIN (kids). Unknown usernames
 * and wrong secrets look identical to the caller.
 */
export async function authenticate(
  db: DbOrTx,
  rawUsername: string,
  secret: string,
  now = new Date(),
): Promise<LoginResult> {
  const username = rawUsername.trim().toLowerCase();

  const recent = await db
    .select({ success: loginAttempts.success, attemptedAt: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.username, username),
        gt(loginAttempts.attemptedAt, new Date(now.getTime() - WINDOW_MS)),
      ),
    );
  const until = lockedUntil(recent, now);
  // Attempts during a lockout are rejected without checking or recording them.
  if (until) return { ok: false, reason: "locked", until };

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, pinHash: users.pinHash })
    .from(users)
    .where(and(sql`lower(${users.username}) = ${username}`, isNull(users.archivedAt)));

  const storedHash = user ? (user.passwordHash ?? user.pinHash) : null;
  const valid = await verifySecret(storedHash ?? (await getDummyHash()), secret);
  const success = Boolean(user && storedHash && valid);

  await db.insert(loginAttempts).values({ username, success, attemptedAt: now });
  return success ? { ok: true, userId: user!.id } : { ok: false, reason: "invalid" };
}
