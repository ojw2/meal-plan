import { expect, test, type Page } from "@playwright/test";
import { signInOk, signOut } from "./helpers";

// Milestone 5: the grocery list. Runs after foundation.spec.ts (files run in
// name order), reusing its household: weeks start Monday.
// Everything here happens 12 weeks out, and dishes skip the library, so the
// specs that follow see the state they expect.
test.describe.configure({ mode: "serial" });

const TZ = "America/New_York";

function dateIn(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

const WEEK = mondayOf(dateIn(84));

/** Adds a typed-in dish with ingredients, kept out of the library. */
async function addDish(page: Page, date: string, name: string, ingredients: string) {
  await page.goto(`/day/${date}`);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add dish" }) });
  await form.getByLabel("Dish name").fill(name);
  await form.getByText("Ingredients and details").click();
  await form.getByLabel("Ingredients").fill(ingredients);
  await form.getByLabel("Save to library").uncheck();
  await form.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByRole("list", { name: "Dishes" }).getByText(name, { exact: true })).toBeVisible();
}

/** Waits until optimistic check-offs have reached the server. */
const settled = (page: Page) => expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

const item = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByRole("checkbox", { name, exact: true }) });

test("the week's dishes add up into a list grouped by aisle", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await addDish(page, addDays(WEEK, 1), "Beef tacos", "1 lb ground beef\n1 onion, diced\n1 tsp salt");
  await addDish(page, addDays(WEEK, 3), "French onion bake", "2 onions\n1 cup chopped onion\n8 oz cheddar");

  await page.goto(`/week?d=${WEEK}`);
  await page.getByRole("link", { name: "Grocery list" }).click();
  await expect(page.getByRole("heading", { name: "Grocery list" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/grocery\\?d=${WEEK}$`));

  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Cheese",
    "Meat",
    "Produce",
    "Spices and Seasonings",
    "Extra items",
  ]);
  // Counts and cups can't merge, so they're listed side by side.
  const onion = item(page, "Onion");
  await expect(onion).toContainText("Onion · 3 whole + 1 cup");
  await onion.getByText("2 dishes").click();
  await expect(onion.getByRole("list", { name: "Onion by dish" }).getByRole("listitem")).toHaveText([
    /Beef tacos \(\w+\): 1$/,
    /French onion bake \(\w+\): 2$/,
    /French onion bake \(\w+\): 1 cup$/,
  ]);
  await expect(item(page, "Ground beef")).toContainText("1 lb");
});

test("checked items resurface when more is needed and move aside when no longer needed", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto(`/grocery?d=${WEEK}`);
  await page.getByRole("checkbox", { name: "Onion", exact: true }).check();
  await page.getByRole("checkbox", { name: "Ground beef" }).check();
  await settled(page);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Onion", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Ground beef" })).toBeChecked();

  // Plan another night with an onion: it's needed again.
  await addDish(page, addDays(WEEK, 4), "Onion rings", "1 onion");
  await page.goto(`/grocery?d=${WEEK}`);
  await expect(page.getByRole("checkbox", { name: "Onion", exact: true })).not.toBeChecked();
  await expect(item(page, "Onion")).toContainText("+1 onion needed since you checked this");

  // Drop the tacos: the beef was bought but isn't needed any more.
  await page.goto(`/day/${addDays(WEEK, 1)}`);
  await page.getByRole("button", { name: "Remove Beef tacos" }).click();
  await expect(page.getByText("Nothing planned yet.")).toBeVisible();
  await page.goto(`/grocery?d=${WEEK}`);
  await expect(page.getByRole("checkbox", { name: "Ground beef" })).toHaveCount(0);
  // Salt wasn't checked, so it just disappears.
  await expect(page.getByRole("checkbox", { name: "Salt" })).toHaveCount(0);
  const gone = page.getByTestId("no-longer-needed");
  await expect(gone).toContainText("No longer needed (already bought) · 1");
  await gone.getByText("No longer needed").click();
  await expect(gone.getByRole("listitem")).toHaveText(["Ground beef: 1 lb"]);
  await gone.getByRole("button", { name: "Dismiss Ground beef: 1 lb" }).click();
  await expect(gone).toHaveCount(0);
});

test("adults add, check and delete extra items", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto(`/grocery?d=${WEEK}`);
  const extras = page.getByRole("list", { name: "Extra items" });
  await page.getByLabel("Add an item").fill("Paper towels");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(extras.getByRole("listitem")).toHaveText(["Paper towels"]);
  await expect(page.getByLabel("Add an item")).toHaveValue("");

  await extras.getByRole("checkbox", { name: "Paper towels" }).check();
  await settled(page);
  await page.reload();
  await expect(extras.getByRole("checkbox", { name: "Paper towels" })).toBeChecked();
  // Extra items belong to their week.
  await page.goto(`/grocery?d=${addDays(WEEK, 7)}`);
  await expect(page.getByText("Nothing to buy yet.")).toBeVisible();

  await page.goto(`/grocery?d=${WEEK}`);
  await page.getByLabel("Add an item").fill("Coffee");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(extras.getByRole("listitem")).toHaveText(["Paper towels", "Coffee"]);
  await page.getByRole("button", { name: "Delete Paper towels" }).click();
  await expect(extras.getByRole("listitem")).toHaveText(["Coffee"]);
});

test("kids can see the list but not change it", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto("/settings/members");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add member" }) });
  await form.getByLabel("Name", { exact: true }).fill("Gia");
  await form.getByLabel("Username").fill("gia");
  await form.getByLabel("Role").selectOption("kid");
  await form.getByLabel("Password or PIN").fill("8642");
  await form.getByRole("button", { name: "Add member" }).click();
  await expect(form.getByRole("status")).toHaveText("Member added.");
  await signOut(page);

  await signInOk(page, "gia", "8642");
  await page.goto(`/week?d=${WEEK}`);
  await page.getByRole("link", { name: "Grocery list" }).click();
  await expect(page.getByRole("checkbox", { name: "Onion", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Coffee" })).toBeDisabled();
  await expect(page.getByLabel("Add an item")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  await signOut(page);
});

test("settings warn before the week start day changes", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto("/settings");
  await expect(page.getByText("Grocery check-offs for this week may reset.")).toHaveCount(0);
  await page.getByLabel("Week starts on").selectOption({ label: "Sunday" });
  await expect(page.getByText(/Grocery check-offs for this week may reset\./)).toBeVisible();
  // Not saved: the other specs rely on Monday weeks.
  await page.getByLabel("Week starts on").selectOption({ label: "Monday" });
  await expect(page.getByText(/Grocery check-offs for this week may reset\./)).toHaveCount(0);
});
