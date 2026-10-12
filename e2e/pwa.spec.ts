import { expect, test } from "@playwright/test";

// Milestone 6: installable PWA (SPEC §7). Everything needed to install works
// before signing in, since the login page is where a phone first lands.

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

test("the manifest and its icons are served without signing in", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Meal Plan", start_url: "/", display: "standalone" });

  const sizes = new Set<string>();
  for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
    const img = await request.get(icon.src);
    expect(img.ok()).toBe(true);
    expect(img.headers()["content-type"]).toBe("image/png");
    expect(pngSize(await img.body()).join("x")).toBe(icon.sizes);
    sizes.add(icon.sizes);
  }
  // What Chrome needs to offer installation.
  expect(sizes).toEqual(new Set(["192x192", "512x512"]));
  expect(manifest.icons).toContainEqual(expect.objectContaining({ purpose: "maskable" }));

  const apple = await request.get("/apple-icon");
  expect(apple.ok()).toBe(true);
  expect(pngSize(await apple.body())).toEqual([180, 180]);
});

test("the login page links the manifest and registers the service worker", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /^\/apple-icon/);

  const scriptURL = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(scriptURL).toMatch(/\/sw\.js$/);
});

test("the service worker is never cached and doesn't intercept requests", async ({ request }) => {
  const res = await request.get("/sw.js");
  expect(res.ok()).toBe(true);
  expect(res.headers()["cache-control"]).toContain("no-cache");
  // No offline support (SPEC §1): no fetch handler, no caches.
  const source = await res.text();
  expect(source).not.toContain('"fetch"');
  expect(source).not.toContain("caches");
});
