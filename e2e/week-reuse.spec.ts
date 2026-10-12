import { expect, test, type Page } from "@playwright/test";
import { signInOk, signOut } from "./helpers";

// Milestone 4: library, From library, recurring meals, copy last week. Runs
// after suggest.spec.ts (files run in name order), reusing its household:
// weeks start Monday; tonight is Tacos + Mexican rice; "Leftover soup" was
// made a week ago. Dates here are 28+ days out, clear of the other specs.
test.describe.configure({ mode: "serial" });

const TZ = "America/New_York";

function dateIn(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

const weekdayName = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before `date` (the household's weeks start Monday). */
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

const recipes = (page: Page) => page.getByRole("list", { name: "Recipes" });
const dishNames = (page: Page) => page.getByRole("list", { name: "Dishes" }).getByTestId("dish-name");

async function addDish(page: Page, name: string) {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add dish" }) });
  await form.getByLabel("Dish name").fill(name);
  await form.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByRole("list", { name: "Dishes" }).getByText(name, { exact: true })).toBeVisible();
}

test("the library shows history, favorites and archived recipes", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

  const soup = recipes(page).getByRole("listitem").filter({ hasText: "Leftover soup" });
  await expect(soup).toContainText("Last made 7 days ago");
  await expect(soup).toContainText("made once");
  // Tonight's tacos haven't been eaten yet.
  await expect(recipes(page).getByRole("listitem").filter({ hasText: /^Tacos/ })).toContainText("Not made yet");

  await page.getByLabel("Search recipes").fill("soup");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=soup/);
  await expect(recipes(page).getByRole("listitem")).toHaveCount(1);

  // Favorite Tacos, then filter to favorites.
  await page.goto("/library");
  await page.getByRole("button", { name: "Add Tacos to favorites" }).click();
  await expect(page.getByRole("button", { name: "Remove Tacos from favorites" })).toBeVisible();
  await page.getByLabel("Show").selectOption({ label: "Favorites" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(recipes(page).getByRole("link")).toHaveText(["Tacos"]);

  // Archive Leftover soup from its page; it leaves the library but keeps its history.
  await page.goto("/library?q=soup");
  await recipes(page).getByRole("link", { name: "Leftover soup" }).click();
  await expect(page.getByRole("heading", { name: "Leftover soup" })).toBeVisible();
  await expect(page.getByTestId("history")).toHaveText("Last made 7 days ago · made once");
  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();

  await page.goto("/library?q=soup");
  await expect(page.getByText("No recipes match.")).toBeVisible();
  // The past dinner still shows it.
  await page.goto(`/day/${dateIn(-7)}`);
  await expect(dishNames(page)).toContainText(["Leftover soup"]);

  await page.goto("/library?q=soup&show=archived");
  await expect(page.getByRole("heading", { name: "Archived recipes" })).toBeVisible();
  await recipes(page).getByRole("link", { name: "Leftover soup" }).click();
  await page.getByRole("button", { name: "Restore to library" }).click();
  await expect(page.getByText("Archived", { exact: true })).toHaveCount(0);
  await page.goto("/library?q=soup");
  await expect(recipes(page).getByRole("link")).toHaveText(["Leftover soup"]);
});

test("adding dishes from the library, favorites first", async ({ page }) => {
  const date = dateIn(28);
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${date}`);
  await page.getByRole("link", { name: "From library" }).click();
  await expect(page).toHaveURL(new RegExp(`/day/${date}/library$`));
  await expect(recipes(page).getByRole("listitem").first()).toContainText("Tacos");

  await page.getByRole("button", { name: "Add Tacos" }).click();
  await expect(page).toHaveURL(new RegExp(`/day/${date}$`));
  await expect(dishNames(page)).toHaveText(["Tacos"]);

  await page.getByRole("link", { name: "From library" }).click();
  await page.getByLabel("Search recipes").fill("rice");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Add Mexican rice" }).click();
  await expect(dishNames(page)).toHaveText(["Tacos", "Mexican rice"]);
  await expect(page.getByRole("list", { name: "Dishes" }).getByText("Side")).toBeVisible();

  // Dish names link to their recipe.
  await page.getByRole("link", { name: "Tacos" }).click();
  await expect(page.getByRole("heading", { name: "Tacos" })).toBeVisible();
});

test("a night repeats weekly; the rule can be edited and stopped", async ({ page }) => {
  const date = dateIn(28);
  const nextWeek = addDays(date, 7);
  const weekday = weekdayName(date);
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${date}`);
  await page.getByRole("button", { name: `Repeat every ${weekday}` }).click();
  await expect(page.getByText(`Repeats every ${weekday}.`)).toBeVisible();

  // Opening a later week fills it in.
  await page.goto(`/day/${nextWeek}`);
  await expect(dishNames(page)).toHaveText(["Tacos", "Mexican rice"]);
  await expect(page.getByText(`Repeats every ${weekday}.`)).toBeVisible();

  await page.getByRole("link", { name: "Manage recurring meals" }).click();
  const rule = page.getByRole("region", { name: `Every ${weekday}` });
  await expect(rule).toContainText("Tacos + Mexican rice");
  await rule.getByText("Edit").click();
  await rule.getByLabel("Dish 2", { exact: true }).fill("Garlic bread");
  await rule.getByRole("button", { name: "Save" }).click();
  await expect(rule).toContainText("Tacos + Garlic bread");

  await page.goto(`/day/${nextWeek}`);
  await expect(dishNames(page)).toHaveText(["Tacos", "Garlic bread"]);

  await page.goto("/settings/recurring");
  await rule.getByRole("button", { name: "Stop repeating" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Stop repeating" }).click();
  await expect(rule.getByText("Stopped")).toBeVisible();
  await page.goto(`/day/${nextWeek}`);
  await expect(page.getByText("Nothing planned yet.")).toBeVisible();
});

test("a recurring meal can be set up from settings", async ({ page }) => {
  const date = dateIn(42);
  await signInOk(page, "alex", "password123");
  await page.goto("/settings");
  await page.getByRole("link", { name: "Recurring meals" }).click();

  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add recurring meal" }) });
  await form.getByLabel("Weekday").selectOption({ label: weekdayName(date) });
  await form.getByLabel("Starts").fill(date);
  await form.getByLabel("Ends (optional)").fill(date);
  await form.getByLabel("Dish 1", { exact: true }).fill("Homemade pizza");
  await form.getByRole("button", { name: "Add recurring meal" }).click();
  await expect(form.getByRole("status")).toHaveText("Recurring meal added.");

  await page.goto(`/week?d=${date}`);
  const day = page.getByRole("list", { name: "Days" }).locator("> li").nth((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7);
  await expect(day).toContainText("Homemade pizza");
});

test("copy last week fills only empty nights", async ({ page }) => {
  const source = mondayOf(dateIn(49));
  const target = addDays(source, 7);
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${source}`);
  await addDish(page, "Stir fry");
  await page.goto(`/day/${addDays(source, 1)}`);
  await page.getByRole("button", { name: "Eat out" }).click();
  await expect(page.getByRole("heading", { name: "Eating out" })).toBeVisible();
  await page.goto(`/day/${addDays(source, 2)}`);
  await addDish(page, "Lasagna");
  // The target Wednesday is already planned, so it's skipped.
  await page.goto(`/day/${addDays(target, 2)}`);
  await addDish(page, "Curry");

  await page.goto(`/week?d=${target}`);
  await page.getByRole("button", { name: "Copy last week" }).click();
  await expect(page.getByText("Filled 2 nights; skipped 1 already planned.")).toBeVisible();
  const days = page.getByRole("list", { name: "Days" }).locator("> li");
  await expect(days.nth(0)).toContainText("Stir fry");
  await expect(days.nth(1)).toContainText("Eating out");
  await expect(days.nth(2)).toContainText("Curry");
  await expect(days.nth(2)).not.toContainText("Lasagna");
});

test("kids can browse the library but not change or reuse anything", async ({ page }) => {
  await signInOk(page, "kai", "1357");
  await page.getByRole("link", { name: "Library" }).click();
  await expect(recipes(page).getByRole("link", { name: "Tacos" })).toBeVisible();
  await expect(recipes(page).getByRole("img", { name: "Favorite" })).toBeVisible();
  await expect(page.getByRole("button", { name: /favorites/ })).toHaveCount(0);

  await recipes(page).getByRole("link", { name: "Tacos" }).click();
  await expect(page.getByRole("heading", { name: "Tacos" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);

  const date = dateIn(28);
  await page.goto(`/day/${date}/library`);
  await expect(page).toHaveURL(new RegExp(`/day/${date}$`));
  await expect(page.getByRole("button", { name: /Repeat every/ })).toHaveCount(0);

  await page.goto(`/week?d=${date}`);
  await expect(page.getByRole("button", { name: "Copy last week" })).toHaveCount(0);
  await page.goto("/settings/recurring");
  await expect(page).toHaveURL(/\/$/);
  await signOut(page);
});
