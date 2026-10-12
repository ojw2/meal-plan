import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { sessions, users } from "@/db/schema";

export { SESSION_COOKIE } from "./constants";
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Extend the rolling expiry at most once a day to avoid a write per request.
const EXTEND_AFTER_MS = 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  displayName: string;
  username: string;
  role: "adult" | "kid";
};

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return secret;
}

export function hashToken(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export async function createSession(db: DbOrTx, userId: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return token;
}

/** Resolves a cookie token to an active user, extending the session's rolling expiry. */
export async function validateSession(
  db: DbOrTx,
  token: string,
  now = new Date(),
): Promise<SessionUser | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now), isNull(users.archivedAt)),
    );
  if (!row) return null;

  const freshExpiry = now.getTime() + SESSION_TTL_MS;
  if (freshExpiry - row.expiresAt.getTime() > EXTEND_AFTER_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(freshExpiry) })
      .where(eq(sessions.tokenHash, tokenHash));
  }

  return { id: row.id, displayName: row.displayName, username: row.username, role: row.role };
}

export async function deleteSession(db: DbOrTx, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function deleteUserSessions(db: DbOrTx, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
