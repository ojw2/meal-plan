import { and, asc, desc, eq, exists, ilike, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { recipeIngredients, recipes } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import {
  complexSearch,
  getQuota,
  isQuotaLow,
  QuotaExhaustedError,
  type CallOptions,
} from "@/lib/spoonacular/client";
import {
  collectWithRelaxation,
  MAX_EXTRAS,
  newLadderCursor,
  PAGE_SIZE,
  relaxationSteps,
} from "@/lib/spoonacular/relax";
import { ingredientLines } from "@/lib/spoonacular/types";
import { appendDish, editDinner, markPlanned, recipeDetailFields, type Tx } from "./planner";
import { parsePendingIngredients } from "./ingredients";
import { assertAdult } from "./permissions";

// The suggest flow (SPEC §4.3): library matches first, then Spoonacular
// results with constraint relaxation, then commit. Spoonacular's terms only
// allow keeping a recipe's id, title and image, so the rest of a chosen
// recipe (ingredients, servings, time, link) is the household's own copy,
// confirmed and edited by an adult before saving (SPEC §9).

const role = z.enum(["main", "side"], { error: "Pick main or side" });


// ---------------------------------------------------------------------------
// Search

export type LibraryMatch = {
  recipeId: string;
  title: string;
  imageUrl: string | null;
  readyInMinutes: number | null;
  sourceUrl: string | null;
  isFavorite: boolean;
  spoonacularId: number | null;
  /** Extra ingredients this recipe doesn't mention. */
  missingExtras: string[];
};

export type Suggestion = {
  spoonacularId: number;
  title: string;
  imageUrl: string | null;
  readyInMinutes: number | null;
  servings: number | null;
  sourceUrl: string | null;
  sourceName: string | null;
  /** Prefill for the confirm step; not stored unless an adult saves it. */
  ingredients: string[];
  /** Over the time budget (found by relaxing it). */
  overBudget: boolean;
  /** Found by text match rather than as a required ingredient. */
  similarTo: string | null;
  /** Extra ingredients this recipe doesn't use (found once they were dropped). */
  missingExtras: string[];
  /** Already in the library (not archived): picking it reuses that recipe. */
  libraryRecipeId: string | null;
};

// One entry per relaxation step: 4, or 5 with extra ingredients.
const cursorSchema = z.object({
  offsets: z.array(z.number().int().min(0).max(10_000)).min(4).max(5),
  done: z.array(z.boolean()).min(4).max(5),
  shownIds: z.array(z.number().int()).max(500),
});
export type SuggestCursor = z.infer<typeof cursorSchema>;

const ingredientName = z.string().trim().min(1, "Enter an ingredient").max(60, "That ingredient is too long");

export const suggestRequestSchema = z.object({
  role,
  /** The main protein, or the side's main ingredient. Always required. */
  ingredient: ingredientName,
  /** Ingredients to cook it with ("lemon", "garlic"). Required at first, dropped if too few match. */
  extras: z
    .array(ingredientName)
    .max(MAX_EXTRAS, `Add at most ${MAX_EXTRAS} extra ingredients`)
    .default([]),
  maxTime: z
    .number({ error: "Pick a time budget" })
    .int("Time must be whole minutes")
    .min(5, "Allow at least 5 minutes")
    .max(600, "Keep it under 10 hours"),
  /** Absent for the first page; echoed back for "Show 3 more". */
  cursor: cursorSchema.nullish(),
});
export type SuggestRequest = z.input<typeof suggestRequestSchema>;

export type SuggestResponse = {
  /** Library matches; only on the first page. */
  library: LibraryMatch[];
  results: Suggestion[];
  cursor: SuggestCursor;
  hasMore: boolean;
  status: "ok" | "quota_exhausted" | "unavailable";
  /** For "unavailable": what went wrong. */
  message?: string;
  quota: { left: number | null; low: boolean };
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Case-insensitive "does this text mention the ingredient". */
const mentions = (texts: string[], ingredient: string) => {
  const needle = ingredient.toLowerCase();
  return texts.some((t) => t.toLowerCase().includes(needle));
};

/**
 * Library recipes of the right role that mention the ingredient (in the
 * title or an ingredient line) and fit the time budget. Recipes with no
 * ready time are included. Those mentioning more of the extras come first,
 * then favorites. They cost no API points.
 */
export async function libraryMatches(
  db: DbOrTx,
  input: { role: "main" | "side"; ingredient: string; extras?: string[]; maxTime: number },
  limit = 5,
): Promise<LibraryMatch[]> {
  const pattern = `%${escapeLike(input.ingredient)}%`;
  const extras = input.extras ?? [];
  const candidates = await db
    .select({
      recipeId: recipes.id,
      title: recipes.title,
      imageUrl: recipes.imageUrl,
      readyInMinutes: recipes.readyInMinutes,
      sourceUrl: recipes.sourceUrl,
      isFavorite: recipes.isFavorite,
      spoonacularId: recipes.spoonacularId,
    })
    .from(recipes)
    .where(
      and(
        eq(recipes.dishType, input.role),
        isNull(recipes.archivedAt),
        or(isNull(recipes.readyInMinutes), lte(recipes.readyInMinutes, input.maxTime)),
        or(
          ilike(recipes.title, pattern),
          exists(
            db
              .select({ one: recipeIngredients.id })
              .from(recipeIngredients)
              .where(
                and(
                  eq(recipeIngredients.recipeId, recipes.id),
                  or(ilike(recipeIngredients.rawText, pattern), ilike(recipeIngredients.name, pattern)),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(desc(recipes.isFavorite), asc(recipes.title))
    // Without extras the order above is final; with them, rank a wider pool.
    .limit(extras.length ? 50 : limit);
  if (!extras.length) return candidates.map((c) => ({ ...c, missingExtras: [] }));

  const lines = candidates.length
    ? await db
        .select({
          recipeId: recipeIngredients.recipeId,
          rawText: recipeIngredients.rawText,
          name: recipeIngredients.name,
        })
        .from(recipeIngredients)
        .where(
          inArray(
            recipeIngredients.recipeId,
            candidates.map((c) => c.recipeId),
          ),
        )
    : [];
  return candidates
    .map((c) => {
      const own = lines.filter((l) => l.recipeId === c.recipeId);
      const texts = [c.title, ...own.flatMap((l) => [l.rawText, l.name ?? ""])];
      return { ...c, missingExtras: extras.filter((e) => !mentions(texts, e)) };
    })
    // Stable sort: keeps favorites-then-title within each group.
    .sort((a, b) => a.missingExtras.length - b.missingExtras.length)
    .slice(0, limit);
}

/**
 * One row of suggestions: library matches (first page only), then up to 3
 * Spoonacular results, relaxing constraints as needed. Never throws for API
 * trouble; it reports it in `status` so library matches still show.
 */
export async function suggestDishes(
  db: Db,
  actor: SessionUser,
  request: SuggestRequest,
  opts: CallOptions = {},
): Promise<SuggestResponse> {
  // Searching spends the household's API quota, so it's adults-only too.
  assertAdult(actor);
  const parsed = suggestRequestSchema.parse(request);
  // Repeats of the main ingredient or of each other add nothing.
  const seen = new Set([parsed.ingredient.toLowerCase()]);
  const extras = parsed.extras.filter((e) => !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));
  const input = { ...parsed, extras };
  const now = opts.now ?? new Date();
  const steps = relaxationSteps(input.maxTime, extras.length > 0);
  if (input.cursor && input.cursor.offsets.length !== steps.length) {
    throw new ServiceError("The search changed. Start it again.");
  }
  const firstPage = !input.cursor;
  const library = firstPage ? await libraryMatches(db, input) : [];

  // Library recipes that came from Spoonacular shouldn't show up twice.
  const libraryIds = library.flatMap((l) => (l.spoonacularId === null ? [] : [l.spoonacularId]));
  const exclude = new Set([...(input.cursor?.shownIds ?? []), ...libraryIds]);
  const ladder = input.cursor ?? newLadderCursor(steps.length);

  const { found, cursor, error } = await collectWithRelaxation({
    steps,
    cursor: ladder,
    exclude,
    fetchPage: (step, offset) =>
      complexSearch(
        db,
        {
          type: input.role === "main" ? "main course" : "side dish",
          maxReadyTime: step.maxReadyTime,
          offset,
          number: PAGE_SIZE,
          ...(step.by === "query"
            ? { query: input.ingredient }
            : { includeIngredients: [input.ingredient, ...(step.withExtras ? extras : [])].join(",") }),
        },
        { ...opts, now },
      ),
  });

  const inLibrary = found.length
    ? await db
        .select({ id: recipes.id, spoonacularId: recipes.spoonacularId })
        .from(recipes)
        .where(
          and(
            inArray(
              recipes.spoonacularId,
              found.map((f) => f.result.id),
            ),
            isNull(recipes.archivedAt),
          ),
        )
    : [];

  const results: Suggestion[] = found.map(({ result: r, step }) => ({
    spoonacularId: r.id,
    title: r.title,
    imageUrl: r.image ?? null,
    readyInMinutes: r.readyInMinutes ?? null,
    servings: r.servings ?? null,
    sourceUrl: r.sourceUrl ?? null,
    sourceName: r.sourceName ?? null,
    ingredients: ingredientLines(r),
    overBudget: r.readyInMinutes != null && r.readyInMinutes > input.maxTime,
    similarTo: step.by === "query" ? input.ingredient : null,
    missingExtras: step.withExtras ? [] : extras.filter((e) => !mentions([r.title, ...ingredientLines(r)], e)),
    libraryRecipeId: inLibrary.find((l) => l.spoonacularId === r.id)?.id ?? null,
  }));

  const quota = await getQuota(db, now);
  const status = error instanceof QuotaExhaustedError ? "quota_exhausted" : error ? "unavailable" : "ok";
  return {
    library,
    results,
    cursor: { ...cursor, shownIds: [...exclude] },
    hasMore: status === "ok" && cursor.done.some((d) => !d),
    status,
    message: status === "unavailable" && error instanceof Error ? error.message : undefined,
    quota: { left: quota?.left ?? null, low: isQuotaLow(quota) },
  };
}

// ---------------------------------------------------------------------------
// Commit

const servings = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v)))
  .pipe(
    z
      .number({ error: "Servings must be a number" })
      .int("Servings must be a whole number")
      .min(1, "At least 1 serving")
      .max(100, "At most 100 servings")
      .nullable(),
  );

const pickSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("library"), recipeId: z.uuid(), role }),
  z.object({
    kind: z.literal("spoonacular"),
    role,
    spoonacularId: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    imageUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable(),
    // The household's own copy, as confirmed in the confirm step.
    ...recipeDetailFields,
    servings,
  }),
]);

export const picksSchema = z
  .array(pickSchema)
  .min(1, "Pick at least one dish")
  .refine((picks) => ["main", "side"].every((r) => picks.filter((p) => p.role === r).length <= 1), {
    error: "Pick at most one main and one side",
  });
export type Pick = z.input<typeof pickSchema>;

/**
 * Adds the chosen dishes to a night. Spoonacular picks are saved to the
 * library first, deduplicated by `spoonacularId`. Returns the number of
 * dishes added.
 */
export async function addSuggestedDishes(
  db: Db,
  actor: SessionUser,
  date: string,
  input: Pick[],
  now = new Date(),
): Promise<number> {
  assertAdult(actor);
  const picks = picksSchema.parse(input);
  const recipeIds: string[] = [];
  await editDinner(db, actor, date, now, async (tx, dinner) => {
    for (const pick of picks) {
      const recipeId = pick.kind === "library" ? await libraryRecipe(tx, pick.recipeId) : await saveOwnCopy(tx, pick);
      await appendDish(tx, dinner, { recipeId, role: pick.role });
      recipeIds.push(recipeId);
    }
    await markPlanned(tx, dinner);
  });
  await parsePendingIngredients(db, { recipeIds, now });
  return picks.length;
}

async function libraryRecipe(tx: Tx, recipeId: string): Promise<string> {
  const [row] = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), isNull(recipes.archivedAt)));
  if (!row) throw new ServiceError("That recipe is no longer in the library.", "not_found");
  return row.id;
}

type SpoonacularPick = Extract<z.output<typeof pickSchema>, { kind: "spoonacular" }>;

/**
 * Saves a Spoonacular pick to the library. If it's already there, the
 * existing recipe wins. If it was archived, it comes back with the newly
 * confirmed copy.
 */
async function saveOwnCopy(tx: Tx, pick: SpoonacularPick): Promise<string> {
  const details = {
    title: pick.title,
    imageUrl: pick.imageUrl,
    readyInMinutes: pick.readyInMinutes,
    servings: pick.servings,
    sourceUrl: pick.sourceUrl,
  };
  const [inserted] = await tx
    .insert(recipes)
    .values({ source: "spoonacular", spoonacularId: pick.spoonacularId, dishType: pick.role, ...details })
    .onConflictDoNothing({ target: recipes.spoonacularId })
    .returning({ id: recipes.id });
  if (inserted) {
    await insertIngredients(tx, inserted.id, pick.ingredients);
    return inserted.id;
  }

  const [existing] = await tx
    .select({ id: recipes.id, archivedAt: recipes.archivedAt })
    .from(recipes)
    .where(eq(recipes.spoonacularId, pick.spoonacularId));
  if (existing.archivedAt) {
    await tx.update(recipes).set({ ...details, archivedAt: null }).where(eq(recipes.id, existing.id));
    await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, existing.id));
    await insertIngredients(tx, existing.id, pick.ingredients);
  }
  return existing.id;
}

async function insertIngredients(tx: Tx, recipeId: string, lines: string[]) {
  // Stored raw; parsed after the commit (see ./ingredients.ts).
  if (!lines.length) return;
  await tx.insert(recipeIngredients).values(lines.map((rawText, position) => ({ recipeId, rawText, position })));
}
