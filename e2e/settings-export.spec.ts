import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInOk } from "./helpers";

// Milestone 6: Export all data (SPEC §4.10, §12). Runs after planning.spec.ts,
// reusing its household: "Testers HQ", with Alex, kid Kai, and Tacos tonight.

test("an adult downloads all the household's data as JSON", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto("/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export all data" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^meal-plan-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await readFile(await download.path(), "utf8");
  const data = JSON.parse(text);

  expect(data).toMatchObject({ format: "meal-plan-export", version: 1, household: { name: "Testers HQ" } });
  expect(Object.keys(data)).toEqual(
    expect.arrayContaining(["cookSchedule", "users", "recipes", "dinners", "recurringRules", "grocery"]),
  );
  expect(data.users.map((u: { username: string }) => u.username)).toEqual(expect.arrayContaining(["alex", "kai"]));
  expect(data.recipes.map((r: { title: string }) => r.title)).toContain("Tacos");
  expect(data.dinners.flatMap((d: { dishes: unknown[] }) => d.dishes).length).toBeGreaterThan(0);
  expect(data.grocery).toMatchObject({ checks: expect.any(Array), manualItems: expect.any(Array) });
  // No credentials, ever.
  expect(text).not.toMatch(/hash|argon2/i);
});

test("kids can't export", async ({ page }) => {
  await signInOk(page, "kai", "1357");
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/$/);
  const res = await page.request.get("/api/export");
  expect(res.status()).toBe(403);
});
