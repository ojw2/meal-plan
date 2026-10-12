import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { apiUsage, recipeIngredients, recipes } from "@/db/schema";
import { ForbiddenError, ServiceError } from "@/lib/errors";
import { subscribe, type AppEvent } from "@/lib/events";
import { setCookSchedule } from "@/lib/services/household";
import { getDinner } from "@/lib/services/planner";
import { addSuggestedDishes, suggestDishes, type Pick } from "@/lib/services/suggest";
import { db, resetDb, seedHousehold, seedRecipe, seedUser } from "./helpers/db";

// These run against the fixture corpus (SPOONACULAR_LIVE is unset in tests).
// Monday 2026-10-12, noon in New York; weeks start on Sunday.
const NOW = new Date("2026-10-12T16:00:00Z");
const TUESDAY = "2026-10-13";
const WEDNESDAY = "2026-10-14";
const LAST_WEEK = "2026-10-08";

const search = (actor: Awaited<ReturnType<typeof seedUser>>, ingredient: string, extra: object = {}) =>
  suggestDishes(db(), actor, { role: "main", ingredient, maxTime: 30, ...extra }, { now: NOW });

const fajitas = (overrides: Partial<Extract<Pick, { kind: "spoonacular" }>> = {}): Pick => ({
  kind: "spoonacular",
  role: "main",
  spoonacularId: 900002,
  title: "Chicken Fajitas",
  imageUrl: "https://img.spoonacular.com/recipes/900002-312x231.jpg",
  ingredients: "1.5 lb chicken breast\n8 flour tortillas",
  servings: "4",
  readyInMinutes: "25",
  sourceUrl: "https://example.com/recipes/chicken-fajitas",
  ...overrides,
});

beforeEach(async () => {
  await resetDb();
  await seedHousehold("America/New_York");
});

describe("permissions", () => {
  it("kids can't search (it spends quota) or add suggested dishes", async () => {
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(search(kid, "chicken")).rejects.toThrow(ForbiddenError);
    await expect(addSuggestedDishes(db(), kid, TUESDAY, [fajitas()], NOW)).rejects.toThrow(ForbiddenError);
  });
});

describe("suggestDishes", () => {
  it("returns 3 mains within the time budget, then 3 different ones on 'show more'", async () => {
    const alex = await seedUser({ username: "alex" });
    const first = await search(alex, "chicken");
    expect(first.status).toBe("ok");
    expect(first.results).toHaveLength(3);
    for (const s of first.results) {
      expect(s.readyInMinutes).toBeLessThanOrEqual(30);
      expect(s).toMatchObject({ overBudget: false, similarTo: null, libraryRecipeId: null });
      expect(s.ingredients.length).toBeGreaterThan(0);
    }
    expect(first.results[0].ingredients).toContain("2 lb bone-in chicken thighs");
    expect(first.hasMore).toBe(true);

    const more = await search(alex, "chicken", { cursor: first.cursor });
    expect(more.results).toHaveLength(3);
    const ids = [...first.results, ...more.results].map((s) => s.spoonacularId);
    expect(new Set(ids).size).toBe(6);
  });

  it("relaxes constraints and labels each relaxed result", async () => {
    const alex = await seedUser({ username: "alex" });
    // Fixtures: one tofu main within 30 min, one at 40 min, and one that only
    // mentions tofu in its title.
    const res = await search(alex, "tofu");
    expect(res.results.map((s) => [s.title, s.overBudget, s.similarTo])).toEqual([
      ["Crispy Tofu Stir-Fry", false, null],
      ["Baked Sesame Tofu", true, null],
      ["Tofu-Style Crispy Cauliflower Bites", false, "tofu"],
    ]);
  });

  it("returns nothing (no error) when even relaxed searches find nothing", async () => {
    const alex = await seedUser({ username: "alex" });
    const res = await search(alex, "ostrich");
    expect(res).toMatchObject({ status: "ok", results: [], library: [], hasMore: false });
  });

  it("searches sides as side dishes", async () => {
    const alex = await seedUser({ username: "alex" });
    const res = await search(alex, "broccoli", { role: "side", maxTime: 15 });
    expect(res.results.map((s) => s.title)).toEqual([
      "Garlic Parmesan Broccoli",
      "Broccoli Salad",
      "Steamed Broccoli with Lemon",
    ]);
  });

  it("shows matching library recipes first and doesn't repeat them from Spoonacular", async () => {
    const alex = await seedUser({ username: "alex" });
    await seedRecipe({ title: "Chicken Pot Pie", readyInMinutes: 30, isFavorite: false });
    await seedRecipe({ title: "Grandma's Pie", readyInMinutes: null }, ["2 cups shredded chicken"]);
    await seedRecipe({ title: "Favorite Chicken Soup", readyInMinutes: 20, isFavorite: true });
    await seedRecipe({ title: "Chicken Fajitas", source: "spoonacular", spoonacularId: 900002, readyInMinutes: 25 });
    // Not matches: too slow, a side, archived, no chicken.
    await seedRecipe({ title: "Slow Chicken Stew", readyInMinutes: 90 });
    await seedRecipe({ title: "Chicken Salad", dishType: "side" });
    await seedRecipe({ title: "Old Chicken Bake", archivedAt: NOW });
    await seedRecipe({ title: "Veggie Tacos", readyInMinutes: 20 });

    const res = await search(alex, "chicken");
    expect(res.library.map((l) => l.title)).toEqual([
      "Favorite Chicken Soup",
      "Chicken Fajitas",
      "Chicken Pot Pie",
      "Grandma's Pie",
    ]);
    expect(res.results.map((s) => s.spoonacularId)).not.toContain(900002);
    // Library matches only come with the first page.
    expect((await search(alex, "chicken", { cursor: res.cursor })).library).toEqual([]);
  });

  it("falls back to library-only matches when the quota is exhausted", async () => {
    const alex = await seedUser({ username: "alex" });
    await seedRecipe({ title: "Chicken Pot Pie", readyInMinutes: 30 });
    await db().insert(apiUsage).values({ date: "2026-10-12", pointsUsed: 150, pointsLeft: 0 });
    const res = await search(alex, "chicken");
    expect(res).toMatchObject({ status: "quota_exhausted", results: [], hasMore: false, quota: { left: 0 } });
    expect(res.library.map((l) => l.title)).toEqual(["Chicken Pot Pie"]);
  });

  it("reports the fixture's simulated 402", async () => {
    const alex = await seedUser({ username: "alex" });
    expect((await search(alex, "quota-exhausted")).status).toBe("quota_exhausted");
  });

  it("reports a timeout as retryable", async () => {
    const alex = await seedUser({ username: "alex" });
    const down = await search(alex, "spoonacular-down");
    expect(down).toMatchObject({ status: "unavailable", message: "Spoonacular isn't responding.", hasMore: false });
  });

  it("reports quota left and flags it when low", async () => {
    const alex = await seedUser({ username: "alex" });
    const res = await search(alex, "chicken");
    expect(res.quota).toMatchObject({ low: false });
    expect(res.quota.left).toBeGreaterThan(20);
    await db().update(apiUsage).set({ pointsLeft: 12 }).where(eq(apiUsage.date, "2026-10-12"));
    // The repeat is served from the cache, so the stored count stands.
    expect((await search(alex, "chicken")).quota).toEqual({ left: 12, low: true });
  });

  it("rejects bad input", async () => {
    const alex = await seedUser({ username: "alex" });
    await expect(search(alex, "  ")).rejects.toThrow(ZodError);
    await expect(search(alex, "chicken", { maxTime: 0 })).rejects.toThrow(ZodError);
  });
});

describe("addSuggestedDishes", () => {
  it("saves the household's own copy and plans the night with the default cook", async () => {
    const alex = await seedUser({ username: "alex" });
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW); // Tuesday
    const rice = await seedRecipe({ title: "Cilantro Rice", dishType: "side" });

    const added = await addSuggestedDishes(
      db(),
      alex,
      TUESDAY,
      [fajitas(), { kind: "library", recipeId: rice.id, role: "side" }],
      NOW,
    );
    expect(added).toBe(2);

    const dinner = await getDinner(db(), TUESDAY);
    expect(dinner).toMatchObject({ status: "planned", cook: { id: alex.id }, cookManuallySet: false });
    expect(dinner.dishes.map((d) => [d.name, d.role])).toEqual([
      ["Chicken Fajitas", "main"],
      ["Cilantro Rice", "side"],
    ]);

    const [saved] = await db().select().from(recipes).where(eq(recipes.spoonacularId, 900002));
    expect(saved).toMatchObject({
      source: "spoonacular",
      title: "Chicken Fajitas",
      dishType: "main",
      servings: 4,
      readyInMinutes: 25,
      sourceUrl: "https://example.com/recipes/chicken-fajitas",
      archivedAt: null,
    });
    const lines = await db()
      .select({ rawText: recipeIngredients.rawText })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, saved.id))
      .orderBy(recipeIngredients.position);
    expect(lines.map((l) => l.rawText)).toEqual(["1.5 lb chicken breast", "8 flour tortillas"]);
  });

  it("deduplicates by spoonacularId, keeping the existing library copy", async () => {
    const alex = await seedUser({ username: "alex" });
    await addSuggestedDishes(db(), alex, TUESDAY, [fajitas()], NOW);
    await addSuggestedDishes(db(), alex, WEDNESDAY, [fajitas({ ingredients: "something else", servings: "8" })], NOW);

    const rows = await db().select().from(recipes).where(eq(recipes.spoonacularId, 900002));
    expect(rows).toHaveLength(1);
    expect(rows[0].servings).toBe(4);
    expect((await getDinner(db(), WEDNESDAY)).dishes[0].recipe?.id).toBe(rows[0].id);
  });

  it("brings back an archived recipe with the newly confirmed copy", async () => {
    const alex = await seedUser({ username: "alex" });
    const old = await seedRecipe(
      { title: "Chicken Fajitas", source: "spoonacular", spoonacularId: 900002, servings: 2, archivedAt: NOW },
      ["old line"],
    );
    await addSuggestedDishes(db(), alex, TUESDAY, [fajitas()], NOW);
    const [row] = await db().select().from(recipes).where(eq(recipes.id, old.id));
    expect(row).toMatchObject({ archivedAt: null, servings: 4 });
    const lines = await db().select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, old.id));
    expect(lines.map((l) => l.rawText).sort()).toEqual(["1.5 lb chicken breast", "8 flour tortillas"]);
  });

  it("stores a pick with no details as a recipe with no ingredients", async () => {
    const alex = await seedUser({ username: "alex" });
    await addSuggestedDishes(
      db(),
      alex,
      TUESDAY,
      [fajitas({ ingredients: "", servings: "", readyInMinutes: "", sourceUrl: "", imageUrl: null })],
      NOW,
    );
    const [row] = await db().select().from(recipes).where(eq(recipes.spoonacularId, 900002));
    expect(row).toMatchObject({ servings: null, readyInMinutes: null, sourceUrl: null, imageUrl: null });
    expect(await db().select().from(recipeIngredients)).toHaveLength(0);
  });

  it("rejects archived library picks, bad details, empty picks and locked weeks", async () => {
    const alex = await seedUser({ username: "alex" });
    const archived = await seedRecipe({ title: "Gone", archivedAt: NOW });
    await expect(
      addSuggestedDishes(db(), alex, TUESDAY, [{ kind: "library", recipeId: archived.id, role: "main" }], NOW),
    ).rejects.toThrow("That recipe is no longer in the library.");
    await expect(addSuggestedDishes(db(), alex, TUESDAY, [fajitas({ servings: "lots" })], NOW)).rejects.toThrow(
      ZodError,
    );
    await expect(
      addSuggestedDishes(db(), alex, TUESDAY, [fajitas({ sourceUrl: "javascript:alert(1)" })], NOW),
    ).rejects.toThrow(ZodError);
    await expect(addSuggestedDishes(db(), alex, TUESDAY, [], NOW)).rejects.toThrow(ZodError);
    await expect(addSuggestedDishes(db(), alex, LAST_WEEK, [fajitas()], NOW)).rejects.toThrow(ServiceError);
    // Nothing was half-saved.
    expect(await db().select().from(recipes).where(eq(recipes.spoonacularId, 900002))).toHaveLength(0);
    expect((await getDinner(db(), TUESDAY)).status).toBe("unplanned");
  });

  it("publishes the night's change, then the grocery list's once ingredients are parsed", async () => {
    const alex = await seedUser({ username: "alex" });
    const events: AppEvent[] = [];
    const unsubscribe = subscribe((e) => events.push(e));
    try {
      await addSuggestedDishes(db(), alex, TUESDAY, [fajitas()], NOW);
    } finally {
      unsubscribe();
    }
    expect(events).toEqual([
      { type: "dinner.updated", date: TUESDAY, weekStart: "2026-10-11" },
      { type: "grocery.updated", weekStart: "2026-10-11" },
    ]);
  });

  it("marks a search result that's already in the library", async () => {
    const alex = await seedUser({ username: "alex" });
    // 900003 (Honey Soy Chicken Stir-Fry) is in the library but its title
    // doesn't match "breast", so it comes back from Spoonacular, annotated.
    const saved = await seedRecipe({ title: "Honey Soy Stir-Fry", source: "spoonacular", spoonacularId: 900003 });
    const res = await search(alex, "chicken breast");
    const hit = res.results.find((s) => s.spoonacularId === 900003);
    expect(hit?.libraryRecipeId).toBe(saved.id);
  });
});
