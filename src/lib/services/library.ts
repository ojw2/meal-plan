import { and, asc, desc, eq, ilike, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { dinners, dishes, recipeIngredients, recipes } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { publish } from "@/lib/events";
import { appendDish, editDinner, markPlanned } from "./planner";
import { assertAdult } from "./permissions";

// The household library (SPEC §4.5): every recipe that isn't archived, with
// its history from past dinners. Recipes are archived, never deleted, so
// past dinners always resolve.

export type LibraryFilter = {
  /** Title search. */
  q?: string;
  role?: "main" | "side";
  favorites?: boolean;
  /** List archived recipes instead of the library. */
  archived?: boolean;
};

export type LibraryItem = {
  id: string;
  title: string;
  dishType: "main" | "side";
  imageUrl: string | null;
  readyInMinutes: number | null;
  isFavorite: boolean;
  archived: boolean;
  /** Date of the most recent planned dinner before today that used it. */
  lastMade: string | null;
  /** Past planned dinners that used it. */
  timesMade: number;
};

/** Ids arrive from URLs and forms; a malformed one is just "not found". */
const isId = (id: string) => z.uuid().safeParse(id).success;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Per-recipe history from planned dinners before `today`. */
function history(db: DbOrTx, today: string) {
  return db
    .select({
      recipeId: dishes.recipeId,
      lastMade: sql<string>`max(${dinners.date})::text`.as("last_made"),
      timesMade: sql<number>`count(distinct ${dinners.id})::int`.as("times_made"),
    })
    .from(dishes)
    .innerJoin(dinners, eq(dinners.id, dishes.dinnerId))
    .where(and(isNotNull(dishes.recipeId), lt(dinners.date, today), eq(dinners.status, "planned")))
    .groupBy(dishes.recipeId)
    .as("history");
}

/**
 * Library recipes matching `filter`. `order: "title"` sorts alphabetically
 * (the library page); `"picker"` puts favorites first, then the least
 * recently made, to discourage repeats (the day editor's "From library").
 */
export async function listLibrary(
  db: DbOrTx,
  filter: LibraryFilter,
  today: string,
  order: "title" | "picker" = "title",
): Promise<LibraryItem[]> {
  const h = history(db, today);
  const q = filter.q?.trim();
  const rows = await db
    .select({
      id: recipes.id,
      title: recipes.title,
      dishType: recipes.dishType,
      imageUrl: recipes.imageUrl,
      readyInMinutes: recipes.readyInMinutes,
      isFavorite: recipes.isFavorite,
      archivedAt: recipes.archivedAt,
      lastMade: h.lastMade,
      timesMade: h.timesMade,
    })
    .from(recipes)
    .leftJoin(h, eq(h.recipeId, recipes.id))
    .where(
      and(
        filter.archived ? isNotNull(recipes.archivedAt) : isNull(recipes.archivedAt),
        q ? ilike(recipes.title, `%${escapeLike(q)}%`) : undefined,
        filter.role ? eq(recipes.dishType, filter.role) : undefined,
        filter.favorites ? eq(recipes.isFavorite, true) : undefined,
      ),
    )
    .orderBy(
      ...(order === "picker"
        ? [desc(recipes.isFavorite), sql`${h.lastMade} asc nulls first`, asc(recipes.title)]
        : [asc(sql`lower(${recipes.title})`)]),
    );
  return rows.map(({ archivedAt, lastMade, timesMade, ...r }) => ({
    ...r,
    archived: archivedAt !== null,
    lastMade: lastMade ?? null,
    timesMade: timesMade ?? 0,
  }));
}

export type RecipeDetails = LibraryItem & {
  source: "spoonacular" | "manual";
  servings: number | null;
  sourceUrl: string | null;
  notes: string | null;
  ingredients: string[];
};

/** One recipe, archived or not (past dinners link to archived ones too). */
export async function getRecipeDetails(db: DbOrTx, id: string, today: string): Promise<RecipeDetails | null> {
  if (!isId(id)) return null;
  const h = history(db, today);
  const [row] = await db
    .select({ recipe: recipes, lastMade: h.lastMade, timesMade: h.timesMade })
    .from(recipes)
    .leftJoin(h, eq(h.recipeId, recipes.id))
    .where(eq(recipes.id, id));
  if (!row) return null;
  const lines = await db
    .select({ rawText: recipeIngredients.rawText })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, id))
    .orderBy(asc(recipeIngredients.position));
  const r = row.recipe;
  return {
    id: r.id,
    title: r.title,
    dishType: r.dishType,
    imageUrl: r.imageUrl,
    readyInMinutes: r.readyInMinutes,
    isFavorite: r.isFavorite,
    archived: r.archivedAt !== null,
    lastMade: row.lastMade ?? null,
    timesMade: row.timesMade ?? 0,
    source: r.source,
    servings: r.servings,
    sourceUrl: r.sourceUrl,
    notes: r.notes,
    ingredients: lines.map((l) => l.rawText),
  };
}

/** Whole days between two dates (`to` - `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Made yesterday", "Last made 12 days ago", or "Not made yet". */
export function lastMadeLabel(item: Pick<LibraryItem, "lastMade">, today: string): string {
  if (!item.lastMade) return "Not made yet";
  const days = daysBetween(item.lastMade, today);
  return days === 1 ? "Last made yesterday" : `Last made ${days} days ago`;
}

// ---------------------------------------------------------------------------
// Mutations

async function updateRecipe(db: DbOrTx, id: string, set: Partial<typeof recipes.$inferInsert>) {
  if (!isId(id)) throw new ServiceError("That recipe no longer exists.", "not_found");
  const [row] = await db.update(recipes).set(set).where(eq(recipes.id, id)).returning({ id: recipes.id });
  if (!row) throw new ServiceError("That recipe no longer exists.", "not_found");
  publish({ type: "recipe.updated", recipeId: id });
}

export async function setFavorite(db: DbOrTx, actor: SessionUser, id: string, isFavorite: boolean) {
  assertAdult(actor);
  await updateRecipe(db, id, { isFavorite });
}

/** Hides a recipe from the library and pickers. Past and planned dinners keep it. */
export async function archiveRecipe(db: DbOrTx, actor: SessionUser, id: string, now = new Date()) {
  assertAdult(actor);
  await updateRecipe(db, id, { archivedAt: now });
}

export async function restoreRecipe(db: DbOrTx, actor: SessionUser, id: string) {
  assertAdult(actor);
  await updateRecipe(db, id, { archivedAt: null });
}

/** "From library": adds a library recipe to a night in its own role. */
export async function addLibraryDish(db: Db, actor: SessionUser, date: string, recipeId: string, now = new Date()) {
  assertAdult(actor);
  if (!isId(recipeId)) throw new ServiceError("That recipe is no longer in the library.", "not_found");
  return editDinner(db, actor, date, now, async (tx, dinner) => {
    const [recipe] = await tx
      .select({ id: recipes.id, dishType: recipes.dishType })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), isNull(recipes.archivedAt)));
    if (!recipe) throw new ServiceError("That recipe is no longer in the library.", "not_found");
    const id = await appendDish(tx, dinner, { recipeId: recipe.id, role: recipe.dishType });
    await markPlanned(tx, dinner);
    return id;
  });
}
