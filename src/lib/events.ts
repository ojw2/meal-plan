import { EventEmitter } from "node:events";
import { weekStartOf } from "@/lib/time";

/**
 * In-process event bus (SPEC §5). Every mutation publishes the week it
 * touched; the SSE route (`/api/events`) relays these to connected clients.
 */
export type AppEvent =
  | { type: "dinner.updated"; date: string; weekStart: string }
  /** A library recipe changed (favorite, archive). No week is affected. */
  | { type: "recipe.updated"; recipeId: string }
  /** A recurring rule changed. Affected dinners publish their own events. */
  | { type: "rules.updated" }
  /** A week's grocery list changed: a check-off, a manual item, or newly parsed ingredients. */
  | { type: "grocery.updated"; weekStart: string }
  /**
   * Household-wide data changed (settings, cook schedule, members). Any
   * screen may show it, e.g. a renamed cook, so every client refetches.
   */
  | { type: "household.updated" };

// One emitter across dev hot reloads.
const globalForEvents = globalThis as unknown as { __events?: EventEmitter };
const emitter = (globalForEvents.__events ??= new EventEmitter().setMaxListeners(0));

export function publish(event: AppEvent): void {
  emitter.emit("event", event);
}

/** Returns an unsubscribe function. */
export function subscribe(listener: (event: AppEvent) => void): () => void {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}

/** Publishes one `dinner.updated` per changed date. */
export function publishDinnerDates(dates: Iterable<string>, weekStartDay: number): void {
  for (const date of new Set(dates)) {
    publish({ type: "dinner.updated", date, weekStart: weekStartOf(date, weekStartDay) });
  }
}
