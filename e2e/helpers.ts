import { expect, type Page } from "@playwright/test";

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
