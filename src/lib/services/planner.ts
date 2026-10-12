import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import {
  auditLog,
  cookSchedule,
  dinners,
  dishes,
  recipeIngredients,
  recipes,
  users,
  weekUnlocks,
  type DinnerStatus,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { publishDinnerDates } from "@/lib/events";
import { addDays, isIsoDate, isPastWeek, localDate, weekdayOf, weekStartOf } from "@/lib/time";
import { getHousehold } from "./household";
import { parsePendingIngredients } from "./ingredients";
import { assertAdult } from "./permissions";

// ---------------------------------------------------------------------------
// Reads

export type DishView = {
  id: string;
  name: string;
  role: "main" | "side";
  recipe: {
    id: string;
    title: string;
    imageUrl: string | null;
    sourceUrl: string | null;
    readyInMinutes: number | null;
  } | null;
};

export type DinnerView = {
  date: string;
  /** Nights without a row read as "unplanned". */
  status: DinnerStatus;
  cook: { id: string; displayName: string; archived: boolean } | null;
  cookManuallySet: boolean;
  servingsOverride: number | null;
  /** Set when the night came from a recurring rule (SPEC §4.6). */
  recurring: { ruleId: string; overridden: boolean } | null;
  dishes: DishView[];
};

function emptyDinner(date: string): DinnerView {
  return {
    date,
    status: "unplanned",
    cook: null,
    cookManuallySet: false,
    servingsOverride: null,
    recurring: null,
    dishes: [],
  };
}

/** Dinners for every date in [from, to], in order. */
export async function getDinners(db: DbOrTx, from: string, to: string): Promise<DinnerView[]> {
  const rows = await db
    .select({
      id: dinners.id,
      date: dinners.date,
      status: dinners.status,
      cookManuallySet: dinners.cookManuallySet,
      servingsOverride: dinners.servingsOverride,
      recurringRuleId: dinners.recurringRuleId,
      overridden: dinners.overridden,
      cookId: users.id,
      cookName: users.displayName,
      cookArchivedAt: users.archivedAt,
    })
    .from(dinners)
    .leftJoin(users, eq(users.id, dinners.cookUserId))
    .where(and(gte(dinners.date, from), lte(dinners.date, to)));

  const dishRows = rows.length
    ? await db
        .select({
          dinnerId: dishes.dinnerId,
          id: dishes.id,
          role: dishes.role,
          freeTextName: dishes.freeTextName,
          recipeId: recipes.id,
          title: recipes.title,
          imageUrl: recipes.imageUrl,
          sourceUrl: recipes.sourceUrl,
          readyInMinutes: recipes.readyInMinutes,
        })
        .from(dishes)
        .leftJoin(recipes, eq(recipes.id, dishes.recipeId))
        .where(inArray(dishes.dinnerId, rows.map((r) => r.id)))
        .orderBy(asc(dishes.position))
    : [];

  const byDate = new Map<string, DinnerView>();
  for (const r of rows) {
    byDate.set(r.date, {
      date: r.date,
      status: r.status,
      cook: r.cookId ? { id: r.cookId, displayName: r.cookName!, archived: r.cookArchivedAt !== null } : null,
      cookManuallySet: r.cookManuallySet,
      servingsOverride: r.servingsOverride,
      recurring: r.recurringRuleId ? { ruleId: r.recurringRuleId, overridden: r.overridden } : null,
      dishes: dishRows
        .filter((d) => d.dinnerId === r.id)
        .map((d) => ({
          id: d.id,
          role: d.role,
          name: d.title ?? d.freeTextName ?? "",
          recipe: d.recipeId
            ? {
                id: d.recipeId,
                title: d.title!,
                imageUrl: d.imageUrl,
                sourceUrl: d.sourceUrl,
                readyInMinutes: d.readyInMinutes,
              }
            : null,
        })),
    });
  }

  const out: DinnerView[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    out.push(byDate.get(date) ?? emptyDinner(date));
  }
  return out;
}

export async function getDinner(db: DbOrTx, date: string): Promise<DinnerView> {
  const [dinner] = await getDinners(db, date, date);
  return dinner;
}

export async function getWeek(db: DbOrTx, weekStart: string): Promise<DinnerView[]> {
  return getDinners(db, weekStart, addDays(weekStart, 6));
}

/** Open work in a week from today on: empty nights and planned nights with no cook. */
export function weekGaps(week: DinnerView[], today: string) {
  const upcoming = week.filter((d) => d.date >= today);
  return {
    unplanned: upcoming.filter((d) => d.status === "unplanned").length,
    withoutCook: upcoming.filter((d) => d.status === "planned" && !d.cook).length,
  };
}

/** The household's calendar position: today and its week, in the household timezone. */
export async function plannerCalendar(db: DbOrTx, now = new Date()) {
  const h = await getHousehold(db);
  if (!h) throw new ServiceError("The household isn't set up yet.", "not_found");
  const today = localDate(h.timezone, now);
  return {
    today,
    weekStartDay: h.weekStartDay,
    defaultServings: h.defaultServings,
    currentWeekStart: weekStartOf(today, h.weekStartDay),
  };
}

/**
 * Whether `actor` may edit the week starting `weekStart`. Past weeks are
 * read-only unless unlocked in the actor's current session (SPEC §4.9).
 */
export async function weekAccess(db: DbOrTx, actor: SessionUser, weekStart: string, today: string) {
  const past = isPastWeek(weekStart, today);
  const unlocked = past && (await isWeekUnlocked(db, actor, weekStart));
  return { past, unlocked, editable: actor.role === "adult" && (!past || unlocked) };
}

async function isWeekUnlocked(db: DbOrTx, actor: SessionUser, weekStart: string) {
  if (!actor.sessionId) return false;
  const [row] = await db
    .select({ weekStartDate: weekUnlocks.weekStartDate })
    .from(weekUnlocks)
    .where(and(eq(weekUnlocks.sessionTokenHash, actor.sessionId), eq(weekUnlocks.weekStartDate, weekStart)));
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Mutations

export type DinnerRow = typeof dinners.$inferSelect;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function assertDate(date: string) {
  if (!isIsoDate(date)) throw new ServiceError("Invalid date.");
}

/**
 * Shared wrapper for every change to one night: checks the role and the
 * past-week lock, locks (creating if needed) the dinner row, marks recurring
 * instances as overridden, and publishes the change.
 */
export async function editDinner<T>(
  db: Db,
  actor: SessionUser,
  date: string,
  now: Date,
  fn: (tx: Tx, dinner: DinnerRow) => Promise<T>,
): Promise<T> {
  assertAdult(actor);
  assertDate(date);
  const cal = await plannerCalendar(db, now);
  const weekStart = weekStartOf(date, cal.weekStartDay);
  const result = await db.transaction(async (tx) => {
    if (!(await weekAccess(tx, actor, weekStart, cal.today)).editable) {
      throw new ServiceError("This week is in the past. Unlock it to make changes.", "locked");
    }
    await tx.insert(dinners).values({ date }).onConflictDoNothing({ target: dinners.date });
    const [dinner] = await tx.select().from(dinners).where(eq(dinners.date, date)).for("update");
    const out = await fn(tx, dinner);
    // Any edit detaches a recurring instance from its rule (SPEC §4.6).
    if (dinner.recurringRuleId) {
      await tx.update(dinners).set({ overridden: true }).where(eq(dinners.id, dinner.id));
    }
    return out;
  });
  publishDinnerDates([date], cal.weekStartDay);
  return result;
}

export async function defaultCookFor(tx: DbOrTx, date: string): Promise<string | null> {
  const [row] = await tx
    .select({ userId: cookSchedule.userId })
    .from(cookSchedule)
    .where(eq(cookSchedule.weekday, weekdayOf(date)));
  return row?.userId ?? null;
}

/** A night gaining its first dish becomes planned and gets the default cook. */
export async function markPlanned(tx: Tx, dinner: DinnerRow) {
  if (dinner.status === "planned") return;
  await tx
    .update(dinners)
    .set({ status: "planned", cookUserId: await defaultCookFor(tx, dinner.date), cookManuallySet: false })
    .where(eq(dinners.id, dinner.id));
}

/** Leaving "planned" drops all dishes and the cook (eat out / leftovers have neither). */
async function clearNight(tx: Tx, dinner: DinnerRow, status: Exclude<DinnerStatus, "planned">) {
  await tx.delete(dishes).where(eq(dishes.dinnerId, dinner.id));
  await tx
    .update(dinners)
    .set({ status, cookUserId: null, cookManuallySet: false })
    .where(eq(dinners.id, dinner.id));
}

async function assertActiveAdult(tx: DbOrTx, userId: string) {
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "adult"), isNull(users.archivedAt)));
  if (!u) throw new ServiceError("Only active adults can cook.");
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .transform((v) => v || null);

/** Optional recipe details, shared by manual entry and the suggest flow's confirm step. */
export const recipeDetailFields = {
  /** One ingredient per line. */
  ingredients: z
    .string()
    .max(5000, "Too many ingredients")
    .transform((v) =>
      v
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  sourceUrl: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), z.url({ protocol: /^https?$/, error: "Enter a full web address (https://…)" })]))
    .transform((v) => v || null),
  readyInMinutes: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(
      z
        .number({ error: "Ready time must be a number of minutes" })
        .int("Ready time must be whole minutes")
        .min(1, "Ready time must be at least 1 minute")
        .max(1440, "Ready time must be under a day")
        .nullable(),
    ),
};

export const manualDishSchema = z.object({
  name: z.string().trim().min(1, "Dish name is required").max(120, "Dish name is too long"),
  role: z.enum(["main", "side"], { error: "Pick main or side" }),
  ...recipeDetailFields,
  notes: optionalText(2000, "Notes"),
  saveToLibrary: z.boolean(),
});

export type ManualDishInput = z.input<typeof manualDishSchema>;

/**
 * Adds a typed-in dish (SPEC §4.4). With "Save to library" it becomes a
 * library recipe. Without it, a bare name is stored as free text, while a
 * dish with details gets a hidden (archived) recipe so its ingredients can
 * still feed the grocery list (SPEC §9).
 */
export async function addManualDish(
  db: Db,
  actor: SessionUser,
  date: string,
  input: ManualDishInput,
  now = new Date(),
) {
  assertAdult(actor);
  const dish = manualDishSchema.parse(input);
  const hasDetails = dish.ingredients.length > 0 || dish.sourceUrl || dish.readyInMinutes || dish.notes;

  // Assigned inside the transaction callback.
  let recipeId = null as string | null;
  const dishId = await editDinner(db, actor, date, now, async (tx, dinner) => {
    if (dish.saveToLibrary || hasDetails) {
      const [recipe] = await tx
        .insert(recipes)
        .values({
          source: "manual",
          title: dish.name,
          dishType: dish.role,
          readyInMinutes: dish.readyInMinutes,
          sourceUrl: dish.sourceUrl,
          notes: dish.notes,
          archivedAt: dish.saveToLibrary ? null : now,
        })
        .returning({ id: recipes.id });
      recipeId = recipe.id;
      if (dish.ingredients.length) {
        await tx
          .insert(recipeIngredients)
          .values(dish.ingredients.map((rawText, position) => ({ recipeId: recipe.id, rawText, position })));
      }
    }

    const id = await appendDish(
      tx,
      dinner,
      recipeId ? { recipeId, role: dish.role } : { freeTextName: dish.name, role: dish.role },
    );
    await markPlanned(tx, dinner);
    return id;
  });
  // After the transaction: a slow or failed API call never holds the night's lock.
  if (recipeId) await parsePendingIngredients(db, { recipeIds: [recipeId], now });
  return dishId;
}

/** Adds a dish after the night's existing ones. Call `markPlanned` once afterwards. */
export async function appendDish(
  tx: Tx,
  dinner: DinnerRow,
  dish: ({ recipeId: string; freeTextName?: never } | { freeTextName: string; recipeId?: never }) & {
    role: "main" | "side";
  },
): Promise<string> {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${dishes.position}) + 1, 0)::int` })
    .from(dishes)
    .where(eq(dishes.dinnerId, dinner.id));
  const [row] = await tx
    .insert(dishes)
    .values({
      dinnerId: dinner.id,
      recipeId: dish.recipeId ?? null,
      freeTextName: dish.freeTextName ?? null,
      role: dish.role,
      position: next,
    })
    .returning({ id: dishes.id });
  return row.id;
}

async function dateOfDish(db: DbOrTx, dishId: string): Promise<string> {
  const [row] = await db
    .select({ date: dinners.date })
    .from(dishes)
    .innerJoin(dinners, eq(dinners.id, dishes.dinnerId))
    .where(eq(dishes.id, dishId));
  if (!row) throw new ServiceError("That dish no longer exists.", "not_found");
  return row.date;
}

/** Ordered dish ids for a (locked) dinner. */
async function dishOrder(tx: Tx, dinnerId: string) {
  const rows = await tx
    .select({ id: dishes.id })
    .from(dishes)
    .where(eq(dishes.dinnerId, dinnerId))
    .orderBy(asc(dishes.position));
  return rows.map((r) => r.id);
}

/** Removing the last dish returns the night to unplanned. */
export async function removeDish(db: Db, actor: SessionUser, dishId: string, now = new Date()) {
  assertAdult(actor);
  const date = await dateOfDish(db, dishId);
  await editDinner(db, actor, date, now, async (tx, dinner) => {
    const order = await dishOrder(tx, dinner.id);
    if (!order.includes(dishId)) throw new ServiceError("That dish no longer exists.", "not_found");
    if (order.length === 1) return clearNight(tx, dinner, "unplanned");
    await tx.delete(dishes).where(eq(dishes.id, dishId));
  });
}

export async function moveDish(
  db: Db,
  actor: SessionUser,
  dishId: string,
  direction: "up" | "down",
  now = new Date(),
) {
  assertAdult(actor);
  const date = await dateOfDish(db, dishId);
  await editDinner(db, actor, date, now, async (tx, dinner) => {
    const order = await dishOrder(tx, dinner.id);
    const i = order.indexOf(dishId);
    if (i === -1) throw new ServiceError("That dish no longer exists.", "not_found");
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    // Rewrite positions densely; the dinner row lock serializes concurrent moves.
    for (const [position, id] of order.entries()) {
      await tx.update(dishes).set({ position }).where(eq(dishes.id, id));
    }
  });
}

/**
 * Marks a night Eat out / Leftovers, or clears it back to unplanned. Any
 * dishes on the night are removed (the UI confirms first).
 */
export async function setDinnerStatus(
  db: Db,
  actor: SessionUser,
  date: string,
  status: "eat_out" | "leftovers" | "unplanned",
  now = new Date(),
) {
  assertAdult(actor);
  if (!["eat_out", "leftovers", "unplanned"].includes(status)) throw new ServiceError("Invalid status.");
  await editDinner(db, actor, date, now, (tx, dinner) => clearNight(tx, dinner, status));
}

/**
 * Sets the night's cook and servings override. Choosing a different cook
 * pins it (`cookManuallySet`) so schedule changes leave it alone.
 */
export async function updateDinnerDetails(
  db: Db,
  actor: SessionUser,
  date: string,
  input: { cookUserId: string | null; servingsOverride: number | null },
  now = new Date(),
) {
  assertAdult(actor);
  const servings = z
    .number()
    .int("Servings must be a whole number")
    .min(1, "At least 1 serving")
    .max(50, "At most 50 servings")
    .nullable()
    .parse(input.servingsOverride);
  await editDinner(db, actor, date, now, async (tx, dinner) => {
    if (dinner.status !== "planned") throw new ServiceError("Add a dish before picking a cook.");
    const cookChanged = input.cookUserId !== dinner.cookUserId;
    if (cookChanged && input.cookUserId) await assertActiveAdult(tx, input.cookUserId);
    await tx
      .update(dinners)
      .set({
        servingsOverride: servings,
        ...(cookChanged ? { cookUserId: input.cookUserId, cookManuallySet: true } : {}),
      })
      .where(eq(dinners.id, dinner.id));
  });
}

/** Hands the night back to the default cook schedule. */
export async function resetDinnerCook(db: Db, actor: SessionUser, date: string, now = new Date()) {
  assertAdult(actor);
  await editDinner(db, actor, date, now, async (tx, dinner) => {
    if (dinner.status !== "planned") return;
    await tx
      .update(dinners)
      .set({ cookUserId: await defaultCookFor(tx, date), cookManuallySet: false })
      .where(eq(dinners.id, dinner.id));
  });
}

/**
 * Unlocks a past week for the rest of the actor's session, and logs who did
 * it (SPEC §4.9). Returns the week's start date.
 */
export async function unlockWeek(db: Db, actor: SessionUser, date: string, now = new Date()) {
  assertAdult(actor);
  assertDate(date);
  const cal = await plannerCalendar(db, now);
  const weekStart = weekStartOf(date, cal.weekStartDay);
  if (!isPastWeek(weekStart, cal.today)) return weekStart;
  if (!actor.sessionId) throw new ServiceError("Sign in again to unlock this week.");
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(weekUnlocks)
      .values({ sessionTokenHash: actor.sessionId!, weekStartDate: weekStart })
      .onConflictDoNothing()
      .returning({ weekStartDate: weekUnlocks.weekStartDate });
    if (inserted.length) {
      await tx.insert(auditLog).values({ userId: actor.id, action: "week.unlock", details: { weekStart } });
    }
  });
  return weekStart;
}
