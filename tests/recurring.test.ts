import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { dinners, dishes, recurringRules } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { subscribe, type AppEvent } from "@/lib/events";
import { setCookSchedule } from "@/lib/services/household";
import { addManualDish, getDinner, getDinners, removeDish, updateDinnerDetails } from "@/lib/services/planner";
import {
  createRule,
  createRuleFromDinner,
  listRules,
  materializeRecurring,
  setRuleActive,
  updateRule,
  type RuleInput,
} from "@/lib/services/recurring";
import { db, resetDb, seedHousehold, seedRecipe, seedUser } from "./helpers/db";

// Monday 2026-10-12, noon in New York; weeks start on Sunday.
const NOW = new Date("2026-10-12T16:00:00Z");
const LAST_TUESDAY = "2026-10-06";
const TUESDAY = "2026-10-13";
const NEXT_TUESDAY = "2026-10-20";
const LATER_TUESDAY = "2026-10-27";
const TUE = 2;

const tacoNight = (overrides: Partial<RuleInput> = {}): RuleInput => ({
  weekday: TUE,
  startDate: "2026-10-01",
  endDate: "",
  dishes: [
    { role: "main", name: "Tacos" },
    { role: "side", name: "Mexican rice" },
    { role: "side", name: "" }, // blank form rows are ignored
  ],
  ...overrides,
});

const dishNames = async (date: string) => (await getDinner(db(), date)).dishes.map((d) => d.name);

/** Fills the next three weeks, as the week view would. */
const viewWeeks = () => materializeRecurring(db(), "2026-10-04", "2026-10-31", NOW);

beforeEach(async () => {
  await resetDb();
  await seedHousehold("America/New_York");
});

describe("permissions", () => {
  it("kids can't create or change rules", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    const id = await createRule(db(), alex, tacoNight());
    await expect(createRule(db(), kid, tacoNight({ weekday: 3 }))).rejects.toThrow(ForbiddenError);
    await expect(updateRule(db(), kid, id, tacoNight(), NOW)).rejects.toThrow(ForbiddenError);
    await expect(setRuleActive(db(), kid, id, false, NOW)).rejects.toThrow(ForbiddenError);
    await expect(createRuleFromDinner(db(), kid, TUESDAY, NOW)).rejects.toThrow(ForbiddenError);
  });
});

describe("rules", () => {
  it("links typed names to library recipes by title, otherwise keeps free text", async () => {
    const alex = await seedUser({ username: "alex" });
    const tacos = await seedRecipe({ title: "TACOS" });
    await seedRecipe({ title: "Mexican rice", archivedAt: NOW }); // archived: not linked
    await createRule(db(), alex, tacoNight());
    const [rule] = await listRules(db());
    expect(rule).toMatchObject({ weekday: TUE, startDate: "2026-10-01", endDate: null, active: true });
    expect(rule.dishes).toEqual([
      { role: "main", name: "TACOS", recipeId: tacos.id },
      { role: "side", name: "Mexican rice", recipeId: null },
    ]);
  });

  it("validates the form", async () => {
    const alex = await seedUser({ username: "alex" });
    await expect(createRule(db(), alex, tacoNight({ dishes: [{ role: "main", name: " " }] }))).rejects.toThrow(
      "at least one dish",
    );
    await expect(createRule(db(), alex, tacoNight({ endDate: "2026-09-01" }))).rejects.toThrow("after the start");
    await expect(createRule(db(), alex, tacoNight({ startDate: "2026-02-30" }))).rejects.toThrow("valid date");
  });

  it("active rules can't overlap on the same weekday", async () => {
    const alex = await seedUser({ username: "alex" });
    const first = await createRule(db(), alex, tacoNight({ endDate: "2026-10-31" }));
    await expect(createRule(db(), alex, tacoNight({ startDate: "2026-10-31" }))).rejects.toThrow("already covers");
    // Back to back is fine, as is another weekday.
    const second = await createRule(db(), alex, tacoNight({ startDate: "2026-11-01" }));
    await createRule(db(), alex, tacoNight({ weekday: 3 }));
    await expect(updateRule(db(), alex, first, tacoNight({ endDate: "2026-11-07" }), NOW)).rejects.toThrow(
      "already covers",
    );
    // An inactive rule doesn't block, but can't come back while it would clash.
    await setRuleActive(db(), alex, second, false, NOW);
    await updateRule(db(), alex, first, tacoNight({ endDate: "2026-11-07" }), NOW);
    await expect(setRuleActive(db(), alex, second, true, NOW)).rejects.toThrow("already covers");
  });
});

describe("instances", () => {
  it("fill empty nights from today on, with the default cook", async () => {
    const alex = await seedUser({ username: "alex" });
    await setCookSchedule(db(), alex, { [TUE]: alex.id }, NOW);
    const tacos = await seedRecipe({ title: "Tacos" });
    const ruleId = await createRule(db(), alex, tacoNight({ endDate: NEXT_TUESDAY }));

    expect(await viewWeeks()).toEqual([TUESDAY, NEXT_TUESDAY]);
    const dinner = await getDinner(db(), TUESDAY);
    expect(dinner).toMatchObject({
      status: "planned",
      cook: { id: alex.id },
      cookManuallySet: false,
      recurring: { ruleId, overridden: false },
    });
    expect(dinner.dishes).toEqual([
      expect.objectContaining({ name: "Tacos", role: "main", recipe: expect.objectContaining({ id: tacos.id }) }),
      expect.objectContaining({ name: "Mexican rice", role: "side", recipe: null }),
    ]);
    // The past is left alone, and so is everything after the end date.
    expect((await getDinner(db(), LAST_TUESDAY)).status).toBe("unplanned");
    expect((await getDinner(db(), LATER_TUESDAY)).status).toBe("unplanned");
    // Reading again changes nothing.
    expect(await viewWeeks()).toEqual([]);
  });

  it("never fill a night that already has a dinner", async () => {
    const alex = await seedUser({ username: "alex" });
    await addManualDish(
      db(),
      alex,
      TUESDAY,
      { name: "Pizza", role: "main", ingredients: "", sourceUrl: "", readyInMinutes: "", notes: "", saveToLibrary: false },
      NOW,
    );
    await createRule(db(), alex, tacoNight());
    await viewWeeks();
    expect(await dishNames(TUESDAY)).toEqual(["Pizza"]);
    expect(await dishNames(NEXT_TUESDAY)).toEqual(["Tacos", "Mexican rice"]);
  });

  it("an edited instance is overridden and isn't refilled after clearing it", async () => {
    const alex = await seedUser({ username: "alex" });
    await createRule(db(), alex, tacoNight());
    await viewWeeks();
    for (const d of (await getDinner(db(), TUESDAY)).dishes) await removeDish(db(), alex, d.id, NOW);
    await viewWeeks();
    const dinner = await getDinner(db(), TUESDAY);
    expect(dinner.status).toBe("unplanned");
    expect(dinner.recurring?.overridden).toBe(true);
  });

  it("rule edits replace only future, non-overridden instances", async () => {
    const alex = await seedUser({ username: "alex" });
    const ruleId = await createRule(db(), alex, tacoNight());
    await viewWeeks();
    // A past instance from before today.
    const [past] = await db()
      .insert(dinners)
      .values({ date: LAST_TUESDAY, status: "planned", recurringRuleId: ruleId })
      .returning();
    await db().insert(dishes).values({ dinnerId: past.id, freeTextName: "Tacos", role: "main", position: 0 });
    // Next week's instance gets a hand-picked servings count.
    await updateDinnerDetails(db(), alex, NEXT_TUESDAY, { cookUserId: null, servingsOverride: 6 }, NOW);

    await updateRule(db(), alex, ruleId, tacoNight({ dishes: [{ role: "main", name: "Fish tacos" }] }), NOW);
    expect(await dishNames(LAST_TUESDAY)).toEqual(["Tacos"]);
    expect(await dishNames(TUESDAY)).toEqual(["Fish tacos"]);
    expect(await dishNames(NEXT_TUESDAY)).toEqual(["Tacos", "Mexican rice"]);
    expect(await dishNames(LATER_TUESDAY)).toEqual(["Fish tacos"]);
  });

  it("moving a rule to another weekday moves its future instances", async () => {
    const alex = await seedUser({ username: "alex" });
    const ruleId = await createRule(db(), alex, tacoNight());
    await viewWeeks();
    await updateRule(db(), alex, ruleId, tacoNight({ weekday: 3 }), NOW);
    expect((await getDinner(db(), TUESDAY)).status).toBe("unplanned");
    await viewWeeks();
    expect(await dishNames("2026-10-14")).toEqual(["Tacos", "Mexican rice"]);
  });

  it("deactivating removes future, non-overridden instances; overridden ones stay", async () => {
    const alex = await seedUser({ username: "alex" });
    const ruleId = await createRule(db(), alex, tacoNight());
    await viewWeeks();
    await updateDinnerDetails(db(), alex, NEXT_TUESDAY, { cookUserId: null, servingsOverride: 6 }, NOW);

    await setRuleActive(db(), alex, ruleId, false, NOW);
    await viewWeeks();
    expect((await getDinner(db(), TUESDAY)).status).toBe("unplanned");
    expect(await dishNames(NEXT_TUESDAY)).toEqual(["Tacos", "Mexican rice"]);
    expect((await getDinner(db(), LATER_TUESDAY)).status).toBe("unplanned");

    await setRuleActive(db(), alex, ruleId, true, NOW);
    await viewWeeks();
    expect(await dishNames(TUESDAY)).toEqual(["Tacos", "Mexican rice"]);
  });

  it("publish their nights when created or changed", async () => {
    const alex = await seedUser({ username: "alex" });
    const ruleId = await createRule(db(), alex, tacoNight({ endDate: TUESDAY }));
    const events: AppEvent[] = [];
    const unsubscribe = subscribe((e) => events.push(e));
    try {
      await viewWeeks();
      await setRuleActive(db(), alex, ruleId, false, NOW);
    } finally {
      unsubscribe();
    }
    const tuesday = { type: "dinner.updated", date: TUESDAY, weekStart: "2026-10-11" };
    expect(events).toEqual([tuesday, { type: "rules.updated" }, tuesday]);
  });
});

describe("createRuleFromDinner", () => {
  let alex: Awaited<ReturnType<typeof seedUser>>;
  beforeEach(async () => {
    alex = await seedUser({ username: "alex" });
  });

  const addDish = (date: string, name: string, role: "main" | "side", saveToLibrary = true) =>
    addManualDish(db(), alex, date, { name, role, ingredients: "", sourceUrl: "", readyInMinutes: "", notes: "", saveToLibrary }, NOW);

  it("repeats a night's dishes every week and links the night", async () => {
    await addDish(TUESDAY, "Tacos", "main");
    await addDish(TUESDAY, "Salsa", "side", false);
    const ruleId = await createRuleFromDinner(db(), alex, TUESDAY, NOW);

    const [rule] = await listRules(db());
    expect(rule).toMatchObject({ id: ruleId, weekday: TUE, startDate: TUESDAY, endDate: null });
    expect(rule.dishes).toEqual([
      { role: "main", name: "Tacos", recipeId: expect.any(String) },
      { role: "side", name: "Salsa", recipeId: null },
    ]);
    expect((await getDinner(db(), TUESDAY)).recurring).toEqual({ ruleId, overridden: false });
    await viewWeeks();
    expect(await dishNames(NEXT_TUESDAY)).toEqual(["Tacos", "Salsa"]);
    await expect(createRuleFromDinner(db(), alex, TUESDAY, NOW)).rejects.toThrow("already repeats");
  });

  it("a night with a hand-picked cook or servings starts out overridden", async () => {
    await addDish(TUESDAY, "Tacos", "main");
    await updateDinnerDetails(db(), alex, TUESDAY, { cookUserId: alex.id, servingsOverride: null }, NOW);
    await createRuleFromDinner(db(), alex, TUESDAY, NOW);
    expect((await getDinner(db(), TUESDAY)).recurring?.overridden).toBe(true);
  });

  it("needs a planned night", async () => {
    await expect(createRuleFromDinner(db(), alex, TUESDAY, NOW)).rejects.toThrow("Add a dish");
    expect(await db().select().from(recurringRules)).toEqual([]);
  });

  it("leaves a past night unlinked", async () => {
    await db().insert(dinners).values({ date: "2026-10-11", status: "planned" });
    const [d] = await db().select().from(dinners).where(eq(dinners.date, "2026-10-11"));
    await db().insert(dishes).values({ dinnerId: d.id, freeTextName: "Roast", role: "main", position: 0 });
    await createRuleFromDinner(db(), alex, "2026-10-11", NOW);
    expect((await getDinner(db(), "2026-10-11")).recurring).toBeNull();
    const week = await getDinners(db(), "2026-10-18", "2026-10-18");
    expect(week[0].status).toBe("unplanned"); // until a view reads it
  });
});
