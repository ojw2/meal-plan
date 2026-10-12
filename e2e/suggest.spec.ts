import { expect, test, type Page } from "@playwright/test";
import { signInOk, signOut } from "./helpers";

// Milestone 3: the suggest flow, against the fixture corpus (SPOONACULAR_LIVE
// unset). Runs after planning.spec.ts, reusing its household: weeks start
// Monday, Alex cooks Tuesdays, and "Tacos" (1 lb ground beef) is in the library.
test.describe.configure({ mode: "serial" });

const TZ = "America/New_York";

function dateIn(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** A Tuesday 15–21 days out, clear of the dates other specs use. */
function laterTuesday() {
  for (let i = 15; i <= 21; i++) {
    const date = dateIn(i);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 2) return date;
  }
  throw new Error("unreachable");
}

async function startSearch(
  page: Page,
  protein: string,
  opts: { time?: string; extras?: string[]; side?: string; sideExtras?: string[] } = {},
) {
  await page.getByLabel("Protein").fill(protein);
  await addExtras(page, "Main", opts.extras);
  if (opts.side) await page.getByLabel("Side ingredient", { exact: true }).fill(opts.side);
  await addExtras(page, "Side (optional)", opts.sideExtras);
  if (opts.time) await page.getByRole("button", { name: opts.time, exact: true }).click();
  await page.getByRole("button", { name: "Find mains" }).click();
}

/** Types each extra ingredient into the Main or Side fieldset's chip input. */
async function addExtras(page: Page, fieldset: string, extras: string[] = []) {
  const group = page.getByRole("group", { name: fieldset });
  for (const extra of extras) {
    await group.getByLabel(/with \(up to 3/).fill(extra);
    await group.getByRole("button", { name: "Add", exact: true }).click();
  }
}

const suggestions = (page: Page, ingredient: string) => page.getByRole("region", { name: `Suggestions: ${ingredient}` });
const dishNames = (page: Page) => page.getByRole("list", { name: "Dishes" }).getByTestId("dish-name");

test("adult picks a suggested main and side and saves their own copy", async ({ page }) => {
  const date = laterTuesday();
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${date}`);
  await page.getByRole("link", { name: "Suggest recipes" }).click();
  await expect(page).toHaveURL(new RegExp(`/day/${date}/suggest$`));

  await startSearch(page, "chicken", { time: "30 min", side: "broccoli" });
  const mains = suggestions(page, "chicken");
  await expect(mains.getByRole("button", { name: /^Choose / })).toHaveCount(3);
  await expect(mains.getByText("Within 30 min")).toHaveCount(3);

  await page.getByRole("button", { name: "Show 3 more" }).click();
  await expect(mains.getByRole("button", { name: /^Choose / })).toHaveCount(6);
  // The sixth needed a looser time budget, and says so.
  await expect(mains.getByText("45 min (over your 30 min)")).toBeVisible();

  await page.getByRole("button", { name: "Choose Chicken Fajitas" }).click();
  await expect(page.getByRole("button", { name: "Choose Chicken Fajitas" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next: side" }).click();

  await expect(page.getByRole("heading", { name: "Pick a side" })).toBeVisible();
  const review = page.getByRole("button", { name: "Review" });
  await expect(review).toBeDisabled();
  await page.getByRole("button", { name: "Choose Roasted Broccoli" }).click();
  await review.click();

  // New Spoonacular picks are prefilled for the adult to confirm or edit.
  const ingredients = page.getByLabel("Ingredients").first();
  await expect(ingredients).toHaveValue(/1\.5 lb chicken breast, sliced/);
  await ingredients.fill("1.5 lb chicken breast\n2 bell peppers\n8 flour tortillas");
  await page.getByLabel("Servings").first().fill("6");
  await page.getByRole("button", { name: "Add to dinner" }).click();

  await expect(page).toHaveURL(new RegExp(`/day/${date}$`));
  await expect(dishNames(page)).toHaveText(["Chicken Fajitas", "Roasted Broccoli"]);
  await expect(page.getByRole("link", { name: "Recipe" }).first()).toHaveAttribute(
    "href",
    "https://example.com/recipes/chicken-fajitas",
  );
  // The night got Tuesday's default cook.
  await expect(page.getByLabel("Cook").locator("option:checked")).toHaveText("Alex");
});

test("relaxed results are labeled, and an empty search says so", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${dateIn(22)}/suggest`);
  await startSearch(page, "tofu", { time: "30 min" });
  const mains = suggestions(page, "tofu");
  await expect(mains.getByRole("button", { name: /^Choose / })).toHaveCount(3);
  await expect(mains.getByText("40 min (over your 30 min)")).toBeVisible();
  await expect(mains.getByText("Similar to ‘tofu’")).toBeVisible();

  await page.getByRole("button", { name: "Change search" }).click();
  await startSearch(page, "ostrich");
  await expect(page.getByText("No matches for ostrich. Try a different protein or add it manually.")).toBeVisible();
});

test("library recipes come first and can be picked", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${dateIn(23)}/suggest`);
  // Chicken Fajitas was saved to the library by the first test.
  await startSearch(page, "chicken", { time: "30 min" });
  const library = page.getByRole("region", { name: "From your recipes: chicken" });
  await expect(library.getByRole("button", { name: "Choose Chicken Fajitas" })).toBeVisible();
  await expect(suggestions(page, "chicken").getByText("Chicken Fajitas")).toHaveCount(0);

  await page.getByRole("button", { name: "Change search" }).click();
  // "Tacos" lists 1 lb ground beef as an ingredient.
  await startSearch(page, "beef");
  await page
    .getByRole("region", { name: "From your recipes: beef" })
    .getByRole("button", { name: "Choose Tacos" })
    .click();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("Main · From your library")).toBeVisible();
  await expect(page.getByLabel("Ingredients")).toHaveCount(0);
  await page.getByRole("button", { name: "Add to dinner" }).click();
  await expect(dishNames(page)).toHaveText(["Tacos"]);
});

test("main and side each search with extra ingredients, dropping them only when needed", async ({ page }) => {
  const date = dateIn(26);
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${date}/suggest`);
  await startSearch(page, "chicken", {
    time: "30 min",
    extras: ["lemon", "garlic"],
    side: "broccoli",
    sideExtras: ["garlic"],
  });
  await expect(page.getByText("chicken + lemon, garlic · 30 min · broccoli + garlic")).toBeVisible();

  // Only one chicken main uses both; the rest are labeled with what they lack.
  const mains = suggestions(page, "chicken");
  await expect(mains.getByRole("button", { name: /^Choose / })).toHaveCount(3);
  await expect(mains.getByRole("button", { name: /^Choose / }).first()).toHaveAccessibleName(
    "Choose Lemon Garlic Chicken Thighs",
  );
  await expect(mains.getByText("Without lemon, garlic")).toHaveCount(2);
  await page.getByRole("button", { name: "Choose Lemon Garlic Chicken Thighs" }).click();
  await page.getByRole("button", { name: "Next: side" }).click();

  // One side row, garlic first.
  const sides = suggestions(page, "broccoli");
  await expect(sides.getByRole("button", { name: /^Choose / }).first()).toHaveAccessibleName(
    "Choose Garlic Parmesan Broccoli",
  );
  await expect(sides.getByText("Without garlic").first()).toBeVisible();
  await page.getByRole("button", { name: "Choose Garlic Parmesan Broccoli" }).click();
  await page.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Add to dinner" }).click();

  await expect(page).toHaveURL(new RegExp(`/day/${date}$`));
  await expect(dishNames(page)).toHaveText(["Lemon Garlic Chicken Thighs", "Garlic Parmesan Broccoli"]);
});

test("a Spoonacular outage offers a retry", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${dateIn(24)}/suggest`);
  await startSearch(page, "spoonacular-down");
  // (Next's route announcer is also role="alert".)
  const alert = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Retry" }) });
  await expect(alert).toContainText("Spoonacular isn't responding.");
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(alert).toContainText("Spoonacular isn't responding.");
  // Manual entry is still a click away.
  await page.getByRole("main").locator(`a[href="/day/${dateIn(24)}"]`).click();
  await expect(page.getByRole("button", { name: "Add dish" })).toBeVisible();
});

test("kids can't open the suggest flow or call the API", async ({ page }) => {
  const date = laterTuesday();
  // (Sam is locked out by foundation.spec; Kai comes from planning.spec.)
  await signInOk(page, "kai", "1357");
  await page.goto(`/day/${date}/suggest`);
  await expect(page).toHaveURL(new RegExp(`/day/${date}$`));
  await expect(page.getByRole("link", { name: "Suggest recipes" })).toHaveCount(0);

  const origin = new URL(page.url()).origin;
  const res = await page.request.post("/api/suggest", {
    headers: { origin },
    data: { role: "main", ingredient: "chicken", maxTime: 30 },
  });
  expect(res.status()).toBe(403);
  await signOut(page);
});

test("the API refuses cross-origin requests", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  const res = await page.request.post("/api/suggest", {
    headers: { origin: "https://evil.example" },
    data: { role: "main", ingredient: "chicken", maxTime: 30 },
  });
  expect(res.status()).toBe(403);
});

// Keep last: the 402 marks today's quota as used up for the rest of the run.
test("an exhausted quota falls back to library matches", async ({ page }) => {
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${dateIn(25)}/suggest`);
  await startSearch(page, "quota-exhausted");
  await expect(page.getByText(/daily limit is used up/)).toBeVisible();

  // Uncached (cached pages are still served when the quota is out). Tacos
  // lists "1 lb ground beef".
  await page.getByRole("button", { name: "Change search" }).click();
  await startSearch(page, "ground beef");
  await expect(page.getByText(/daily limit is used up/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "From your recipes: ground beef" }).getByRole("button", { name: "Choose Tacos" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByTestId("quota")).toContainText("0 left");
});
