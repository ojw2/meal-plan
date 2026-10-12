import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./tests/helpers/test-db-url.mts";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside React Server Components; tests are plain Node.
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/empty.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    env: {
      DATABASE_URL: testDatabaseUrl(),
      SESSION_SECRET: "test-secret-test-secret-test-secret-123",
    },
    // Integration tests share one database.
    fileParallelism: false,
  },
});
