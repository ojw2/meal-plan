import { describe, expect, it } from "vitest";
import {
  collectWithRelaxation,
  newLadderCursor,
  relaxationSteps,
  type FetchPage,
  type RelaxStep,
} from "./relax";
import type { SearchResult } from "./types";

const r = (id: number, readyInMinutes = 20): SearchResult => ({ id, title: `Recipe ${id}`, readyInMinutes });

/** A fake API: each step's full, popularity-ordered result list, paged like complexSearch. */
function fakeApi(byStep: (step: RelaxStep) => SearchResult[]) {
  const calls: { step: RelaxStep; offset: number }[] = [];
  const fetchPage: FetchPage = async (step, offset) => {
    calls.push({ step, offset });
    const all = byStep(step);
    return { results: all.slice(offset, offset + 3), totalResults: all.length };
  };
  return { fetchPage, calls };
}

const steps = relaxationSteps(20);
const run = (fetchPage: FetchPage, cursor = newLadderCursor(4), exclude = new Set<number>()) =>
  collectWithRelaxation({ steps, cursor, exclude, fetchPage });

describe("relaxationSteps", () => {
  it("loosens time ×1.5 then ×2, then switches to a text match", () => {
    expect(relaxationSteps(20)).toEqual([
      { by: "include", maxReadyTime: 20 },
      { by: "include", maxReadyTime: 30 },
      { by: "include", maxReadyTime: 40 },
      { by: "query", maxReadyTime: 40 },
    ]);
    expect(relaxationSteps(45)[1].maxReadyTime).toBe(68); // rounded
  });
});

describe("collectWithRelaxation", () => {
  it("stops after the strict step when it finds 3", async () => {
    const api = fakeApi(() => [r(1), r(2), r(3), r(4)]);
    const { found, cursor } = await run(api.fetchPage);
    expect(found.map((f) => f.result.id)).toEqual([1, 2, 3]);
    expect(found.every((f) => f.step === steps[0])).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(cursor).toEqual({ offsets: [3, 0, 0, 0], done: [false, false, false, false] });
  });

  it("relaxes the time budget, skipping results the strict step already found", async () => {
    // Looser time budgets return supersets of the stricter ones.
    const api = fakeApi((s) => (s.maxReadyTime === 20 ? [r(1)] : s.maxReadyTime === 30 ? [r(1), r(2, 25)] : [r(1), r(2, 25), r(3, 35)]));
    const { found } = await run(api.fetchPage);
    expect(found.map((f) => [f.result.id, f.step.maxReadyTime])).toEqual([
      [1, 20],
      [2, 30],
      [3, 40],
    ]);
  });

  it("falls back to a text match last, and labels which step found each result", async () => {
    const api = fakeApi((s) => (s.by === "query" ? [r(9), r(10)] : s.maxReadyTime === 20 ? [r(1)] : [r(1)]));
    const { found, cursor } = await run(api.fetchPage);
    expect(found.map((f) => [f.result.id, f.step.by])).toEqual([
      [1, "include"],
      [9, "query"],
      [10, "query"],
    ]);
    expect(cursor.done).toEqual([true, true, true, true]);
  });

  it("returns nothing when every step is empty", async () => {
    const api = fakeApi(() => []);
    const { found, cursor } = await run(api.fetchPage);
    expect(found).toEqual([]);
    expect(cursor.done).toEqual([true, true, true, true]);
    expect(api.calls).toHaveLength(4);
  });

  it("'show more' continues where the last page stopped and skips shown ids", async () => {
    const api = fakeApi((s) => (s.maxReadyTime === 20 ? [r(1), r(2), r(3), r(4), r(5)] : [r(1), r(2), r(3), r(4), r(5), r(6)]));
    const exclude = new Set<number>();
    const first = await run(api.fetchPage, undefined, exclude);
    expect(first.found.map((f) => f.result.id)).toEqual([1, 2, 3]);

    const second = await run(api.fetchPage, first.cursor, exclude);
    expect(second.found.map((f) => f.result.id)).toEqual([4, 5, 6]);
    expect(api.calls.slice(1).map((c) => [c.step.maxReadyTime, c.offset])).toEqual([
      [20, 3], // the rest of the strict results
      [30, 0], // page of dupes (1–3) …
      [30, 3], // … so a second page of the same step
    ]);
    expect(exclude).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it("doesn't skip results when it stops partway through a page", async () => {
    const api = fakeApi((s) => (s.maxReadyTime === 20 ? [r(1), r(2)] : [r(1), r(7), r(8), r(9)]));
    const first = await run(api.fetchPage);
    expect(first.found.map((f) => f.result.id)).toEqual([1, 2, 7]);
    // Only ids 1 and 7 of the ×1.5 page were looked at.
    expect(first.cursor.offsets[1]).toBe(2);
    const exclude = new Set([1, 2, 7]);
    const second = await run(api.fetchPage, first.cursor, exclude);
    expect(second.found.map((f) => f.result.id)).toEqual([8, 9]);
  });

  it("returns partial results and the error when a fetch fails, so a retry resumes", async () => {
    const boom = new Error("timeout");
    let fail = true;
    const fetchPage: FetchPage = async (step, offset) => {
      if (step.maxReadyTime === 30 && fail) throw boom;
      const all = step.maxReadyTime === 20 ? [r(1)] : [r(1), r(2), r(3)];
      return { results: all.slice(offset, offset + 3), totalResults: all.length };
    };
    const exclude = new Set<number>();
    const first = await run(fetchPage, undefined, exclude);
    expect(first.error).toBe(boom);
    expect(first.found.map((f) => f.result.id)).toEqual([1]);
    expect(first.cursor).toEqual({ offsets: [1, 0, 0, 0], done: [true, false, false, false] });

    fail = false;
    const retry = await run(fetchPage, first.cursor, exclude);
    expect(retry.error).toBeUndefined();
    expect(retry.found.map((f) => f.result.id)).toEqual([2, 3]);
  });
});
