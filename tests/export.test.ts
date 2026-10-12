import { beforeEach, describe, expect, it } from "vitest";
import { cookSchedule, dishes, groceryChecks, manualGroceryItems, recurringRules } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { EXPORT_FORMAT, EXPORT_VERSION, exportHousehold } from "@/lib/services/export";
import { db, resetDb, seedDinner, seedHousehold, seedRecipe, seedUser } from "./helpers/db";

const NOW = new Date("2026-10-12T16:00:00Z");

beforeEach(async () => {
  await resetDb();
  await seedHousehold();
});

describe("exportHousehold", () => {
  it("is adults only", async () => {
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(exportHousehold(db(), kid, NOW)).rejects.toThrow(ForbiddenError);
  });

  it("contains settings, members, recipes, dinners, dishes, rules and grocery state", async () => {
    const alex = await seedUser({ username: "alex", displayName: "Alex" });
    const kid = await seedUser({ username: "sam", role: "kid", displayName: "Sam" });
    await db().insert(cookSchedule).values({ weekday: 2, userId: alex.id });
    const tacos = await seedRecipe({ title: "Tacos", servings: 4, isFavorite: true }, ["1 lb beef", "8 tortillas"]);
    const dinnerId = await seedDinner("2026-10-13", alex.id);
    await db().insert(dishes).values({ dinnerId, recipeId: tacos.id, role: "side", position: 1 });
    await db()
      .insert(recurringRules)
      .values({ weekday: 5, template: [{ freeTextName: "Pizza", role: "main" }], startDate: "2026-10-16" });
    await db().insert(groceryChecks).values({
      weekStartDate: "2026-10-11",
      itemKey: "beef|g",
      checked: true,
      checkedAmountSnapshot: 453.6,
      label: "Beef",
      checkedBy: alex.id,
      checkedAt: NOW,
    });
    await db().insert(manualGroceryItems).values({ weekStartDate: "2026-10-11", text: "Paper towels", createdBy: alex.id });

    const data = await exportHousehold(db(), alex, NOW);

    expect(data).toMatchObject({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: NOW.toISOString(),
      household: { name: "Test House", timezone: "America/New_York", weekStartDay: 0, defaultServings: 4 },
      cookSchedule: [{ weekday: 2, userId: alex.id }],
    });
    expect(data.users.map((u) => [u.username, u.displayName, u.role])).toEqual([
      ["alex", "Alex", "adult"],
      ["sam", "Sam", "kid"],
    ]);
    expect(data.users[1].id).toBe(kid.id);

    expect(data.recipes).toHaveLength(1);
    expect(data.recipes[0]).toMatchObject({ title: "Tacos", servings: 4, isFavorite: true });
    expect(data.recipes[0].ingredients.map((i) => i.rawText)).toEqual(["1 lb beef", "8 tortillas"]);

    expect(data.dinners).toHaveLength(1);
    expect(data.dinners[0]).toMatchObject({ date: "2026-10-13", status: "planned", cookUserId: alex.id });
    expect(data.dinners[0].dishes.map((d) => [d.freeTextName, d.recipeId, d.role])).toEqual([
      ["Dinner 2026-10-13", null, "main"],
      [null, tacos.id, "side"],
    ]);

    expect(data.recurringRules).toHaveLength(1);
    expect(data.recurringRules[0]).toMatchObject({ weekday: 5, template: [{ freeTextName: "Pizza", role: "main" }] });
    expect(data.grocery.checks).toEqual([expect.objectContaining({ itemKey: "beef|g", checkedAmountSnapshot: 453.6 })]);
    expect(data.grocery.manualItems).toEqual([expect.objectContaining({ text: "Paper towels", checked: false })]);
  });

  it("never includes password or PIN hashes, or sessions", async () => {
    const alex = await seedUser({ username: "alex" });
    await seedUser({ username: "sam", role: "kid" });
    const json = JSON.stringify(await exportHousehold(db(), alex, NOW));
    expect(json).not.toMatch(/hash/i);
    expect(json).not.toContain("$argon2");
    expect(json).not.toMatch(/session/i);
  });

  it("includes archived members and recipes, which past dinners still refer to", async () => {
    const alex = await seedUser({ username: "alex" });
    await seedRecipe({ title: "Old favorite", archivedAt: NOW });
    const data = await exportHousehold(db(), alex, NOW);
    expect(data.recipes.map((r) => [r.title, r.archivedAt])).toEqual([["Old favorite", NOW]]);
  });
});
