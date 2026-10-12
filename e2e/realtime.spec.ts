import { expect, test } from "@playwright/test";
import { addDays, addDish, dateIn, live, mondayOf, secondPhone, signInOk } from "./helpers";

// Milestone 6: real-time sync (SPEC §5). Two phones are two browser
// contexts, each with its own session. Runs after planning.spec.ts (Kai is
// a kid). Dates are ~10 weeks out, clear of the other specs, and dishes stay
// out of the library.
test.describe.configure({ mode: "serial" });

const WEEK = mondayOf(dateIn(70));
/** SPEC §12: a check on one phone appears on the other within 2 s. */
const SYNC = { timeout: 2000 };

test("grocery check-offs and extra items show up on the other phone within 2 s", async ({ page, browser }) => {
  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${addDays(WEEK, 1)}`);
  await addDish(page, "Lemon chicken", "2 onions\n1 lb chicken thighs");

  const other = await secondPhone(browser);
  await signInOk(other, "alex", "password123");
  await other.goto(`/grocery?d=${WEEK}`);
  await page.goto(`/grocery?d=${WEEK}`);
  await live(other);
  await live(page);

  const onion = (p: typeof page) => p.getByRole("checkbox", { name: "Onion", exact: true });
  await onion(page).check();
  await expect(onion(other)).toBeChecked(SYNC);
  await onion(other).uncheck();
  await expect(onion(page)).not.toBeChecked(SYNC);

  await other.getByLabel("Add an item").fill("Coffee filters");
  await other.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("checkbox", { name: "Coffee filters" })).toBeVisible(SYNC);

  await other.context().close();
});

test("plan changes appear on other screens, including a kid's", async ({ page, browser }) => {
  const date = addDays(WEEK, 2);
  const kid = await secondPhone(browser);
  await signInOk(kid, "kai", "1357");
  await kid.goto(`/week?d=${WEEK}`);
  await live(kid);

  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${date}`);
  await addDish(page, "Shakshuka");
  const days = kid.getByRole("list", { name: "Days" }).locator("> li");
  await expect(days.nth(2)).toContainText("Shakshuka", SYNC);

  // The grocery list follows the plan too.
  await kid.goto(`/grocery?d=${WEEK}`);
  await live(kid);
  await addDish(page, "Garlic bread", "1 head garlic");
  await expect(kid.getByRole("checkbox", { name: "Garlic", exact: true })).toBeVisible(SYNC);

  await kid.context().close();
});

test("a phone that lost its connection catches up after reconnecting", async ({ page, browser }) => {
  const other = await secondPhone(browser);
  await signInOk(other, "alex", "password123");
  await other.goto(`/week?d=${WEEK}`);
  await live(other);

  // The phone goes to the background and comes back with no way to reach the
  // server: it drops the old stream and keeps retrying (with backoff).
  await other.route("**/api/events", (route) => route.abort());
  await other.evaluate(() => {
    for (const hidden of [true, false]) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  await expect(other.locator("html")).toHaveAttribute("data-live", "connecting");

  await signInOk(page, "alex", "password123");
  await page.goto(`/day/${addDays(WEEK, 4)}`);
  await addDish(page, "Missed soup");

  // No event reached it; once it reconnects, it refetches the screen.
  await other.unroute("**/api/events");
  await live(other);
  await expect(other.getByRole("list", { name: "Days" }).locator("> li").nth(4)).toContainText("Missed soup");

  await other.context().close();
});

test("the event stream needs a signed-in session", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  // A cookie gets past the proxy's quick check, but not the session check.
  const res = await anonymous.get("/api/events", { headers: { cookie: "mp_session=forged" }, maxRedirects: 0 });
  expect(res.status()).toBe(401);
  await anonymous.dispose();
});
