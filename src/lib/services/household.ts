import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { cookSchedule, dinners, household, users } from "@/db/schema";
import {
  displayNameSchema,
  hashSecret,
  passwordSchema,
  usernameSchema,
} from "@/lib/auth/credentials";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { publish, publishDinnerDates } from "@/lib/events";
import { isValidTimezone, localDate } from "@/lib/time";
import { rekeyGroceryWeeks } from "./grocery";
import { assertAdult } from "./permissions";

const timezoneSchema = z
  .string()
  .trim()
  .refine(isValidTimezone, "Unknown timezone");

export const householdSettingsSchema = z.object({
  name: z.string().trim().min(1, "Household name is required").max(60),
  timezone: timezoneSchema,
  weekStartDay: z.coerce.number().int().min(0).max(6),
  defaultServings: z.coerce.number().int().min(1, "At least 1 serving").max(50),
});

export const setupSchema = z.object({
  householdName: householdSettingsSchema.shape.name,
  timezone: timezoneSchema,
  displayName: displayNameSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export async function getHousehold(db: DbOrTx) {
  const [row] = await db.select().from(household).where(eq(household.id, 1));
  return row ?? null;
}

/** "Today" for the household, falling back to the server TZ before setup. */
export async function householdToday(db: DbOrTx, now = new Date()) {
  const h = await getHousehold(db);
  return localDate(h?.timezone ?? process.env.TZ ?? "UTC", now);
}

export async function needsSetup(db: DbOrTx): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row.n === 0;
}

/** First-run: creates the household and its first adult. Only works once. */
export async function setupHousehold(db: Db, input: z.infer<typeof setupSchema>) {
  const passwordHash = await hashSecret(input.password);
  return db.transaction(async (tx) => {
    // Serialize concurrent setup attempts.
    await tx.execute(sql`select pg_advisory_xact_lock(4242001)`);
    if (!(await needsSetup(tx))) {
      throw new ServiceError("This household is already set up.", "setup_done");
    }
    await tx
      .insert(household)
      .values({ id: 1, name: input.householdName, timezone: input.timezone })
      .onConflictDoUpdate({
        target: household.id,
        set: { name: input.householdName, timezone: input.timezone },
      });
    const [user] = await tx
      .insert(users)
      .values({
        displayName: input.displayName,
        username: input.username,
        role: "adult",
        passwordHash,
      })
      .returning({ id: users.id });
    return user.id;
  });
}

/**
 * Saves household settings. Changing the week start day moves the current
 * and future weeks' grocery check-offs and manual items to the new week
 * boundaries (SPEC §4.8); the settings screen warns about this first.
 */
export async function updateHouseholdSettings(
  db: Db,
  actor: SessionUser,
  input: z.infer<typeof householdSettingsSchema>,
  now = new Date(),
) {
  assertAdult(actor);
  const touched = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(household).where(eq(household.id, 1)).for("update");
    await tx.update(household).set(input).where(eq(household.id, 1));
    if (!before || before.weekStartDay === input.weekStartDay) return [];
    return rekeyGroceryWeeks(tx, localDate(input.timezone, now), before.weekStartDay, input.weekStartDay);
  });
  for (const weekStart of touched) publish({ type: "grocery.updated", weekStart });
}

/** Weekday (0–6) → adult user id. */
export async function getCookSchedule(db: DbOrTx): Promise<Record<number, string>> {
  const rows = await db.select().from(cookSchedule);
  return Object.fromEntries(rows.map((r) => [r.weekday, r.userId]));
}

/**
 * Replaces the default cook schedule. Per SPEC §3, upcoming planned nights
 * whose cook wasn't picked by hand follow the new schedule; past dinners are
 * untouched.
 */
export async function setCookSchedule(
  db: Db,
  actor: SessionUser,
  schedule: Record<number, string | null>,
  now = new Date(),
) {
  assertAdult(actor);
  const entries = Object.entries(schedule).map(([d, userId]) => [Number(d), userId] as const);
  for (const [weekday] of entries) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new ServiceError("Invalid weekday.");
    }
  }
  const assigned = entries.filter((e): e is readonly [number, string] => Boolean(e[1]));
  const cookIds = [...new Set(assigned.map(([, id]) => id))];
  if (cookIds.length) {
    const adults = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "adult"), isNull(users.archivedAt)));
    const adultIds = new Set(adults.map((a) => a.id));
    if (cookIds.some((id) => !adultIds.has(id))) {
      throw new ServiceError("Only active adults can be default cooks.");
    }
  }

  const h = await getHousehold(db);
  const today = await householdToday(db, now);
  const changed = await db.transaction(async (tx) => {
    const dates: string[] = [];
    for (const [weekday, userId] of entries) {
      await tx.delete(cookSchedule).where(eq(cookSchedule.weekday, weekday));
      if (userId) await tx.insert(cookSchedule).values({ weekday, userId });

      // Postgres extract(dow) uses 0 = Sunday, matching our weekday numbering.
      const rows = await tx
        .update(dinners)
        .set({ cookUserId: userId })
        .where(
          and(
            eq(dinners.status, "planned"),
            eq(dinners.cookManuallySet, false),
            gte(dinners.date, today),
            sql`extract(dow from ${dinners.date}) = ${weekday}`,
          ),
        )
        .returning({ date: dinners.date });
      dates.push(...rows.map((r) => r.date));
    }
    return dates;
  });
  publishDinnerDates(changed, h?.weekStartDay ?? 0);
}
