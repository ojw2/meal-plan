import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { household, users } from "@/db/schema";
import { hashSecret } from "@/lib/auth/credentials";
import type { SessionUser } from "@/lib/auth/session";

export const db = () => getDb();

/** Wipes every table; call in beforeEach. */
export async function resetDb() {
  await db().execute(sql`
    truncate household, users, sessions, login_attempts, cook_schedule, recipes,
      recipe_ingredients, recurring_rules, dinners, dishes, grocery_checks,
      manual_grocery_items, search_cache, api_usage, audit_log
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

/** Inserts a planned dinner with one free-text main dish. */
export async function seedDish(
  date: string,
  cookUserId: string | null,
  opts: { cookManuallySet?: boolean } = {},
) {
  const { dinners, dishes } = await import("@/db/schema");
  const [dinner] = await db().insert(dinners).values({ date, status: "planned" }).returning();
  const [dish] = await db()
    .insert(dishes)
    .values({
      dinnerId: dinner.id,
      freeTextName: `Dinner ${date}`,
      role: "main",
      cookUserId,
      cookManuallySet: opts.cookManuallySet ?? false,
      position: 0,
    })
    .returning();
  return dish.id;
}

export async function cookOf(dishId: string) {
  const { dishes } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [d] = await db().select({ cook: dishes.cookUserId }).from(dishes).where(eq(dishes.id, dishId));
  return d.cook;
}
