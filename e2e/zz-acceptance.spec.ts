import { expect, test } from "@playwright/test";
import { addDays, addDish, dateIn, mondayOf, signInOk } from "./helpers";

// SPEC §12 acceptance: an adult plans a full week (suggested, manual,
// recurring and eat-out nights) on a phone in under 5 minutes, with cooks
// filled in automatically. The other §12 criteria are covered by
// planning.spec.ts (kids are read-only), realtime.spec.ts (two phones),
// grocery.spec.ts (swapping after shopping), suggest.spec.ts (quota
// exhausted) and settings-export.spec.ts (export).
//
// Runs last ("zz"): it saves a Spoonacular recipe to the library, adds a
// recurring rule and sets Alex as every night's default cook, which the
// earlier specs don't expect. Its week (~11 weeks out) is clear of theirs.
test.describe.configure({ mode: "serial" });

const WEEK = mondayOf(dateIn(77));
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

test("an adult plans a whole week on a phone in under 5 minutes, with cooks filled in", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await signInOk(page, "alex", "password123");
  const started = Date.now();

  // Alex is the default cook every night.
  await page.goto("/settings");
  for (const day of WEEKDAYS) await page.getByLabel(day).selectOption({ label: "Alex" });
  const scheduleForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save schedule" }) });
  await scheduleForm.getByRole("button", { name: "Save schedule" }).click();
  await expect(scheduleForm.getByRole("status")).toHaveText("Saved.");

  // Monday: a suggested main.
  await page.goto(`/day/${WEEK}`);
  await page.getByRole("link", { name: "Suggest recipes" }).click();
  await page.getByLabel("Protein").fill("chicken");
  await page.getByRole("button", { name: "30 min", exact: true }).click();
  await page.getByRole("button", { name: "Find mains" }).click();
  const choose = page.getByRole("region", { name: "Suggestions: chicken" }).getByRole("button", { name: /^Choose / }).first();
  const suggested = (await choose.getAttribute("aria-label"))!.replace(/^Choose /, "");
  await choose.click();
  await page.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Add to dinner" }).click();
  await expect(page).toHaveURL(new RegExp(`/day/${WEEK}$`));

  // Tuesday and Saturday: typed in.
  await page.goto(`/day/${addDays(WEEK, 1)}`);
  await addDish(page, "Pasta primavera");
  await page.goto(`/day/${addDays(WEEK, 5)}`);
  await addDish(page, "Burgers");
  await addDish(page, "Corn on the cob");

  // Wednesday: repeats every week.
  await page.goto(`/day/${addDays(WEEK, 2)}`);
  await addDish(page, "Fish tacos");
  await page.getByRole("button", { name: "Repeat every Wednesday" }).click();
  await expect(page.getByText("Repeats every Wednesday.")).toBeVisible();

  // Thursday out, Friday leftovers, Sunday from the library.
  await page.goto(`/day/${addDays(WEEK, 3)}`);
  await page.getByRole("button", { name: "Eat out" }).click();
  await expect(page.getByRole("heading", { name: "Eating out" })).toBeVisible();
  await page.goto(`/day/${addDays(WEEK, 4)}`);
  await page.getByRole("button", { name: "Leftovers" }).click();
  await expect(page.getByRole("heading", { name: "Leftovers" })).toBeVisible();
  await page.goto(`/day/${addDays(WEEK, 6)}/library`);
  await page.getByRole("button", { name: "Add Tacos", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/day/${addDays(WEEK, 6)}$`));

  expect(Date.now() - started).toBeLessThan(5 * 60_000);

  await page.goto(`/week?d=${WEEK}`);
  const days = page.getByRole("list", { name: "Days" }).locator("> li");
  await expect(days.nth(0)).toContainText(suggested);
  await expect(days.nth(1)).toContainText("Pasta primavera");
  await expect(days.nth(2)).toContainText("Fish tacos");
  await expect(days.nth(3)).toContainText("Eating out");
  await expect(days.nth(4)).toContainText("Leftovers");
  await expect(days.nth(5)).toContainText("Burgers");
  await expect(days.nth(6)).toContainText("Tacos");
  // Every planned night got its cook from the schedule; nights off have none.
  for (const i of [0, 1, 2, 5, 6]) await expect(days.nth(i)).toContainText("Alex");
  for (const i of [3, 4]) await expect(days.nth(i)).not.toContainText("Alex");
  await expect(page.getByText("No cook")).toHaveCount(0);

  // The recurring night carries into the next week, cook included.
  await page.goto(`/week?d=${addDays(WEEK, 7)}`);
  await expect(days.nth(2)).toContainText("Fish tacos");
  await expect(days.nth(2)).toContainText("Alex");

  // And the week's groceries are ready.
  await page.goto(`/grocery?d=${WEEK}`);
  await expect(page.getByRole("checkbox").first()).toBeVisible();
});
