import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dinners, dishes, groceryChecks, manualGroceryItems, recipeIngredients } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { subscribe, type AppEvent } from "@/lib/events";
import {
  addManualItem,
  deleteManualItem,
  getGroceryList,
  setItemChecked,
  setManualItemChecked,
} from "@/lib/services/grocery";
import { updateHouseholdSettings } from "@/lib/services/household";
import { matchResults, parseAllPending } from "@/lib/services/ingredients";
import { addManualDish, removeDish, setDinnerStatus, unlockWeek } from "@/lib/services/planner";
import type { Transport } from "@/lib/spoonacular/transport";
import { db, resetDb, seedHousehold, seedRecipe, seedUser, withSession } from "./helpers/db";

// Monday 2026-10-12, noon in New York; weeks start on Sunday, so this week
// is Oct 11–17. The household default is 4 servings.
const NOW = new Date("2026-10-12T16:00:00Z");
const WEEK = "2026-10-11";
const LAST_WEEK = "2026-10-04";

const items = (list: Awaited<ReturnType<typeof getGroceryList>>) => list.aisles.flatMap((a) => a.items);
const find = async (name: string, week = WEEK) => items(await getGroceryList(db(), week)).find((i) => i.name === name);

/** Puts a recipe on a planned night (adding to any dishes already there). */
async function plan(date: string, recipeId: string, servingsOverride: number | null = null) {
  const [dinner] = await db()
    .insert(dinners)
    .values({ date, status: "planned", servingsOverride })
    .onConflictDoUpdate({ target: dinners.date, set: { status: "planned", servingsOverride } })
    .returning();
  const [dish] = await db()
    .insert(dishes)
    .values({ dinnerId: dinner.id, recipeId, role: "main", position: Date.now() % 1_000_000 })
    .returning();
  return dish.id;
}

/** A recipe with ingredient lines, parsed by the fixture parser. */
async function recipe(title: string, lines: string[], servings: number | null = 4) {
  const r = await seedRecipe({ title, servings }, lines);
  await parseAllPending(db(), { now: NOW });
  return r;
}

const manual = (name: string, ingredients: string) => ({
  name,
  role: "main" as const,
  ingredients,
  sourceUrl: "",
  readyInMinutes: "",
  notes: "",
  saveToLibrary: true,
});

let events: AppEvent[] = [];
let unsubscribe = () => {};

beforeEach(async () => {
  await resetDb();
  await seedHousehold("America/New_York");
  events = [];
  unsubscribe = subscribe((e) => events.push(e));
});
afterEach(() => unsubscribe());

describe("ingredient parsing", () => {
  it("parses a manual dish's lines when it's saved", async () => {
    const alex = await seedUser({ username: "alex" });
    await addManualDish(db(), alex, "2026-10-13", manual("Tacos", "1 lb ground beef\n2 cloves garlic, minced\nsome love"), NOW);
    const rows = await db().select().from(recipeIngredients).orderBy(recipeIngredients.position);
    expect(rows.map((r) => [r.name, r.amount, r.unit, r.aisle, r.spoonacularIngredientId !== null])).toEqual([
      ["ground beef", 1, "lb", "Meat", true],
      ["garlic", 2, "cloves", "Produce", true],
      ["some love", 1, null, null, false],
    ]);
    expect(rows.every((r) => r.parsedAt !== null)).toBe(true);
    expect(events).toContainEqual({ type: "grocery.updated", weekStart: WEEK });
  });

  it("keeps lines raw when the quota is used up, and retries the next day", async () => {
    const alex = await seedUser({ username: "alex" });
    const exhausted: Transport = async () => ({
      status: 402,
      headers: new Headers({ "x-api-quota-left": "0" }),
      body: { status: "failure" },
    });
    await addManualDish(db(), alex, "2026-10-13", manual("Soup", "2 onions"), NOW);
    // Pretend the save-time parse hit the quota: reset the line and retry with a 402.
    await db().update(recipeIngredients).set({ parsedAt: null, name: null, amount: null, unit: null, aisle: null });
    expect(await parseAllPending(db(), { transport: exhausted, now: NOW })).toEqual({
      parsed: 0,
      status: "quota_exhausted",
    });
    // Saving still worked; the line shows as written under Other.
    expect(await find("2 onions")).toMatchObject({ aisle: "Other", text: "" });

    // Later the same UTC day, nothing is spent.
    const later = new Date("2026-10-12T20:00:00Z");
    expect(await parseAllPending(db(), { now: later })).toMatchObject({ status: "quota_exhausted" });
    // After midnight UTC the quota has reset.
    const tomorrow = new Date("2026-10-13T01:00:00Z");
    expect(await parseAllPending(db(), { now: tomorrow })).toEqual({ parsed: 1, status: "ok" });
    expect(await find("Onion")).toMatchObject({ aisle: "Produce", text: "2" });
  });

  it("never blocks saving when Spoonacular is down", async () => {
    const alex = await seedUser({ username: "alex" });
    await addManualDish(db(), alex, "2026-10-13", manual("Soup", "1 onion\nspoonacular-down"), NOW);
    const rows = await db().select().from(recipeIngredients);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.parsedAt === null)).toBe(true);
  });

  it("matches results to lines by original text, skipping lines Spoonacular left out", () => {
    const r = (original: string, name: string) => ({ original, name });
    expect(matchResults(["1 onion", "???", "2 eggs"], [r("1 onion", "onion"), r("2 eggs", "eggs")])).toEqual([
      r("1 onion", "onion"),
      undefined,
      r("2 eggs", "eggs"),
    ]);
    // Every line came back, but rewritten: fall back to position.
    expect(matchResults(["1  onion"], [r("1 onion", "onion")])).toEqual([r("1 onion", "onion")]);
  });
});

describe("the derived list", () => {
  it("scales, sums and groups the week's planned dishes", async () => {
    const tacos = await recipe("Tacos", ["1 lb ground beef", "1 onion, diced", "1 tsp salt"], 4);
    const chili = await recipe("Chili", ["1 lb ground beef", "1 cup chopped onion"], 2);
    await plan("2026-10-11", tacos.id); // Sunday, already past: still counts.
    await plan("2026-10-14", tacos.id, 8); // Doubled.
    await plan("2026-10-16", chili.id); // 4 / 2 servings: doubled.

    const list = await getGroceryList(db(), WEEK);
    expect(list.aisles.map((a) => a.aisle)).toEqual(["Meat", "Produce", "Spices and Seasonings"]);
    expect(await find("Ground beef")).toMatchObject({ text: "5 lb" });
    expect(await find("Onion")).toMatchObject({ text: "3 whole + 2 cups" });
    expect((await find("Onion"))!.sources.map((s) => `${s.dishName} ${s.date}: ${s.text}`)).toEqual([
      "Tacos 2026-10-11: 1",
      "Tacos 2026-10-14: 2",
      "Chili 2026-10-16: 2 cup",
    ]);
    // 3 tsp reads better as a tablespoon.
    expect(await find("Salt")).toMatchObject({ text: "1 tbsp" });
  });

  it("doesn't scale a recipe with no servings", async () => {
    const r = await recipe("Pasta", ["1 lb linguine"], null);
    await plan("2026-10-14", r.id, 8);
    expect(await find("Linguine")).toMatchObject({ text: "1 lb" });
  });

  it("leaves out other weeks, eat-out nights, free-text dishes and dishes without ingredients", async () => {
    const alex = await seedUser({ username: "alex" });
    const tacos = await recipe("Tacos", ["1 lb ground beef"]);
    await plan("2026-10-10", tacos.id); // Previous week.
    await plan("2026-10-18", tacos.id); // Next week.
    await addManualDish(db(), alex, "2026-10-13", { ...manual("Pizza", ""), saveToLibrary: false }, NOW);
    await addManualDish(db(), alex, "2026-10-14", manual("Salad", ""), NOW);
    await plan("2026-10-15", tacos.id);
    await setDinnerStatus(db(), alex, "2026-10-15", "eat_out", NOW);
    expect(await getGroceryList(db(), WEEK)).toEqual({ aisles: [], noLongerNeeded: [], manual: [] });
  });
});

describe("check-offs", () => {
  it("kids can't check items", async () => {
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(setItemChecked(db(), kid, WEEK, "id:1", true, NOW)).rejects.toThrow(ForbiddenError);
  });

  it("resurfaces an item when more is needed, and moves bought items that left the plan", async () => {
    const alex = await seedUser({ username: "alex" });
    const tacos = await recipe("Tacos", ["1 lb ground beef", "1 onion"]);
    const soup = await recipe("Soup", ["2 onions", "1 lemon"]);
    const tuesday = await plan("2026-10-13", tacos.id);

    const onion = (await find("Onion"))!;
    await setItemChecked(db(), alex, WEEK, onion.key, true, NOW);
    await setItemChecked(db(), alex, WEEK, (await find("Ground beef"))!.key, true, NOW);
    expect(await find("Onion")).toMatchObject({ checked: true, increase: null });
    expect(events).toContainEqual({ type: "grocery.updated", weekStart: WEEK });
    // Checking again is harmless.
    await setItemChecked(db(), alex, WEEK, onion.key, true, NOW);

    // Swap in soup: more onions needed, and the beef is no longer needed.
    await plan("2026-10-15", soup.id);
    await removeDish(db(), alex, tuesday, NOW);
    expect(await find("Onion")).toMatchObject({ checked: false, increase: "+1 onion", text: "2" });
    // Unchecked items that leave the plan just vanish; checked ones are listed.
    const list = await getGroceryList(db(), WEEK);
    expect(list.noLongerNeeded).toEqual([{ key: expect.stringMatching(/^id:\d+$/), label: "Ground beef: 1 lb" }]);

    // Checking it again records the new amount.
    await setItemChecked(db(), alex, WEEK, onion.key, true, NOW);
    expect(await find("Onion")).toMatchObject({ checked: true, increase: null });

    // Unchecking a "no longer needed" item forgets it.
    await setItemChecked(db(), alex, WEEK, list.noLongerNeeded[0].key, false, NOW);
    expect((await getGroceryList(db(), WEEK)).noLongerNeeded).toEqual([]);
  });

  it("can't check an item that isn't on the list", async () => {
    const alex = await seedUser({ username: "alex" });
    await expect(setItemChecked(db(), alex, WEEK, "id:999", true, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(setItemChecked(db(), alex, "2026-10-12", "id:999", true, NOW)).rejects.toThrow("Invalid week");
  });

  it("past weeks are read-only until unlocked", async () => {
    const alex = await withSession(await seedUser({ username: "alex" }));
    const tacos = await recipe("Tacos", ["1 onion"]);
    await plan("2026-10-06", tacos.id);
    const key = (await find("Onion", LAST_WEEK))!.key;
    await expect(setItemChecked(db(), alex, LAST_WEEK, key, true, NOW)).rejects.toMatchObject({ code: "locked" });
    await expect(addManualItem(db(), alex, LAST_WEEK, "Milk", NOW)).rejects.toMatchObject({ code: "locked" });
    await unlockWeek(db(), alex, LAST_WEEK, NOW);
    await setItemChecked(db(), alex, LAST_WEEK, key, true, NOW);
    expect(await find("Onion", LAST_WEEK)).toMatchObject({ checked: true });
  });
});

describe("manual items", () => {
  it("adults add, check and delete them; kids can't", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(addManualItem(db(), kid, WEEK, "Milk", NOW)).rejects.toThrow(ForbiddenError);
    await expect(addManualItem(db(), alex, WEEK, "   ", NOW)).rejects.toThrow("Enter an item");

    const milk = await addManualItem(db(), alex, WEEK, " Milk ", NOW);
    await addManualItem(db(), alex, WEEK, "Paper towels", NOW);
    await setManualItemChecked(db(), alex, milk, true, NOW);
    expect((await getGroceryList(db(), WEEK)).manual).toMatchObject([
      { text: "Milk", checked: true },
      { text: "Paper towels", checked: false },
    ]);
    expect((await getGroceryList(db(), "2026-10-18")).manual).toEqual([]);

    await expect(setManualItemChecked(db(), kid, milk, false, NOW)).rejects.toThrow(ForbiddenError);
    await expect(deleteManualItem(db(), kid, milk, NOW)).rejects.toThrow(ForbiddenError);
    await deleteManualItem(db(), alex, milk, NOW);
    expect((await getGroceryList(db(), WEEK)).manual.map((m) => m.text)).toEqual(["Paper towels"]);
    await expect(deleteManualItem(db(), alex, milk, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteManualItem(db(), alex, "not-a-uuid", NOW)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("changing the week start day", () => {
  it("moves this and future weeks' grocery state to the new boundaries", async () => {
    const alex = await seedUser({ username: "alex" });
    const tacos = await recipe("Tacos", ["1 onion"]);
    await plan("2026-10-13", tacos.id);
    await setItemChecked(db(), alex, WEEK, (await find("Onion"))!.key, true, NOW);
    await addManualItem(db(), alex, WEEK, "Milk", NOW);
    await addManualItem(db(), alex, "2026-10-18", "Coffee", NOW);
    await db().insert(manualGroceryItems).values({ weekStartDate: LAST_WEEK, text: "Old" });

    // Weeks now start Monday: this week is Oct 12–18, next is Oct 19–25.
    await updateHouseholdSettings(
      db(),
      alex,
      { name: "Test House", timezone: "America/New_York", weekStartDay: 1, defaultServings: 4 },
      NOW,
    );
    const weeks = await db()
      .select({ week: manualGroceryItems.weekStartDate, text: manualGroceryItems.text })
      .from(manualGroceryItems)
      .orderBy(manualGroceryItems.text);
    expect(weeks).toEqual([
      { week: "2026-10-19", text: "Coffee" },
      { week: "2026-10-12", text: "Milk" },
      // Past weeks are left alone.
      { week: LAST_WEEK, text: "Old" },
    ]);
    expect(await db().select({ week: groceryChecks.weekStartDate }).from(groceryChecks)).toEqual([{ week: "2026-10-12" }]);
    expect(await find("Onion", "2026-10-12")).toMatchObject({ checked: true });
    expect(events).toContainEqual({ type: "grocery.updated", weekStart: "2026-10-12" });

    // Saving without changing the day touches nothing.
    events = [];
    await updateHouseholdSettings(
      db(),
      alex,
      { name: "Renamed", timezone: "America/New_York", weekStartDay: 1, defaultServings: 4 },
      NOW,
    );
    expect(events).toEqual([]);
  });
});

it("check rows only exist for checked items", async () => {
  const alex = await seedUser({ username: "alex" });
  const tacos = await recipe("Tacos", ["1 onion"]);
  await plan("2026-10-13", tacos.id);
  const key = (await find("Onion"))!.key;
  await setItemChecked(db(), alex, WEEK, key, true, NOW);
  await setItemChecked(db(), alex, WEEK, key, false, NOW);
  expect(await db().select().from(groceryChecks).where(eq(groceryChecks.weekStartDate, WEEK))).toEqual([]);
  expect(await find("Onion")).toMatchObject({ checked: false });
});
