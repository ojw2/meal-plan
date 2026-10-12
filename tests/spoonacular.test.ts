import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiUsage, searchCache } from "@/db/schema";
import {
  CACHE_TTL_MS,
  complexSearch,
  getQuota,
  isQuotaLow,
  QuotaExhaustedError,
  SpoonacularUnavailableError,
  type ComplexSearchParams,
} from "@/lib/spoonacular/client";
import type { SpoonacularResponse, Transport } from "@/lib/spoonacular/transport";
import { db, resetDb } from "./helpers/db";

const NOW = new Date("2026-10-12T16:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

const PARAMS: ComplexSearchParams = {
  type: "main course",
  includeIngredients: "chicken",
  maxReadyTime: 30,
  offset: 0,
  number: 3,
};

const page = { offset: 0, number: 3, totalResults: 1, results: [{ id: 1, title: "Chicken" }] };

function ok(body: unknown = page, quota = { used: "12.5", left: "137.5" }): SpoonacularResponse {
  return {
    status: 200,
    headers: new Headers({ "x-api-quota-used": quota.used, "x-api-quota-left": quota.left }),
    body,
  };
}

function fakeTransport(...responses: (SpoonacularResponse | Error)[]) {
  const calls: URLSearchParams[] = [];
  const transport: Transport = vi.fn(async (_path, params) => {
    calls.push(params);
    const next = responses.shift() ?? ok();
    if (next instanceof Error) throw next;
    return next;
  });
  return { transport, calls };
}

beforeEach(resetDb);

describe("complexSearch", () => {
  it("sends the spec's search parameters", async () => {
    const { transport, calls } = fakeTransport(ok());
    await complexSearch(db(), PARAMS, { transport, now: NOW });
    expect(Object.fromEntries(calls[0])).toEqual({
      type: "main course",
      includeIngredients: "chicken",
      maxReadyTime: "30",
      addRecipeInformation: "true",
      fillIngredients: "true",
      sort: "popularity",
      offset: "0",
      number: "3",
    });
  });

  it("serves repeats from the cache for an hour, then refetches and purges", async () => {
    const { transport } = fakeTransport(ok(), ok());
    await complexSearch(db(), PARAMS, { transport, now: NOW });
    const again = await complexSearch(db(), PARAMS, { transport, now: later(CACHE_TTL_MS - 1000) });
    expect(again.results[0].title).toBe("Chicken");
    expect(transport).toHaveBeenCalledTimes(1);

    // A different page is a different cache entry.
    await complexSearch(db(), { ...PARAMS, offset: 3 }, { transport, now: NOW });
    expect(transport).toHaveBeenCalledTimes(2);

    await complexSearch(db(), PARAMS, { transport, now: later(CACHE_TTL_MS + 1000) });
    expect(transport).toHaveBeenCalledTimes(3);
    // The stale offset-3 page is deleted, not just ignored (Spoonacular ToS).
    expect(await db().select().from(searchCache)).toHaveLength(1);
  });

  it("records the quota headers under the UTC date", async () => {
    // 22:00 in New York on Oct 12 is already Oct 13 in UTC.
    const lateEvening = new Date("2026-10-13T02:00:00Z");
    const { transport } = fakeTransport(ok(page, { used: "140", left: "10" }));
    await complexSearch(db(), PARAMS, { transport, now: lateEvening });
    const quota = await getQuota(db(), lateEvening);
    expect(quota).toEqual({ date: "2026-10-13", used: 140, left: 10 });
    expect(isQuotaLow(quota)).toBe(true);
    expect(await getQuota(db(), NOW)).toBeNull();
  });

  it("treats HTTP 402 as an exhausted quota and stops calling until tomorrow (UTC)", async () => {
    const { transport } = fakeTransport({ status: 402, headers: new Headers(), body: { code: 402 } });
    await expect(complexSearch(db(), PARAMS, { transport, now: NOW })).rejects.toThrow(QuotaExhaustedError);
    expect((await getQuota(db(), NOW))?.left).toBe(0);

    await expect(complexSearch(db(), { ...PARAMS, offset: 3 }, { transport, now: NOW })).rejects.toThrow(
      QuotaExhaustedError,
    );
    expect(transport).toHaveBeenCalledTimes(1);

    // A new UTC day starts fresh.
    await complexSearch(db(), PARAMS, { transport, now: new Date("2026-10-13T00:30:00Z") });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("still serves cached pages when the quota is exhausted", async () => {
    const { transport } = fakeTransport(ok());
    await complexSearch(db(), PARAMS, { transport, now: NOW });
    await db().update(apiUsage).set({ pointsLeft: 0 }).where(eq(apiUsage.date, "2026-10-12"));
    await expect(complexSearch(db(), PARAMS, { transport, now: NOW })).resolves.toMatchObject({ totalResults: 1 });
  });

  it("turns timeouts, HTTP errors and malformed bodies into a retryable error", async () => {
    const { transport } = fakeTransport(
      new DOMException("timed out", "TimeoutError"),
      { status: 500, headers: new Headers(), body: "oops" },
      ok({ unexpected: true }),
    );
    for (let offset = 0; offset < 3; offset++) {
      await expect(complexSearch(db(), { ...PARAMS, offset }, { transport, now: NOW })).rejects.toThrow(
        SpoonacularUnavailableError,
      );
    }
    // Failures aren't cached.
    expect(await db().select().from(searchCache)).toHaveLength(0);
  });
});
