import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { dinners, dishes, recipeIngredients } from "@/db/schema";
import { publish } from "@/lib/events";
import { parseIngredients, QuotaExhaustedError, type CallOptions } from "@/lib/spoonacular/client";
import type { ParsedIngredient } from "@/lib/spoonacular/types";
import { addDays, weekStartOf } from "@/lib/time";
import { getHousehold, householdToday } from "./household";

// Ingredient lines are saved raw, then parsed by Spoonacular into name,
// amount, unit, aisle and ingredient id so they can merge on the grocery
// list (SPEC §4.4). Parsing never blocks saving: if the quota is used up or
// Spoonacular is down, lines stay pending and a background job retries them
// (they show unmerged under "Other" meanwhile).

/** Lines per Spoonacular call. */
export const PARSE_BATCH = 50;

export type ParseResult = {
  parsed: number;
  status: "ok" | "quota_exhausted" | "unavailable";
};

/**
 * Parses up to one batch of pending lines (optionally only for some
 * recipes). Never throws for API trouble; it reports it in `status`.
 */
export async function parsePendingIngredients(
  db: DbOrTx,
  { recipeIds, ...opts }: CallOptions & { recipeIds?: string[] } = {},
): Promise<ParseResult> {
  if (recipeIds && !recipeIds.length) return { parsed: 0, status: "ok" };
  const now = opts.now ?? new Date();
  const pending = await db
    .select({ id: recipeIngredients.id, recipeId: recipeIngredients.recipeId, rawText: recipeIngredients.rawText })
    .from(recipeIngredients)
    .where(
      and(
        isNull(recipeIngredients.parsedAt),
        recipeIds ? inArray(recipeIngredients.recipeId, recipeIds) : undefined,
      ),
    )
    .orderBy(asc(recipeIngredients.recipeId), asc(recipeIngredients.position))
    .limit(PARSE_BATCH);
  if (!pending.length) return { parsed: 0, status: "ok" };

  let results: ParsedIngredient[];
  try {
    results = await parseIngredients(
      db,
      pending.map((l) => l.rawText),
      { ...opts, now },
    );
  } catch (e) {
    const status = e instanceof QuotaExhaustedError ? "quota_exhausted" : "unavailable";
    if (status === "unavailable") console.error("Ingredient parsing failed:", e instanceof Error ? e.message : e);
    return { parsed: 0, status };
  }

  const matched = matchResults(
    pending.map((l) => l.rawText),
    results,
  );
  for (const [i, line] of pending.entries()) {
    const r = matched[i];
    await db
      .update(recipeIngredients)
      .set({
        // A line Spoonacular couldn't read keeps no name and stays raw.
        name: r?.name?.trim() || null,
        spoonacularIngredientId: r?.id ?? null,
        amount: r?.name ? (r.amount ?? null) : null,
        unit: r?.name ? (r.unitShort || r.unit || null) : null,
        aisle: r?.name ? (r.aisle ?? null) : null,
        parsedAt: now,
      })
      .where(eq(recipeIngredients.id, line.id));
  }

  await publishAffectedWeeks(db, [...new Set(pending.map((l) => l.recipeId))], now);
  return { parsed: pending.length, status: "ok" };
}

/**
 * Lines it can't parse are left out of Spoonacular's response, so results
 * are matched to lines by their `original` text, falling back to position
 * when every line came back.
 */
export function matchResults(lines: string[], results: ParsedIngredient[]): (ParsedIngredient | undefined)[] {
  const byOriginal = new Map<string, ParsedIngredient[]>();
  for (const r of results) {
    const key = (r.original ?? "").trim();
    byOriginal.set(key, [...(byOriginal.get(key) ?? []), r]);
  }
  const allBack = results.length === lines.length;
  return lines.map((line, i) => byOriginal.get(line.trim())?.shift() ?? (allBack ? results[i] : undefined));
}

/** Upcoming grocery lists that use these recipes have changed. */
async function publishAffectedWeeks(db: DbOrTx, recipeIds: string[], now: Date) {
  const h = await getHousehold(db);
  if (!h) return;
  // The current week's list includes nights already past.
  const from = addDays(await householdToday(db, now), -6);
  const rows = await db
    .selectDistinct({ date: dinners.date })
    .from(dishes)
    .innerJoin(dinners, eq(dinners.id, dishes.dinnerId))
    .where(and(inArray(dishes.recipeId, recipeIds), gte(dinners.date, from)));
  for (const weekStart of new Set(rows.map((r) => weekStartOf(r.date, h.weekStartDay)))) {
    publish({ type: "grocery.updated", weekStart });
  }
}

/**
 * Parses everything pending, a batch at a time, stopping at the first API
 * failure. The background job calls this; so can tests.
 */
export async function parseAllPending(db: DbOrTx, opts: CallOptions = {}): Promise<ParseResult> {
  let total = 0;
  for (;;) {
    const r = await parsePendingIngredients(db, opts);
    total += r.parsed;
    if (r.status !== "ok" || r.parsed < PARSE_BATCH) return { parsed: total, status: r.status };
  }
}
