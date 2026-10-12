// Builds the standalone app and serves it against a fresh `<db>_e2e` database.
// Used as Playwright's webServer command.
import { execSync, spawn } from "node:child_process";
import { cpSync } from "node:fs";
import { recreateDatabase, testDatabaseUrl } from "../tests/helpers/test-db-url.mts";

const port = process.env.E2E_PORT ?? "3100";
const databaseUrl = testDatabaseUrl("e2e");
await recreateDatabase(databaseUrl);

if (!process.env.E2E_SKIP_BUILD) execSync("pnpm build", { stdio: "inherit" });
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
cpSync("drizzle", ".next/standalone/drizzle", { recursive: true });

const server = spawn("node", ["server.js"], {
  cwd: ".next/standalone",
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
  },
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.kill(sig));
server.on("exit", (code) => process.exit(code ?? 0));
