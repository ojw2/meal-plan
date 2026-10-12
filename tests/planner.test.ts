import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLog, dinners, household, recipeIngredients, recipes, recurringRules } from "@/db/schema";
import { ForbiddenError, ServiceError } from "@/lib/errors";
import { subscribe, type AppEvent } from "@/lib/events";
import { setCookSchedule } from "@/lib/services/household";
import { archiveMember } from "@/lib/services/members";
import {
  addManualDish,
  getDinner,
  getWeek,
  moveDish,
  removeDish,
  resetDinnerCook,
  setDinnerStatus,
  unlockWeek,
  updateDinnerDetails,
  weekAccess,
  weekGaps,
  type ManualDishInput,
} from "@/lib/services/planner";
import { cookOf, db, resetDb, seedDinner, seedHousehold, seedUser, withSession } from "./helpers/db";

// Monday 2026-10-12, noon in New York. Weeks start on Sunday by default, so the
// current week is Oct 11–17 and last week (Oct 4–10) is past.
const NOW = new Date("2026-10-12T16:00:00Z");
const TODAY = "2026-10-12";
const TUESDAY = "2026-10-13";
const SUNDAY = "2026-10-11"; // earlier day, current week
const LAST_WEEK = "2026-10-08";

const dish = (overrides: Partial<ManualDishInput> = {}): ManualDishInput => ({
  name: "Tacos",
  role: "main",
  ingredients: "",
  sourceUrl: "",
  readyInMinutes: "",
  notes: "",
  saveToLibrary: true,
  ...overrides,
});

beforeEach(async () => {
  await resetDb();
  await seedHousehold("America/New_York");
});

describe("permissions", () => {
  it("kids can't change anything about a dinner", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    const dishId = await addManualDish(db(), alex, TUESDAY, dish(), NOW);
    const attempts = [
      addManualDish(db(), kid, TUESDAY, dish(), NOW),
      removeDish(db(), kid, dishId, NOW),
      moveDish(db(), kid, dishId, "up", NOW),
      setDinnerStatus(db(), kid, TUESDAY, "eat_out", NOW),
      updateDinnerDetails(db(), kid, TUESDAY, { cookUserId: null, servingsOverride: 2 }, NOW),
      resetDinnerCook(db(), kid, TUESDAY, NOW),
      unlockWeek(db(), kid, LAST_WEEK, NOW),
    ];
    for (const p of attempts) await expect(p).rejects.toThrow(ForbiddenError);
    expect((await getDinner(db(), TUESDAY)).dishes).toHaveLength(1);
  });

  it("kids never have edit access, even to the current week", async () => {
    const kid = await withSession(await seedUser({ username: "sam", role: "kid" }));
    expect((await weekAccess(db(), kid, SUNDAY, TODAY)).editable).toBe(false);
  });
});

describe("addManualDish", () => {
  it("saves to the library by default, keeping raw ingredient lines", async () => {
    const alex = await seedUser({ username: "alex" });
    await addManualDish(
      db(),
      alex,
      TUESDAY,
      dish({
        ingredients: "1 lb ground beef\n\n  8 tortillas  \n",
        sourceUrl: "https://example.com/tacos",
        readyInMinutes: "30",
        notes: "Extra lime",
      }),
      NOW,
    );
    const [recipe] = await db().select().from(recipes);
    expect(recipe).toMatchObject({
      source: "manual",
      title: "Tacos",
      dishType: "main",
      readyInMinutes: 30,
      sourceUrl: "https://example.com/tacos",
      notes: "Extra lime",
      archivedAt: null,
    });
    const lines = await db().select().from(recipeIngredients).orderBy(recipeIngredients.position);
    expect(lines.map((l) => l.rawText)).toEqual(["1 lb ground beef", "8 tortillas"]);

    const dinner = await getDinner(db(), TUESDAY);
    expect(dinner.status).toBe("planned");
    expect(dinner.dishes).toEqual([
      expect.objectContaining({ name: "Tacos", role: "main", recipe: expect.objectContaining({ id: recipe.id }) }),
    ]);
  });

  it("stores a bare name as free text when not saving to the library", async () => {
    const alex = await seedUser({ username: "alex" });
    await addManualDish(db(), alex, TUESDAY, dish({ name: "Pizza", saveToLibrary: false }), NOW);
    expect(await db().select().from(recipes)).toHaveLength(0);
    const [d] = (await getDinner(db(), TUESDAY)).dishes;
    expect(d).toMatchObject({ name: "Pizza", recipe: null });
  });

  it("keeps details in a hidden (archived) recipe when not saving to the library", async () => {
    const alex = await seedUser({ username: "alex" });
    await addManualDish(
      db(),
      alex,
      TUESDAY,
      dish({ name: "Soup", ingredients: "2 carrots", saveToLibrary: false }),
      NOW,
    );
    const [recipe] = await db().select().from(recipes);
    expect(recipe.archivedAt).toEqual(NOW);
    expect(await db().select().from(recipeIngredients)).toHaveLength(1);
    expect((await getDinner(db(), TUESDAY)).dishes[0].recipe?.id).toBe(recipe.id);
  });

  it("validates the form", async () => {
    const alex = await seedUser({ username: "alex" });
    await expect(addManualDish(db(), alex, TUESDAY, dish({ name: "  " }), NOW)).rejects.toThrow(
      "Dish name is required",
    );
    await expect(addManualDish(db(), alex, TUESDAY, dish({ sourceUrl: "javascript:alert(1)" }), NOW)).rejects.toThrow(
      "full web address",
    );
    await expect(addManualDish(db(), alex, TUESDAY, dish({ readyInMinutes: "soon" }), NOW)).rejects.toThrow(
      "number of minutes",
    );
    await expect(addManualDish(db(), alex, "2026-02-30", dish(), NOW)).rejects.toThrow("Invalid date");
    expect(await db().select().from(dinners)).toHaveLength(0);
  });

  it("appends dishes in order and a later dish keeps the night's cook", async () => {
    const alex = await seedUser({ username: "alex" });
    const bo = await seedUser({ username: "bo" });
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    await addManualDish(db(), alex, TUESDAY, dish({ name: "Tacos" }), NOW);
    await updateDinnerDetails(db(), alex, TUESDAY, { cookUserId: bo.id, servingsOverride: null }, NOW);
    await addManualDish(db(), alex, TUESDAY, dish({ name: "Rice", role: "side" }), NOW);
    const dinner = await getDinner(db(), TUESDAY);
    expect(dinner.dishes.map((d) => d.name)).toEqual(["Tacos", "Rice"]);
    expect(dinner.cook?.id).toBe(bo.id);
  });
});

describe("cooks", () => {
  it("a newly planned night gets the default cook for its weekday", async () => {
    const alex = await seedUser({ username: "alex" });
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    await addManualDish(db(), alex, TUESDAY, dish(), NOW);
    expect(await getDinner(db(), TUESDAY)).toMatchObject({
      cook: { id: alex.id, displayName: "alex", archived: false },
      cookManuallySet: false,
    });
    // No default for Wednesday.
    await addManualDish(db(), alex, "2026-10-14", dish(), NOW);
    expect((await getDinner(db(), "2026-10-14")).cook).toBeNull();
  });

  it("a hand-picked cook survives schedule changes until reset to default", async () => {
    const alex = await seedUser({ username: "alex" });
    const bo = await seedUser({ username: "bo" });
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    await addManualDish(db(), alex, TUESDAY, dish(), NOW);

    await updateDinnerDetails(db(), alex, TUESDAY, { cookUserId: bo.id, servingsOverride: null }, NOW);
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    expect(await getDinner(db(), TUESDAY)).toMatchObject({ cook: { id: bo.id }, cookManuallySet: true });

    await resetDinnerCook(db(), alex, TUESDAY, NOW);
    expect(await getDinner(db(), TUESDAY)).toMatchObject({ cook: { id: alex.id }, cookManuallySet: false });
  });

  it("saving servings alone doesn't pin the default cook", async () => {
    const alex = await seedUser({ username: "alex" });
    const bo = await seedUser({ username: "bo" });
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    await addManualDish(db(), alex, TUESDAY, dish(), NOW);
    await updateDinnerDetails(db(), alex, TUESDAY, { cookUserId: alex.id, servingsOverride: 6 }, NOW);
    expect(await getDinner(db(), TUESDAY)).toMatchObject({ servingsOverride: 6, cookManuallySet: false });

    await setCookSchedule(db(), alex, { 2: bo.id }, NOW);
    expect((await getDinner(db(), TUESDAY)).cook?.id).toBe(bo.id);
  });

  it("only active adults can cook, and only on planned nights", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(
      updateDinnerDetails(db(), alex, TUESDAY, { cookUserId: alex.id, servingsOverride: null }, NOW),
    ).rejects.toThrow("Add a dish");
    await addManualDish(db(), alex, TUESDAY, dish(), NOW);
    await expect(
      updateDinnerDetails(db(), alex, TUESDAY, { cookUserId: kid.id, servingsOverride: null }, NOW),
    ).rejects.toThrow("Only active adults");
    await expect(
      updateDinnerDetails(db(), alex, TUESDAY, { cookUserId: null, servingsOverride: 0 }, NOW),
    ).rejects.toThrow("At least 1 serving");
  });

  it("an archived cook's upcoming nights become unassigned; past nights keep the name", async () => {
    const alex = await seedUser({ username: "alex" });
    const bo = await seedUser({ username: "bo", displayName: "Bo" });
    const past = await seedDinner("2026-10-01", bo.id);
    await addManualDish(db(), alex, TUESDAY, dish(), NOW);
    await updateDinnerDetails(db(), alex, TUESDAY, { cookUserId: bo.id, servingsOverride: null }, NOW);

    await archiveMember(db(), alex, bo.id, NOW);
    expect(await cookOf(past)).toBe(bo.id);
    expect((await getDinner(db(), "2026-10-01")).cook).toEqual({ id: bo.id, displayName: "Bo", archived: true });
    expect(await getDinner(db(), TUESDAY)).toMatchObject({ cook: null, cookManuallySet: false });
  });
});

describe("night status and dishes", () => {
  it("eat out / leftovers clear dishes and the cook; adding a dish re-plans the night", async () => {
    const alex = await seedUser({ username: "alex" });
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    await addManualDish(db(), alex, TUESDAY, dish(), NOW);
    await addManualDish(db(), alex, TUESDAY, dish({ name: "Rice", role: "side" }), NOW);

    await setDinnerStatus(db(), alex, TUESDAY, "eat_out", NOW);
    expect(await getDinner(db(), TUESDAY)).toMatchObject({ status: "eat_out", cook: null, dishes: [] });

    await setDinnerStatus(db(), alex, TUESDAY, "leftovers", NOW);
    expect((await getDinner(db(), TUESDAY)).status).toBe("leftovers");

    await addManualDish(db(), alex, TUESDAY, dish({ name: "Chili" }), NOW);
    expect(await getDinner(db(), TUESDAY)).toMatchObject({ status: "planned", cook: { id: alex.id } });

    await setDinnerStatus(db(), alex, TUESDAY, "unplanned", NOW);
    expect(await getDinner(db(), TUESDAY)).toMatchObject({ status: "unplanned", dishes: [] });
  });

  it("removing the last dish returns the night to unplanned", async () => {
    const alex = await seedUser({ username: "alex" });
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    const a = await addManualDish(db(), alex, TUESDAY, dish({ name: "A" }), NOW);
    const b = await addManualDish(db(), alex, TUESDAY, dish({ name: "B" }), NOW);
    await removeDish(db(), alex, a, NOW);
    expect(await getDinner(db(), TUESDAY)).toMatchObject({ status: "planned", cook: { id: alex.id } });
    await removeDish(db(), alex, b, NOW);
    expect(await getDinner(db(), TUESDAY)).toMatchObject({ status: "unplanned", cook: null, dishes: [] });
    await expect(removeDish(db(), alex, b, NOW)).rejects.toThrow("no longer exists");
  });

  it("reorders dishes, ignoring moves past either end", async () => {
    const alex = await seedUser({ username: "alex" });
    const a = await addManualDish(db(), alex, TUESDAY, dish({ name: "A" }), NOW);
    await addManualDish(db(), alex, TUESDAY, dish({ name: "B" }), NOW);
    const c = await addManualDish(db(), alex, TUESDAY, dish({ name: "C" }), NOW);
    const names = async () => (await getDinner(db(), TUESDAY)).dishes.map((d) => d.name);

    await moveDish(db(), alex, c, "up", NOW);
    expect(await names()).toEqual(["A", "C", "B"]);
    await moveDish(db(), alex, a, "down", NOW);
    expect(await names()).toEqual(["C", "A", "B"]);
    await moveDish(db(), alex, c, "up", NOW);
    expect(await names()).toEqual(["C", "A", "B"]);
  });

  it("editing a recurring instance marks it overridden", async () => {
    const alex = await seedUser({ username: "alex" });
    const [rule] = await db()
      .insert(recurringRules)
      .values({ weekday: 2, template: [], startDate: "2026-01-01" })
      .returning();
    await db().insert(dinners).values({ date: TUESDAY, recurringRuleId: rule.id });
    await setDinnerStatus(db(), alex, TUESDAY, "eat_out", NOW);
    const [row] = await db().select().from(dinners).where(eq(dinners.date, TUESDAY));
    expect(row.overridden).toBe(true);
  });
});

describe("past-week lock", () => {
  it("blocks edits to past weeks but not earlier days of the current week", async () => {
    const alex = await withSession(await seedUser({ username: "alex" }));
    await expect(addManualDish(db(), alex, LAST_WEEK, dish(), NOW)).rejects.toMatchObject({ code: "locked" });
    await expect(setDinnerStatus(db(), alex, LAST_WEEK, "eat_out", NOW)).rejects.toThrow(ServiceError);
    await addManualDish(db(), alex, SUNDAY, dish(), NOW);
    expect((await getDinner(db(), SUNDAY)).status).toBe("planned");
  });

  it("locks existing dishes in a past week too", async () => {
    const alex = await withSession(await seedUser({ username: "alex" }));
    const id = await seedDinner(LAST_WEEK, null);
    const [d] = (await getDinner(db(), LAST_WEEK)).dishes;
    await expect(removeDish(db(), alex, d.id, NOW)).rejects.toMatchObject({ code: "locked" });
    expect(await cookOf(id)).toBeNull();
  });

  it("follows the household's week start", async () => {
    const alex = await withSession(await seedUser({ username: "alex" }));
    // With Tuesday starts, the current week is Oct 6–12, so Oct 8 is editable.
    await db().update(household).set({ weekStartDay: 2 });
    await addManualDish(db(), alex, LAST_WEEK, dish(), NOW);
    await expect(addManualDish(db(), alex, "2026-10-05", dish(), NOW)).rejects.toMatchObject({ code: "locked" });
  });

  it("unlocks a past week for the current session only, logging it once", async () => {
    const user = await seedUser({ username: "alex" });
    const phone = await withSession(user);
    const laptop = await withSession(user);

    expect(await unlockWeek(db(), phone, LAST_WEEK, NOW)).toBe("2026-10-04");
    await unlockWeek(db(), phone, "2026-10-05", NOW); // same week again
    expect(await weekAccess(db(), phone, "2026-10-04", TODAY)).toEqual({
      past: true,
      unlocked: true,
      editable: true,
    });
    await addManualDish(db(), phone, LAST_WEEK, dish(), NOW);
    await expect(addManualDish(db(), laptop, LAST_WEEK, dish(), NOW)).rejects.toMatchObject({ code: "locked" });

    const log = await db().select().from(auditLog);
    expect(log).toEqual([
      expect.objectContaining({ userId: user.id, action: "week.unlock", details: { weekStart: "2026-10-04" } }),
    ]);
  });

  it("unlocking a current or future week is a no-op", async () => {
    const alex = await withSession(await seedUser({ username: "alex" }));
    expect(await unlockWeek(db(), alex, TUESDAY, NOW)).toBe(SUNDAY);
    expect(await db().select().from(auditLog)).toHaveLength(0);
  });
});

describe("reads", () => {
  it("returns all seven nights, with gaps counted from today on", async () => {
    const alex = await seedUser({ username: "alex" });
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    await addManualDish(db(), alex, SUNDAY, dish(), NOW); // past day: not counted
    await addManualDish(db(), alex, TUESDAY, dish(), NOW); // has the default cook
    await addManualDish(db(), alex, "2026-10-14", dish(), NOW); // no cook
    await setDinnerStatus(db(), alex, "2026-10-15", "eat_out", NOW);

    const week = await getWeek(db(), SUNDAY);
    expect(week.map((d) => d.date)).toEqual([
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
    ]);
    expect(week.map((d) => d.status)).toEqual([
      "planned",
      "unplanned",
      "planned",
      "planned",
      "eat_out",
      "unplanned",
      "unplanned",
    ]);
    // Unplanned: Mon (today), Fri, Sat. Without a cook: Sun is past, so only Wed.
    expect(weekGaps(week, TODAY)).toEqual({ unplanned: 3, withoutCook: 1 });
  });
});

describe("events", () => {
  let events: AppEvent[];
  let unsubscribe: () => void;
  beforeEach(() => {
    events = [];
    unsubscribe = subscribe((e) => events.push(e));
  });
  afterEach(() => unsubscribe());

  it("every dinner mutation publishes its week", async () => {
    const alex = await seedUser({ username: "alex" });
    const id = await addManualDish(db(), alex, TUESDAY, dish(), NOW);
    await moveDish(db(), alex, id, "up", NOW);
    await updateDinnerDetails(db(), alex, TUESDAY, { cookUserId: null, servingsOverride: 3 }, NOW);
    await resetDinnerCook(db(), alex, TUESDAY, NOW);
    await removeDish(db(), alex, id, NOW);
    await setDinnerStatus(db(), alex, TUESDAY, "leftovers", NOW);
    expect(events).toHaveLength(6);
    expect(new Set(events.map((e) => JSON.stringify(e)))).toEqual(
      new Set([JSON.stringify({ type: "dinner.updated", date: TUESDAY, weekStart: SUNDAY })]),
    );
  });

  it("failed mutations publish nothing; schedule changes publish affected nights", async () => {
    const alex = await withSession(await seedUser({ username: "alex" }));
    await expect(addManualDish(db(), alex, LAST_WEEK, dish(), NOW)).rejects.toThrow();
    expect(events).toHaveLength(0);

    await seedDinner("2026-10-20", null); // Tuesday next week
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    expect(events).toEqual([
      { type: "dinner.updated", date: "2026-10-20", weekStart: "2026-10-18" },
      { type: "household.updated" },
    ]);
  });
});
