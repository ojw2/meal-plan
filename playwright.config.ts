import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "3100";
// Set to test an already-running deployment (e.g. the Docker stack) instead
// of building one. It must point at a fresh, un-set-up database.
const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  // Tests share one household and run in order.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: externalBaseUrl ?? `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "pnpm exec tsx scripts/e2e-server.mts",
        url: `http://127.0.0.1:${port}/api/health`,
        timeout: 300_000,
        reuseExistingServer: false,
        stdout: "pipe",
      },
});
