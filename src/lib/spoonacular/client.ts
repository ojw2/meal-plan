import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import type { z } from "zod";
import type { DbOrTx } from "@/db";
import { apiUsage, searchCache } from "@/db/schema";
import { defaultTransport, type Transport } from "./transport";
import { complexSearchSchema, type ComplexSearchResponse } from "./types";

// Every Spoonacular call goes through here (SPEC §6): responses are cached
// for an hour, quota headers are recorded, and failures become one of two
// errors the suggest flow knows how to show.

/** The daily quota is used up (HTTP 402). Resets at midnight UTC. */
export class QuotaExhaustedError extends Error {
  constructor() {
    super("Spoonacular's daily quota is used up.");
    this.name = "QuotaExhaustedError";
  }
}

/** Timeout, network failure or an unexpected response. Worth a retry. */
export class SpoonacularUnavailableError extends Error {
  constructor(message = "Spoonacular isn't responding.") {
    super(message);
    this.name = "SpoonacularUnavailableError";
  }
}

/** The free tier's ToS allows caching for at most an hour. */
export const CACHE_TTL_MS = 60 * 60 * 1000;
/** Below this many points left, the suggest flow warns. */
export const LOW_QUOTA_POINTS = 20;

export type CallOptions = { transport?: Transport; now?: Date };

/** Spoonacular's quota day is the UTC date. */
const quotaDate = (now: Date) => now.toISOString().slice(0, 10);

export type Quota = { date: string; used: number; left: number | null };

/** Today's usage as last reported by Spoonacular, or null before the first call. */
export async function getQuota(db: DbOrTx, now = new Date()): Promise<Quota | null> {
  const [row] = await db.select().from(apiUsage).where(eq(apiUsage.date, quotaDate(now)));
  return row ? { date: row.date, used: row.pointsUsed, left: row.pointsLeft } : null;
}

export const isQuotaExhausted = (q: Quota | null) => q?.left != null && q.left <= 0;
export const isQuotaLow = (q: Quota | null) => q?.left != null && q.left < LOW_QUOTA_POINTS;

async function recordQuota(db: DbOrTx, now: Date, headers: Headers, exhausted: boolean) {
  const used = Number(headers.get("x-api-quota-used"));
  const left = Number(headers.get("x-api-quota-left"));
  const hasUsed = headers.has("x-api-quota-used") && Number.isFinite(used);
  const hasLeft = headers.has("x-api-quota-left") && Number.isFinite(left);
  if (!hasUsed && !hasLeft && !exhausted) return;
  const pointsLeft = exhausted ? 0 : hasLeft ? left : null;
  const date = quotaDate(now);
  await db
    .insert(apiUsage)
    .values({ date, pointsUsed: hasUsed ? used : 0, pointsLeft })
    .onConflictDoUpdate({
      target: apiUsage.date,
      set: { ...(hasUsed && { pointsUsed: used }), ...((hasLeft || exhausted) && { pointsLeft }) },
    });
}

/** Stable cache key: path plus params in sorted order. */
export function cacheKey(path: string, params: URLSearchParams): string {
  const sorted = new URLSearchParams([...params].sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(`${path}?${sorted}`).digest("hex");
}

/**
 * A cached-or-fresh GET, validated against `schema` (invalid responses are
 * never cached). Throws QuotaExhaustedError or SpoonacularUnavailableError.
 */
export async function spoonacularGet<T>(
  db: DbOrTx,
  path: string,
  params: URLSearchParams,
  schema: z.ZodType<T>,
  { transport = defaultTransport(), now = new Date() }: CallOptions = {},
): Promise<T> {
  const key = cacheKey(path, params);
  const freshAfter = new Date(now.getTime() - CACHE_TTL_MS);
  // Expired entries must be deleted, not just ignored (Spoonacular ToS).
  await db.delete(searchCache).where(lt(searchCache.fetchedAt, freshAfter));
  const [cached] = await db
    .select({ response: searchCache.response })
    .from(searchCache)
    .where(and(eq(searchCache.queryHash, key), gte(searchCache.fetchedAt, freshAfter)));
  if (cached) {
    const hit = schema.safeParse(cached.response);
    if (hit.success) return hit.data;
  }

  // Don't spend a request we know will be refused.
  if (isQuotaExhausted(await getQuota(db, now))) throw new QuotaExhaustedError();

  let res;
  try {
    res = await transport(path, params);
  } catch (e) {
    console.error(`Spoonacular ${path} failed:`, e instanceof Error ? e.message : e);
    throw new SpoonacularUnavailableError();
  }
  await recordQuota(db, now, res.headers, res.status === 402);
  if (res.status === 402) throw new QuotaExhaustedError();
  if (res.status !== 200) {
    console.error(`Spoonacular ${path} returned HTTP ${res.status}`);
    throw new SpoonacularUnavailableError(
      res.status === 429 ? "Spoonacular is busy. Try again in a minute." : undefined,
    );
  }

  const parsed = schema.safeParse(res.body);
  if (!parsed.success) {
    console.error(`Unexpected Spoonacular ${path} response:`, parsed.error.issues[0]);
    throw new SpoonacularUnavailableError("Spoonacular sent an unexpected response.");
  }

  await db
    .insert(searchCache)
    .values({ queryHash: key, response: res.body, fetchedAt: now })
    .onConflictDoUpdate({ target: searchCache.queryHash, set: { response: res.body, fetchedAt: now } });
  return parsed.data;
}

export type ComplexSearchParams = {
  type: "main course" | "side dish";
  maxReadyTime: number;
  offset: number;
  number: number;
} & ({ includeIngredients: string; query?: never } | { query: string; includeIngredients?: never });

/** `GET /recipes/complexSearch` with recipe information and ingredients (SPEC §4.3). */
export async function complexSearch(
  db: DbOrTx,
  p: ComplexSearchParams,
  opts?: CallOptions,
): Promise<ComplexSearchResponse> {
  const params = new URLSearchParams({
    type: p.type,
    maxReadyTime: String(p.maxReadyTime),
    addRecipeInformation: "true",
    fillIngredients: "true",
    sort: "popularity",
    offset: String(p.offset),
    number: String(p.number),
  });
  if (p.includeIngredients !== undefined) params.set("includeIngredients", p.includeIngredients);
  if (p.query !== undefined) params.set("query", p.query);
  return spoonacularGet(db, "/recipes/complexSearch", params, complexSearchSchema, opts);
}
