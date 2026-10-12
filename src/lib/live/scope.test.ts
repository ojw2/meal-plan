import { describe, expect, it } from "vitest";
import type { AppEvent } from "@/lib/events";
import { affects, backoffMs, type LiveScope } from "./scope";

const W1 = "2026-10-12";
const W2 = "2026-10-19";

const dinner: AppEvent = { type: "dinner.updated", date: "2026-10-14", weekStart: W1 };
const grocery: AppEvent = { type: "grocery.updated", weekStart: W1 };
const recipe: AppEvent = { type: "recipe.updated", recipeId: "r1" };
const rules: AppEvent = { type: "rules.updated" };
const household: AppEvent = { type: "household.updated" };

describe("affects", () => {
  it("refetches every screen on household-wide changes, even ones without a scope", () => {
    expect(affects(household, [])).toBe(true);
    expect(affects(household, [{ library: true }])).toBe(true);
  });

  it("ignores everything else on a screen without a scope", () => {
    for (const e of [dinner, grocery, recipe, rules]) expect(affects(e, [])).toBe(false);
  });

  it("matches dinner changes to the weeks on screen", () => {
    expect(affects(dinner, [{ weeks: [W1] }])).toBe(true);
    expect(affects(dinner, [{ weeks: [W2] }])).toBe(false);
    // Home shows this week and next.
    expect(affects(dinner, [{ weeks: [W2, W1] }])).toBe(true);
  });

  it("refetches a week's grocery list when its dinners change, since the list is derived from them", () => {
    expect(affects(dinner, [{ grocery: [W1] }])).toBe(true);
    expect(affects(dinner, [{ grocery: [W2] }])).toBe(false);
  });

  it("matches grocery changes only to that week's list", () => {
    expect(affects(grocery, [{ grocery: [W1] }])).toBe(true);
    expect(affects(grocery, [{ grocery: [W2] }])).toBe(false);
    // The week view doesn't show check-offs.
    expect(affects(grocery, [{ weeks: [W1] }])).toBe(false);
  });

  it("refetches library screens on recipe and dinner changes (history)", () => {
    const library: LiveScope = { library: true };
    expect(affects(recipe, [library])).toBe(true);
    expect(affects(dinner, [library])).toBe(true);
    expect(affects(recipe, [{ weeks: [W1] }])).toBe(false);
  });

  it("matches rule changes to screens listing rules", () => {
    expect(affects(rules, [{ rules: true }])).toBe(true);
    expect(affects(rules, [{ weeks: [W1], library: true }])).toBe(false);
  });

  it("combines several scopes", () => {
    expect(affects(grocery, [{ weeks: [W1] }, { grocery: [W1] }])).toBe(true);
  });
});

describe("backoffMs", () => {
  it("doubles from 1 s and caps at 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});
