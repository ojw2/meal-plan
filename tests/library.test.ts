import { beforeEach, describe, expect, it } from "vitest";
import { dinners, dishes } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { subscribe, type AppEvent } from "@/lib/events";
import {
  addLibraryDish,
  archiveRecipe,
  getRecipeDetails,
  lastMadeLabel,
  listLibrary,
  restoreRecipe,
  setFavorite,
} from "@/lib/services/library";
import { getDinner } from "@/lib/services/planner";
import { db, resetDb, seedHousehold, seedRecipe, seedUser } from "./helpers/db";

// Monday 2026-10-12, noon in New York; weeks start on Sunday.
const NOW = new Date("2026-10-12T16:00:00Z");
const TODAY = "2026-10-12";
const TUESDAY = "2026-10-13";

/** A planned dinner on `date` using the given recipes. */
async function made(date: string, ...recipeIds: string[]) {
  const [dinner] = await db().insert(dinners).values({ date, status: "planned" }).returning();
  await db()
    .insert(dishes)
    .values(recipeIds.map((recipeId, position) => ({ dinnerId: dinner.id, recipeId, role: "main" as const, position })));
}

const titles = (items: { title: string }[]) => items.map((i) => i.title);

beforeEach(async () => {
  await resetDb();
  await seedHousehold("America/New_York");
});

describe("listLibrary", () => {
  it("lists non-archived recipes by title, with search and filters", async () => {
    await seedRecipe({ title: "tacos" });
    await seedRecipe({ title: "Beef Stew", isFavorite: true });
    await seedRecipe({ title: "Rice", dishType: "side" });
    await seedRecipe({ title: "Old Taco Bake", archivedAt: NOW });

    expect(titles(await listLibrary(db(), {}, TODAY))).toEqual(["Beef Stew", "Rice", "tacos"]);
    expect(titles(await listLibrary(db(), { q: "TAC" }, TODAY))).toEqual(["tacos"]);
    expect(titles(await listLibrary(db(), { q: "%" }, TODAY))).toEqual([]);
    expect(titles(await listLibrary(db(), { role: "side" }, TODAY))).toEqual(["Rice"]);
    expect(titles(await listLibrary(db(), { favorites: true }, TODAY))).toEqual(["Beef Stew"]);
    expect(titles(await listLibrary(db(), { archived: true }, TODAY))).toEqual(["Old Taco Bake"]);
  });

  it("counts past planned dinners for last made and times made", async () => {
    const tacos = await seedRecipe({ title: "Tacos" });
    const rice = await seedRecipe({ title: "Rice", dishType: "side" });
    await made("2026-09-30", tacos.id, rice.id);
    await made("2026-10-05", tacos.id);
    await made(TODAY, tacos.id); // tonight hasn't happened yet
    await made("2026-10-20", rice.id); // future

    const [riceItem, tacosItem] = await listLibrary(db(), {}, TODAY);
    expect(tacosItem).toMatchObject({ lastMade: "2026-10-05", timesMade: 2 });
    expect(riceItem).toMatchObject({ lastMade: "2026-09-30", timesMade: 1 });
    expect(lastMadeLabel(tacosItem, TODAY)).toBe("Last made 7 days ago");
    expect(lastMadeLabel({ lastMade: "2026-10-11" }, TODAY)).toBe("Last made yesterday");
    expect(lastMadeLabel({ lastMade: null }, TODAY)).toBe("Not made yet");
  });

  it("the picker order puts favorites first, then the least recently made", async () => {
    const recent = await seedRecipe({ title: "Recent" });
    const older = await seedRecipe({ title: "Older" });
    await seedRecipe({ title: "Never" });
    const fav = await seedRecipe({ title: "Fav", isFavorite: true });
    await made("2026-10-10", recent.id, fav.id);
    await made("2026-09-01", older.id);

    expect(titles(await listLibrary(db(), {}, TODAY, "picker"))).toEqual(["Fav", "Never", "Older", "Recent"]);
  });
});

describe("recipe details", () => {
  it("includes ingredients and history, and resolves archived recipes", async () => {
    const r = await seedRecipe({ title: "Soup", archivedAt: NOW, servings: 4 }, ["2 carrots", "1 onion"]);
    await made("2026-10-01", r.id);
    expect(await getRecipeDetails(db(), r.id, TODAY)).toMatchObject({
      title: "Soup",
      archived: true,
      servings: 4,
      ingredients: ["2 carrots", "1 onion"],
      timesMade: 1,
    });
    expect(await getRecipeDetails(db(), "not-a-uuid", TODAY)).toBeNull();
    expect(await getRecipeDetails(db(), crypto.randomUUID(), TODAY)).toBeNull();
  });
});

describe("mutations", () => {
  it("kids can't favorite, archive, restore or add from the library", async () => {
    const kid = await seedUser({ username: "sam", role: "kid" });
    const r = await seedRecipe({ title: "Tacos" });
    await expect(setFavorite(db(), kid, r.id, true)).rejects.toThrow(ForbiddenError);
    await expect(archiveRecipe(db(), kid, r.id, NOW)).rejects.toThrow(ForbiddenError);
    await expect(restoreRecipe(db(), kid, r.id)).rejects.toThrow(ForbiddenError);
    await expect(addLibraryDish(db(), kid, TUESDAY, r.id, NOW)).rejects.toThrow(ForbiddenError);
  });

  it("favorites, archives and restores, publishing each change", async () => {
    const alex = await seedUser({ username: "alex" });
    const r = await seedRecipe({ title: "Tacos" });
    const events: AppEvent[] = [];
    const unsubscribe = subscribe((e) => events.push(e));
    try {
      await setFavorite(db(), alex, r.id, true);
      expect((await listLibrary(db(), { favorites: true }, TODAY))[0].id).toBe(r.id);
      await archiveRecipe(db(), alex, r.id, NOW);
      expect(await listLibrary(db(), {}, TODAY)).toEqual([]);
      await restoreRecipe(db(), alex, r.id);
      expect(titles(await listLibrary(db(), {}, TODAY))).toEqual(["Tacos"]);
    } finally {
      unsubscribe();
    }
    expect(events).toEqual(Array(3).fill({ type: "recipe.updated", recipeId: r.id }));
    await expect(setFavorite(db(), alex, "nope", true)).rejects.toThrow("no longer exists");
  });

  it("archiving keeps the recipe on dinners that use it", async () => {
    const alex = await seedUser({ username: "alex" });
    const r = await seedRecipe({ title: "Tacos" });
    await addLibraryDish(db(), alex, TUESDAY, r.id, NOW);
    await archiveRecipe(db(), alex, r.id, NOW);
    expect((await getDinner(db(), TUESDAY)).dishes[0]).toMatchObject({ name: "Tacos", recipe: { id: r.id } });
  });

  it("adds a library recipe to a night in its own role", async () => {
    const alex = await seedUser({ username: "alex" });
    const rice = await seedRecipe({ title: "Rice", dishType: "side" });
    await addLibraryDish(db(), alex, TUESDAY, rice.id, NOW);
    const dinner = await getDinner(db(), TUESDAY);
    expect(dinner.status).toBe("planned");
    expect(dinner.dishes).toEqual([expect.objectContaining({ name: "Rice", role: "side" })]);

    const gone = await seedRecipe({ title: "Gone", archivedAt: NOW });
    await expect(addLibraryDish(db(), alex, TUESDAY, gone.id, NOW)).rejects.toThrow("no longer in the library");
    await expect(addLibraryDish(db(), alex, "2026-10-06", rice.id, NOW)).rejects.toThrow("in the past");
  });
});
