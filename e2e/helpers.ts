import { devices, expect, test, type Browser, type Page } from "@playwright/test";

export async function signIn(page: Page, username: string, secret: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password or PIN").fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Signs in and waits until the home page has loaded. */
export async function signInOk(page: Page, username: string, secret: string) {
  await signIn(page, username, secret);
  await expect(page.getByRole("heading", { name: /^Hi, / })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

// The household's timezone and week start (set up by foundation.spec.ts).
const TZ = "America/New_York";

/** The household's local date `days` from now. */
export function dateIn(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before `date` (the household's weeks start Monday). */
export const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Another phone: a separate browser context with its own session. */
export async function secondPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: test.info().project.use.baseURL });
  return context.newPage();
}

/** Waits until the page's real-time connection is open (see `LiveSync`). */
export async function live(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-live", "open");
}

/** Adds a typed-in dish to the open day editor, kept out of the library so other specs don't see it. */
export async function addDish(page: Page, name: string, ingredients?: string) {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add dish" }) });
  await form.getByLabel("Dish name").fill(name);
  await form.getByText("Ingredients and details").click();
  if (ingredients) await form.getByLabel("Ingredients").fill(ingredients);
  await form.getByLabel("Save to library").uncheck();
  await form.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByRole("list", { name: "Dishes" }).getByText(name, { exact: true })).toBeVisible();
}
