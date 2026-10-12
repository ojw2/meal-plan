import { expect, test } from "@playwright/test";
import { signIn, signInOk, signOut } from "./helpers";

// Milestone 1 flows: first-run setup, settings, members, roles, sign-in limits.
// Serial: each test builds on the household created by the first.
test.describe.configure({ mode: "serial" });

test("first visit goes through household setup", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel("Household name").fill("The Testers");
  await page.getByLabel("Timezone").selectOption("America/New_York");
  await page.getByLabel("Your name").fill("Alex");
  await page.getByLabel("Username").fill("alex");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create household" }).click();

  await expect(page.getByRole("heading", { name: "Hi, Alex" })).toBeVisible();
  // Setup is one-time.
  await page.goto("/setup");
  await expect(page).not.toHaveURL(/\/setup$/);
});

test("adult edits household settings and the default cook schedule", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.getByRole("link", { name: "Settings" }).click();

  await page.getByLabel("Household name").fill("Testers HQ");
  await page.getByLabel("Week starts on").selectOption({ label: "Monday" });
  await page.getByLabel("Default servings").fill("5");
  const householdForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save household" }) });
  await householdForm.getByRole("button", { name: "Save household" }).click();
  await expect(householdForm.getByRole("status")).toHaveText("Saved.");

  await page.getByLabel("Tuesday").selectOption({ label: "Alex" });
  const scheduleForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save schedule" }) });
  await scheduleForm.getByRole("button", { name: "Save schedule" }).click();
  await expect(scheduleForm.getByRole("status")).toHaveText("Saved.");

  await page.reload();
  await expect(page.getByLabel("Household name")).toHaveValue("Testers HQ");
  await expect(page.getByLabel("Default servings")).toHaveValue("5");
  await expect(page.getByLabel("Tuesday").locator("option:checked")).toHaveText("Alex");
  // Week order follows the configured start day.
  const firstDay = page.locator("select[name^='day-']").first();
  await expect(firstDay).toHaveAttribute("name", "day-1");
});

test("adult adds a kid and another adult", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto("/settings/members");

  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add member" }) });
  await form.getByLabel("Name", { exact: true }).fill("Sam");
  await form.getByLabel("Username").fill("sam");
  await form.getByLabel("Role").selectOption("kid");
  await form.getByLabel("Password or PIN").fill("12");
  await form.getByRole("button", { name: "Add member" }).click();
  await expect(form.getByRole("alert")).toHaveText("PIN must be 4–6 digits");
  // A failed submit keeps what was typed.
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Sam");

  await form.getByLabel("Password or PIN").fill("2468");
  await form.getByRole("button", { name: "Add member" }).click();
  await expect(form.getByRole("status")).toHaveText("Member added.");
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("");

  await form.getByLabel("Name", { exact: true }).fill("Bo");
  await form.getByLabel("Username").fill("bo");
  await form.getByLabel("Role").selectOption("adult");
  await form.getByLabel("Password or PIN").fill("bopassword");
  await form.getByRole("button", { name: "Add member" }).click();

  const active = page.getByRole("list", { name: "Active members" });
  await expect(active.getByRole("listitem").filter({ hasText: "@sam" })).toContainText("Kid");
  await expect(active.getByRole("listitem").filter({ hasText: "@bo" })).toContainText("Adult");
});

test("kid can sign in with a PIN but can't reach settings", async ({ page }) => {
  await signInOk(page, "sam", "2468");
  await expect(page.getByRole("heading", { name: "Hi, Sam" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/settings/members");
  await expect(page).toHaveURL(/\/$/);
  await signOut(page);
});

test("wrong credentials are rejected and repeated failures lock the username", async ({ page }) => {
  await signIn(page, "alex", "wrong-password");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Wrong username, password, or PIN.");

  for (let i = 0; i < 5; i++) await signIn(page, "sam", "0000");
  await signIn(page, "sam", "2468");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Too many attempts");
});

test("removing members: the last adult can't be removed", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto("/settings/members");
  const active = page.getByRole("list", { name: "Active members" });

  const bo = active.getByRole("listitem").filter({ hasText: "@bo" });
  await bo.getByText("Edit").click();
  await bo.getByRole("button", { name: "Remove member" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();

  const removed = page.getByRole("list", { name: "Removed members" });
  await expect(removed.getByRole("listitem").filter({ hasText: "@bo" })).toBeVisible();

  const alex = active.getByRole("listitem").filter({ hasText: "@alex" });
  await alex.getByText("Edit").click();
  await alex.getByRole("button", { name: "Remove member" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(alex.getByRole("alert")).toHaveText("The household needs at least one active adult.");
});

test("removed members can't sign in", async ({ page }) => {
  await signIn(page, "bo", "bopassword");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Wrong username, password, or PIN.");
});
