import { getDb } from "@/db";
import { parseAllPending } from "@/lib/services/ingredients";

/** How often to retry ingredient lines that couldn't be parsed yet. */
const PARSE_RETRY_MS = 60 * 60 * 1000;

// One timer across dev hot reloads.
const globalForJobs = globalThis as unknown as { __jobs?: NodeJS.Timeout };

/**
 * In-process background work (single instance, SPEC §5). Ingredient lines
 * saved while the quota was used up are parsed once it resets (midnight
 * UTC), so hourly retries are enough.
 */
export function startBackgroundJobs() {
  if (globalForJobs.__jobs) return;
  const run = () =>
    parseAllPending(getDb()).catch((e) => console.error("Background ingredient parsing failed:", e));
  globalForJobs.__jobs = setInterval(run, PARSE_RETRY_MS);
  globalForJobs.__jobs.unref();
  // Also once shortly after start, e.g. for lines saved before this version.
  setTimeout(run, 10_000).unref();
}
