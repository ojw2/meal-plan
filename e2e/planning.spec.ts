import { expect, test, type Page } from "@playwright/test";
import { signInOk, signOut } from "./helpers";

// Milestone 2 flows: day editor, cooks, eat out, week view, home, past-week lock.
// Runs after foundation.spec.ts, reusing its household: timezone New York,
// weeks start Monday, Alex is the default Tuesday cook.
test.describe.configure({ mode: "serial" });

const TZ = "America/New_York";

function dateIn(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** The next Tuesday strictly after today (always in a future, editable week or later today's week). */
function nextTuesday() {
  for (let i = 1; i <= 7; i++) {
    const date = dateIn(i);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 2) return date;
  }
  throw new Error("unreachable");
}

async function addDish(page: Page, name: string, opts: { role?: "Main" | "Side"; ingredients?: string; link?: string } = {}) {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add dish" }) });
  await form.getByLabel("Dish name").fill(name);
  if (opts.role) await form.getByLabel("Role").selectOption({ label: opts.role });
  if (opts.ingredients || opts.link) {
    await form.getByText("Ingredients and details").click();
    if (opts.ingredients) await form.getByLabel("Ingredients").fill(opts.ingredients);
    if (opts.link) await form.getByLabel("Recipe link").fill(opts.link);
  }
  await form.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByRole("list", { name: "Dishes" }).getByText(name, { exact: true })).toBeVisible();
  // Successful adds clear the form for the next dish.
  await expect(form.getByLabel("Dish name")).toHaveValue("");
}

const dishNames = (page: Page) =>
  page.getByRole("list", { name: "Dishes" }).getByTestId("dish-name");

test("adult plans tonight from the home screen", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  const tonight = page.getByRole("region", { name: "Tonight" });
  await expect(tonight).toContainText("Nothing planned yet.");
  await tonight.getByRole("link", { name: "Plan tonight" }).click();
  await expect(page).toHaveURL(new RegExp(`/day/${dateIn(0)}$`));

  await addDish(page, "Tacos", { ingredients: "1 lb ground beef\n8 tortillas", link: "https://example.com/tacos" });
  // The second dish defaults to a side.
  await addDish(page, "Mexican rice");
  await expect(page.getByRole("list", { name: "Dishes" })).toContainText("Side");

  await page.getByRole("button", { name: "Move Mexican rice up" }).click();
  await expect(dishNames(page)).toHaveText(["Mexican rice", "Tacos"]);
  await page.getByRole("button", { name: "Move Mexican rice down" }).click();
  await expect(dishNames(page)).toHaveText(["Tacos", "Mexican rice"]);

  const details = page.locator("form").filter({ has: page.getByLabel("Cook") });
  await details.getByLabel("Cook").selectOption({ label: "Alex" });
  await details.getByLabel("Servings").fill("6");
  await details.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Cook picked by hand.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use default cook" })).toBeVisible();

  await page.getByRole("link", { name: "Meal Plan" }).click();
  await expect(tonight.getByText("Tacos")).toBeVisible();
  await expect(tonight.getByText("Mexican rice")).toBeVisible();
  await expect(tonight).toContainText("Alex is cooking");
  await expect(tonight.getByRole("link", { name: "Recipe" })).toHaveAttribute("href", "https://example.com/tacos");
});

test("removing dishes and marking a night eat out", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  const date = dateIn(2);
  await page.goto(`/day/${date}`);
  await addDish(page, "Pasta");
  await addDish(page, "Salad", { role: "Side" });
  await page.getByRole("button", { name: "Remove Salad" }).click();
  await expect(dishNames(page)).toHaveText(["Pasta"]);

  await page.getByRole("button", { name: "Eat out" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("This removes the dish planned for this night.");
  await dialog.getByRole("button", { name: "Eat out" }).click();
  await expect(page.getByRole("heading", { name: "Eating out" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Dishes" })).toHaveCount(0);

  await page.getByRole("button", { name: "Plan a dinner instead" }).click();
  await expect(page.getByText("Nothing planned yet.")).toBeVisible();
  // Without dishes, leftovers needs no confirmation.
  await page.getByRole("button", { name: "Leftovers" }).click();
  await expect(page.getByRole("heading", { name: "Leftovers" })).toBeVisible();
});

test("new nights get the default cook for their weekday", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${nextTuesday()}`);
  await addDish(page, "Chili");
  await expect(page.getByLabel("Cook").locator("option:checked")).toHaveText("Alex");
  await expect(page.getByText("Cook comes from the default schedule.")).toBeVisible();
});

test("week view lists seven days and navigates between weeks", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.getByRole("link", { name: "Week", exact: true }).click();
  const days = page.getByRole("list", { name: "Days" }).locator("> li");
  await expect(days).toHaveCount(7);
  // Weeks start on Monday for this household.
  await expect(days.first()).toContainText("Mon");
  await expect(page.getByRole("link", { name: "Today" })).toHaveCount(0);

  const todayCard = days.filter({ hasText: "Today" });
  await expect(todayCard).toContainText("Tacos");
  await expect(todayCard).toContainText("Alex");

  await page.getByRole("link", { name: "Next week" }).click();
  await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
  await page.getByRole("link", { name: "Previous week" }).click();
  await page.getByRole("link", { name: "Previous week" }).click();
  await expect(page.getByText("This week is in the past, so it's read-only.")).toBeVisible();
  await page.getByRole("link", { name: "Today" }).click();
  await expect(days.filter({ hasText: "Today" })).toBeVisible();
});

test("past weeks are read-only until an adult unlocks them", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${dateIn(-7)}`);
  await expect(page.getByText("This week is in the past, so it's read-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add dish" })).toHaveCount(0);

  await page.getByRole("button", { name: "Unlock week" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("unlocked for editing until you sign out")).toBeVisible();
  await addDish(page, "Leftover soup");

  // The unlock lasts for this session only.
  await signOut(page);
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${dateIn(-7)}`);
  await expect(page.getByRole("button", { name: "Unlock week" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add dish" })).toHaveCount(0);
});

test("kids see tonight and the week but can't edit", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto("/settings/members");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add member" }) });
  await form.getByLabel("Name", { exact: true }).fill("Kai");
  await form.getByLabel("Username").fill("kai");
  await form.getByLabel("Role").selectOption("kid");
  await form.getByLabel("Password or PIN").fill("1357");
  await form.getByRole("button", { name: "Add member" }).click();
  await expect(form.getByRole("status")).toHaveText("Member added.");
  await signOut(page);

  await signInOk(page, "kai", "1357");
  const tonight = page.getByRole("region", { name: "Tonight" });
  await expect(tonight.getByText("Tacos")).toBeVisible();
  await expect(tonight).toContainText("Alex is cooking");
  await expect(tonight.getByRole("link", { name: /tonight/ })).toHaveCount(0);

  await page.goto(`/day/${dateIn(0)}`);
  await expect(dishNames(page)).toHaveText(["Tacos", "Mexican rice"]);
  await expect(page.getByText("Cook: Alex")).toBeVisible();
  await expect(page.getByRole("button")).toHaveText(["Sign out"]);

  await page.goto(`/day/${dateIn(-7)}`);
  await expect(page.getByText("This week is in the past, so it's read-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock week" })).toHaveCount(0);
});
