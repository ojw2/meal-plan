import type { SearchResult } from "./types";

/**
 * The constraint-relaxation ladder (SPEC §4.3): the main ingredient plus any
 * extras, then the main ingredient alone, then a looser time budget (×1.5,
 * ×2), then the ingredient as a text match instead of a required ingredient.
 */
export type RelaxStep = { by: "include" | "query"; maxReadyTime: number; withExtras: boolean };

export function relaxationSteps(maxTime: number, hasExtras = false): RelaxStep[] {
  return [
    ...(hasExtras ? [{ by: "include" as const, maxReadyTime: maxTime, withExtras: true }] : []),
    { by: "include", maxReadyTime: maxTime, withExtras: false },
    { by: "include", maxReadyTime: Math.round(maxTime * 1.5), withExtras: false },
    { by: "include", maxReadyTime: maxTime * 2, withExtras: false },
    { by: "query", maxReadyTime: maxTime * 2, withExtras: false },
  ];
}

/** Where each step left off, so "Show 3 more" continues instead of restarting. */
export type LadderCursor = { offsets: number[]; done: boolean[] };

export const newLadderCursor = (steps: number): LadderCursor => ({
  offsets: Array(steps).fill(0),
  done: Array(steps).fill(false),
});

export type FetchPage = (
  step: RelaxStep,
  offset: number,
) => Promise<{ results: SearchResult[]; totalResults: number }>;

export type Found = { result: SearchResult; step: RelaxStep };

export const PAGE_SIZE = 3;

/** Extra ingredients per dish (SPEC §4.3). Pure module, so the suggest form can import it too. */
export const MAX_EXTRAS = 3;
/**
 * Pages fetched per step in one request. A looser step re-finds the stricter
 * step's results first, so one page can come back all duplicates.
 */
const MAX_PAGES_PER_STEP = 2;

/**
 * Walks the ladder until `want` new results are collected. Results whose id
 * is in `exclude` (already shown) are skipped, and `exclude` is updated with
 * whatever is returned. If a fetch fails, returns what was found so far with
 * the error. The cursor is left at the failed step, so a retry resumes there.
 */
export async function collectWithRelaxation(opts: {
  steps: RelaxStep[];
  cursor: LadderCursor;
  exclude: Set<number>;
  fetchPage: FetchPage;
  want?: number;
}): Promise<{ found: Found[]; cursor: LadderCursor; error?: unknown }> {
  const { steps, exclude, fetchPage, want = PAGE_SIZE } = opts;
  const cursor: LadderCursor = { offsets: [...opts.cursor.offsets], done: [...opts.cursor.done] };
  const found: Found[] = [];

  for (const [i, step] of steps.entries()) {
    for (let pages = 0; pages < MAX_PAGES_PER_STEP && found.length < want && !cursor.done[i]; pages++) {
      let page;
      try {
        page = await fetchPage(step, cursor.offsets[i]);
      } catch (error) {
        return { found, cursor, error };
      }
      // Advance only past the results actually looked at, so the next
      // request picks up right after the last one taken.
      let consumed = 0;
      for (const result of page.results) {
        if (found.length >= want) break;
        consumed++;
        if (exclude.has(result.id)) continue;
        exclude.add(result.id);
        found.push({ result, step });
      }
      cursor.offsets[i] += consumed;
      if (page.results.length === 0 || cursor.offsets[i] >= page.totalResults) cursor.done[i] = true;
    }
    if (found.length >= want) break;
  }
  return { found, cursor };
}
