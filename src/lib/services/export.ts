import { asc } from "drizzle-orm";
import type { Db } from "@/db";
import {
  cookSchedule,
  dinners,
  dishes,
  groceryChecks,
  household,
  manualGroceryItems,
  recipeIngredients,
  recipes,
  recurringRules,
  users,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { assertAdult } from "./permissions";

export const EXPORT_FORMAT = "meal-plan-export";
export const EXPORT_VERSION = 1;

/**
 * Everything the household has entered (SPEC §4.10, §12): settings, members
 * (without password or PIN hashes), recipes, dinners, dishes, recurring
 * rules and grocery state. Sessions, login attempts, the Spoonacular cache
 * and quota, and week unlocks are left out. Adults only.
 */
export async function exportHousehold(db: Db, actor: SessionUser, now = new Date()) {
  assertAdult(actor);
  // One consistent snapshot across all tables.
  const data = await db.transaction(
    async (tx) => {
      const [settings] = await tx
        .select({
          name: household.name,
          timezone: household.timezone,
          weekStartDay: household.weekStartDay,
          defaultServings: household.defaultServings,
          createdAt: household.createdAt,
        })
        .from(household);
      return Promise.all([
        settings ?? null,
        tx.select().from(cookSchedule).orderBy(asc(cookSchedule.weekday)),
        // Columns listed explicitly so credential hashes can never leak.
        tx
          .select({
            id: users.id,
            displayName: users.displayName,
            username: users.username,
            role: users.role,
            archivedAt: users.archivedAt,
            createdAt: users.createdAt,
          })
          .from(users)
          .orderBy(asc(users.createdAt), asc(users.id)),
        tx.select().from(recipes).orderBy(asc(recipes.createdAt), asc(recipes.id)),
        tx.select().from(recipeIngredients).orderBy(asc(recipeIngredients.position)),
        tx.select().from(dinners).orderBy(asc(dinners.date)),
        tx.select().from(dishes).orderBy(asc(dishes.position)),
        tx.select().from(recurringRules).orderBy(asc(recurringRules.createdAt), asc(recurringRules.id)),
        tx.select().from(groceryChecks).orderBy(asc(groceryChecks.weekStartDate), asc(groceryChecks.itemKey)),
        tx
          .select()
          .from(manualGroceryItems)
          .orderBy(asc(manualGroceryItems.weekStartDate), asc(manualGroceryItems.createdAt)),
      ]);
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const [settings, schedule, members, recipeRows, ingredientRows, dinnerRows, dishRows, rules, checks, manual] = data;
  const ingredientsByRecipe = groupBy(ingredientRows, (i) => i.recipeId);
  const dishesByDinner = groupBy(dishRows, (d) => d.dinnerId);

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    household: settings,
    cookSchedule: schedule,
    users: members,
    recipes: recipeRows.map((r) => ({ ...r, ingredients: ingredientsByRecipe.get(r.id) ?? [] })),
    dinners: dinnerRows.map((d) => ({ ...d, dishes: dishesByDinner.get(d.id) ?? [] })),
    recurringRules: rules,
    grocery: { checks, manualItems: manual },
  };
}

export type HouseholdExport = Awaited<ReturnType<typeof exportHousehold>>;

/** Groups rows by key, keeping their order. */
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}
