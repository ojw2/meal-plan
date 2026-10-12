import type { AppEvent } from "@/lib/events";

/**
 * What a screen shows, so a client refetches only for events that touch it
 * (SPEC §5). A screen can declare several scopes; they're combined.
 */
export type LiveScope = {
  /** Week start dates whose dinners are on screen. */
  weeks?: string[];
  /** Week start dates whose grocery list is on screen. */
  grocery?: string[];
  /** Library recipes or their history ("last made") are on screen. */
  library?: boolean;
  /** Recurring rules are on screen. */
  rules?: boolean;
};

export function affects(event: AppEvent, scopes: readonly LiveScope[]): boolean {
  switch (event.type) {
    case "household.updated":
      return true;
    case "dinner.updated":
      // The grocery list and library history are derived from dinners.
      return scopes.some(
        (s) => s.weeks?.includes(event.weekStart) || s.grocery?.includes(event.weekStart) || s.library,
      );
    case "grocery.updated":
      return scopes.some((s) => s.grocery?.includes(event.weekStart));
    case "recipe.updated":
      return scopes.some((s) => s.library);
    case "rules.updated":
      return scopes.some((s) => s.rules);
  }
}

/** Retry delay after the `attempt`th consecutive failure (1 s doubling, capped at 30 s). */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}
