import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { dinners, dishes, household, recipeIngredients, recipes, users } from "@/db/schema";
import { hashSecret } from "@/lib/auth/credentials";
import { createSession, hashToken, type SessionUser } from "@/lib/auth/session";

export const db = () => getDb();

/** Wipes every table; call in beforeEach. */
export async function resetDb() {
  await db().execute(sql`
    truncate household, users, sessions, login_attempts, cook_schedule, recipes,
      recipe_ingredients, recurring_rules, dinners, dishes, grocery_checks,
      manual_grocery_items, search_cache, api_usage, audit_log, week_unlocks
    restart identity cascade
  `);
}

export async function seedHousehold(timezone = "America/New_York") {
  await db().insert(household).values({ id: 1, name: "Test House", timezone });
}

// Hashing is slow-ish; reuse one hash per secret across tests.
const hashCache = new Map<string, Promise<string>>();
const cachedHash = (s: string) => {
  if (!hashCache.has(s)) hashCache.set(s, hashSecret(s));
  return hashCache.get(s)!;
};

export async function seedUser(
  opts: { username: string; role?: "adult" | "kid"; secret?: string; displayName?: string },
): Promise<SessionUser> {
  const role = opts.role ?? "adult";
  const secret = opts.secret ?? (role === "adult" ? "password123" : "1234");
  const h = await cachedHash(secret);
  const [u] = await db()
    .insert(users)
    .values({
      username: opts.username,
      displayName: opts.displayName ?? opts.username,
      role,
      passwordHash: role === "adult" ? h : null,
      pinHash: role === "kid" ? h : null,
    })
    .returning();
  return { id: u.id, displayName: u.displayName, username: u.username, role: u.role };
}

/** Inserts a planned dinner with one free-text main dish; returns the dinner id. */
export async function seedDinner(
  date: string,
  cookUserId: string | null,
  opts: { cookManuallySet?: boolean } = {},
) {
  const [dinner] = await db()
    .insert(dinners)
    .values({ date, status: "planned", cookUserId, cookManuallySet: opts.cookManuallySet ?? false })
    .returning();
  await db()
    .insert(dishes)
    .values({ dinnerId: dinner.id, freeTextName: `Dinner ${date}`, role: "main", position: 0 });
  return dinner.id;
}

/** The cook of a dinner. */
export async function cookOf(dinnerId: string) {
  const [d] = await db().select({ cook: dinners.cookUserId }).from(dinners).where(eq(dinners.id, dinnerId));
  return d.cook;
}

/** A real session for `user`, so per-session state (week unlocks) works. */
export async function withSession(user: SessionUser): Promise<SessionUser> {
  const token = await createSession(db(), user.id);
  return { ...user, sessionId: hashToken(token) };
}

/** Inserts a recipe (a manual main unless overridden) with optional raw ingredient lines. */
export async function seedRecipe(values: Partial<typeof recipes.$inferInsert> & { title: string }, lines: string[] = []) {
  const [r] = await db()
    .insert(recipes)
    .values({ source: "manual", dishType: "main", ...values })
    .returning();
  if (lines.length) {
    await db()
      .insert(recipeIngredients)
      .values(lines.map((rawText, position) => ({ recipeId: r.id, rawText, position })));
  }
  return r;
}
