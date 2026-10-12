import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { recreateDatabase, testDatabaseUrl } from "./test-db-url.mts";

export default async function setup() {
  const url = testDatabaseUrl();
  await recreateDatabase(url);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle({ client }), { migrationsFolder: path.resolve("drizzle") });
  } finally {
    await client.end();
  }
}
