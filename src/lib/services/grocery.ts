import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { dinners, dishes, groceryChecks, manualGroceryItems, recipeIngredients, recipes } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { publish } from "@/lib/events";
import {
  aggregate,
  applyChecks,
  scaleFor,
  type CheckRow,
  type DishSource,
  type GroceryList,
  type IngredientLine,
} from "@/lib/grocery/aggregate";
import { addDays, isIsoDate, weekStartOf } from "@/lib/time";
import { assertAdult } from "./permissions";
import { plannerCalendar, weekAccess } from "./planner";

// The grocery list (SPEC §4.8) is derived on read from the week's planned
// dishes. Only check-offs (with an amount snapshot) and manual items are
// stored, keyed by the week's first day.

export type ManualItem = { id: string; text: string; checked: boolean };

export type WeekGroceries = GroceryList & { manual: ManualItem[] };

/** Every dish with ingredients on the week's planned nights, scaled. */
export async function weekSources(db: DbOrTx, weekStart: string, defaultServings: number): Promise<DishSource[]> {
  const rows = await db
    .select({
      date: dinners.date,
      servingsOverride: dinners.servingsOverride,
      recipeId: recipes.id,
      title: recipes.title,
      servings: recipes.servings,
    })
    .from(dishes)
    .innerJoin(dinners, eq(dinners.id, dishes.dinnerId))
    .innerJoin(recipes, eq(recipes.id, dishes.recipeId))
    .where(and(eq(dinners.status, "planned"), gte(dinners.date, weekStart), lte(dinners.date, addDays(weekStart, 6))))
    .orderBy(asc(dinners.date), asc(dishes.position));
  if (!rows.length) return [];

  const lines = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      rawText: recipeIngredients.rawText,
      name: recipeIngredients.name,
      ingredientId: recipeIngredients.spoonacularIngredientId,
      amount: recipeIngredients.amount,
      unit: recipeIngredients.unit,
      aisle: recipeIngredients.aisle,
    })
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.recipeId, [...new Set(rows.map((r) => r.recipeId))]))
    .orderBy(asc(recipeIngredients.position));
  const byRecipe = new Map<string, IngredientLine[]>();
  for (const { recipeId, ...line } of lines) byRecipe.set(recipeId, [...(byRecipe.get(recipeId) ?? []), line]);

  // Dishes without ingredients (and free-text dishes) contribute nothing.
  return rows
    .filter((r) => byRecipe.has(r.recipeId))
    .map((r) => ({
      dishName: r.title,
      date: r.date,
      scale: scaleFor(r.servingsOverride ?? defaultServings, r.servings),
      ingredients: byRecipe.get(r.recipeId)!,
    }));
}

async function weekChecks(db: DbOrTx, weekStart: string): Promise<CheckRow[]> {
  return db
    .select({
      itemKey: groceryChecks.itemKey,
      checked: groceryChecks.checked,
      snapshot: groceryChecks.checkedAmountSnapshot,
      label: groceryChecks.label,
    })
    .from(groceryChecks)
    .where(eq(groceryChecks.weekStartDate, weekStart));
}

export async function getGroceryList(db: DbOrTx, weekStart: string): Promise<WeekGroceries> {
  const cal = await plannerCalendar(db);
  const [sources, checks, manual] = await Promise.all([
    weekSources(db, weekStart, cal.defaultServings),
    weekChecks(db, weekStart),
    db
      .select({ id: manualGroceryItems.id, text: manualGroceryItems.text, checked: manualGroceryItems.checked })
      .from(manualGroceryItems)
      .where(eq(manualGroceryItems.weekStartDate, weekStart))
      .orderBy(asc(manualGroceryItems.createdAt), asc(manualGroceryItems.id)),
  ]);
  return { ...applyChecks(aggregate(sources), checks), manual };
}

// ---------------------------------------------------------------------------
// Mutations

/**
 * Shared checks for every grocery change: adults only, a real week start,
 * and the past-week lock (SPEC §4.9). Publishes the change afterwards.
 */
async function editWeek<T>(
  db: Db,
  actor: SessionUser,
  weekStart: string,
  now: Date,
  fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0], defaultServings: number) => Promise<T>,
): Promise<T> {
  assertAdult(actor);
  const cal = await plannerCalendar(db, now);
  if (!isIsoDate(weekStart) || weekStartOf(weekStart, cal.weekStartDay) !== weekStart) {
    throw new ServiceError("Invalid week.");
  }
  const result = await db.transaction(async (tx) => {
    if (!(await weekAccess(tx, actor, weekStart, cal.today)).editable) {
      throw new ServiceError("This week is in the past. Unlock it to make changes.", "locked");
    }
    return fn(tx, cal.defaultServings);
  });
  publish({ type: "grocery.updated", weekStart });
  return result;
}

/**
 * Checks or unchecks an item (all of its unit buckets). Checking stores
 * what's needed right now, computed here rather than trusted from the
 * client, so a later increase can resurface the item.
 */
export async function setItemChecked(
  db: Db,
  actor: SessionUser,
  weekStart: string,
  key: string,
  checked: boolean,
  now = new Date(),
) {
  await editWeek(db, actor, weekStart, now, async (tx, defaultServings) => {
    if (!checked) {
      // Unchecking forgets the item, including in "No longer needed".
      await tx
        .delete(groceryChecks)
        .where(and(eq(groceryChecks.weekStartDate, weekStart), sql`starts_with(${groceryChecks.itemKey}, ${`${key}|`})`));
      return;
    }
    const item = aggregate(await weekSources(tx, weekStart, defaultServings)).find((i) => i.key === key);
    if (!item) throw new ServiceError("That item is no longer on the list.", "not_found");
    const label = item.text ? `${item.name}: ${item.text}` : item.name;
    for (const b of item.buckets) {
      const values = {
        checked: true,
        checkedAmountSnapshot: b.amount,
        label,
        checkedBy: actor.id,
        checkedAt: now,
      };
      await tx
        .insert(groceryChecks)
        .values({ weekStartDate: weekStart, itemKey: b.itemKey, ...values })
        .onConflictDoUpdate({ target: [groceryChecks.weekStartDate, groceryChecks.itemKey], set: values });
    }
  });
}

const manualText = z.string().trim().min(1, "Enter an item").max(200, "That item is too long");

export async function addManualItem(db: Db, actor: SessionUser, weekStart: string, text: string, now = new Date()) {
  const value = manualText.parse(text);
  return editWeek(db, actor, weekStart, now, async (tx) => {
    const [row] = await tx
      .insert(manualGroceryItems)
      .values({ weekStartDate: weekStart, text: value, createdBy: actor.id })
      .returning({ id: manualGroceryItems.id });
    return row.id;
  });
}

async function manualItemWeek(db: DbOrTx, id: string): Promise<string> {
  const [row] = z.uuid().safeParse(id).success
    ? await db
        .select({ weekStart: manualGroceryItems.weekStartDate })
        .from(manualGroceryItems)
        .where(eq(manualGroceryItems.id, id))
    : [];
  if (!row) throw new ServiceError("That item no longer exists.", "not_found");
  return row.weekStart;
}

export async function setManualItemChecked(db: Db, actor: SessionUser, id: string, checked: boolean, now = new Date()) {
  assertAdult(actor);
  const weekStart = await manualItemWeek(db, id);
  await editWeek(db, actor, weekStart, now, (tx) =>
    tx.update(manualGroceryItems).set({ checked }).where(eq(manualGroceryItems.id, id)),
  );
}

export async function deleteManualItem(db: Db, actor: SessionUser, id: string, now = new Date()) {
  assertAdult(actor);
  const weekStart = await manualItemWeek(db, id);
  await editWeek(db, actor, weekStart, now, (tx) => tx.delete(manualGroceryItems).where(eq(manualGroceryItems.id, id)));
}

// ---------------------------------------------------------------------------
// Week start changes

/**
 * Moves the current and future weeks' check-offs and manual items to the
 * new week boundaries (SPEC §4.8). The current week maps to the new current
 * week; each later week maps to the new week holding most of its days.
 * When two weeks land on one, the most recent check of an item wins.
 * Called inside the settings transaction. Returns the weeks touched.
 */
export async function rekeyGroceryWeeks(
  tx: DbOrTx,
  today: string,
  oldStartDay: number,
  newStartDay: number,
): Promise<string[]> {
  if (oldStartDay === newStartDay) return [];
  const currentOld = weekStartOf(today, oldStartDay);
  const remap = (week: string) =>
    week === currentOld ? weekStartOf(today, newStartDay) : weekStartOf(addDays(week, 3), newStartDay);

  const touched = new Set<string>();
  const manual = await tx
    .select({ id: manualGroceryItems.id, week: manualGroceryItems.weekStartDate })
    .from(manualGroceryItems)
    .where(gte(manualGroceryItems.weekStartDate, currentOld));
  for (const m of manual) {
    touched.add(remap(m.week));
    await tx.update(manualGroceryItems).set({ weekStartDate: remap(m.week) }).where(eq(manualGroceryItems.id, m.id));
  }

  const checks = await tx.select().from(groceryChecks).where(gte(groceryChecks.weekStartDate, currentOld));
  if (checks.length) {
    const merged = new Map<string, (typeof checks)[number]>();
    for (const c of checks) {
      const moved = { ...c, weekStartDate: remap(c.weekStartDate) };
      const id = `${moved.weekStartDate} ${moved.itemKey}`;
      const prev = merged.get(id);
      if (!prev || (moved.checkedAt?.getTime() ?? 0) > (prev.checkedAt?.getTime() ?? 0)) merged.set(id, moved);
      touched.add(moved.weekStartDate);
    }
    await tx.delete(groceryChecks).where(gte(groceryChecks.weekStartDate, currentOld));
    await tx.insert(groceryChecks).values([...merged.values()]).onConflictDoNothing();
  }
  return [...touched];
}
