import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/errors";
import { subscribe, type AppEvent } from "@/lib/events";
import { copyLastWeek } from "@/lib/services/copy-week";
import { setCookSchedule } from "@/lib/services/household";
import { addManualDish, getDinner, getWeek, setDinnerStatus, updateDinnerDetails } from "@/lib/services/planner";
import { createRule } from "@/lib/services/recurring";
import { db, resetDb, seedDinner, seedHousehold, seedUser } from "./helpers/db";

// Monday 2026-10-12, noon in New York; weeks start on Sunday. This week is
// Oct 11–17; next week is Oct 18–24.
const NOW = new Date("2026-10-12T16:00:00Z");
const NEXT_WEEK = "2026-10-18";

const manual = (name: string) => ({
  name,
  role: "main" as const,
  ingredients: "",
  sourceUrl: "",
  readyInMinutes: "",
  notes: "",
  saveToLibrary: false,
});

const summary = async (weekStart: string) =>
  (await getWeek(db(), weekStart)).map((d) => (d.status === "planned" ? d.dishes.map((x) => x.name).join("+") : d.status));

beforeEach(async () => {
  await resetDb();
  await seedHousehold("America/New_York");
});

describe("copyLastWeek", () => {
  it("kids can't copy", async () => {
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(copyLastWeek(db(), kid, NEXT_WEEK, NOW)).rejects.toThrow(ForbiddenError);
  });

  it("copies dishes and night statuses into empty nights, with today's default cooks", async () => {
    const alex = await seedUser({ username: "alex" });
    const bo = await seedUser({ username: "bo" });
    // This week: Sun eat out, Mon tacos + side (cook picked by hand), Wed leftovers.
    await setDinnerStatus(db(), alex, "2026-10-11", "eat_out", NOW);
    await addManualDish(db(), alex, "2026-10-12", { ...manual("Tacos"), saveToLibrary: true }, NOW);
    await addManualDish(db(), alex, "2026-10-12", { ...manual("Salsa"), role: "side" }, NOW);
    await updateDinnerDetails(db(), alex, "2026-10-12", { cookUserId: alex.id, servingsOverride: 6 }, NOW);
    await setDinnerStatus(db(), alex, "2026-10-14", "leftovers", NOW);
    // Next week: Monday's default cook is Bo now, and Wednesday is already planned.
    await setCookSchedule(db(), alex, { 1: bo.id }, NOW);
    await addManualDish(db(), alex, "2026-10-21", manual("Pizza"), NOW);

    expect(await copyLastWeek(db(), alex, "2026-10-20", NOW)).toEqual({ filled: 2, skipped: 1, past: 0 });
    expect(await summary(NEXT_WEEK)).toEqual([
      "eat_out",
      "Tacos+Salsa",
      "unplanned",
      "Pizza",
      "unplanned",
      "unplanned",
      "unplanned",
    ]);
    const monday = await getDinner(db(), "2026-10-19");
    expect(monday).toMatchObject({ cook: { id: bo.id }, cookManuallySet: false, servingsOverride: null, recurring: null });
    // The copied main still points at the library recipe.
    const copied = await getDinner(db(), "2026-10-12");
    expect(monday.dishes[0].recipe?.id).toBe(copied.dishes[0].recipe?.id);
    expect(monday.dishes[1].recipe).toBeNull();

    // Running it again fills nothing.
    expect(await copyLastWeek(db(), alex, NEXT_WEEK, NOW)).toEqual({ filled: 0, skipped: 3, past: 0 });
  });

  it("skips nights before today (but not tonight) and fills a cleared night", async () => {
    const alex = await seedUser({ username: "alex" });
    for (const date of ["2026-10-04", "2026-10-05", "2026-10-06"]) await seedDinner(date, null);
    // Tuesday was planned, then cleared back to unplanned: still empty.
    await addManualDish(db(), alex, "2026-10-13", manual("Soup"), NOW);
    await setDinnerStatus(db(), alex, "2026-10-13", "unplanned", NOW);

    expect(await copyLastWeek(db(), alex, "2026-10-11", NOW)).toEqual({ filled: 2, skipped: 0, past: 1 });
    expect(await summary("2026-10-11")).toEqual([
      "unplanned",
      "Dinner 2026-10-05",
      "Dinner 2026-10-06",
      "unplanned",
      "unplanned",
      "unplanned",
      "unplanned",
    ]);
  });

  it("recurring meals take precedence", async () => {
    const alex = await seedUser({ username: "alex" });
    await addManualDish(db(), alex, "2026-10-13", manual("Soup"), NOW);
    await createRule(db(), alex, {
      weekday: 2,
      startDate: "2026-10-01",
      endDate: "",
      dishes: [{ role: "main", name: "Tacos" }],
    });
    expect(await copyLastWeek(db(), alex, NEXT_WEEK, NOW)).toEqual({ filled: 0, skipped: 1, past: 0 });
    expect((await summary(NEXT_WEEK))[2]).toBe("Tacos");
  });

  it("publishes every night it fills", async () => {
    const alex = await seedUser({ username: "alex" });
    await setDinnerStatus(db(), alex, "2026-10-15", "eat_out", NOW);
    const events: AppEvent[] = [];
    const unsubscribe = subscribe((e) => events.push(e));
    try {
      await copyLastWeek(db(), alex, NEXT_WEEK, NOW);
    } finally {
      unsubscribe();
    }
    expect(events).toEqual([{ type: "dinner.updated", date: "2026-10-22", weekStart: NEXT_WEEK }]);
  });
});
