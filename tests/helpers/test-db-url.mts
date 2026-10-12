import "dotenv/config";

/** The dev database URL with its database name swapped, e.g. mealplan → mealplan_test. */
export function testDatabaseUrl(suffix = "test"): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL must be set (see .env.example)");
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/^\//, "").split("_")[0]}_${suffix}`;
  return url.toString();
}

/** Drops and recreates the database in `url`, connecting via the `postgres` maintenance DB. */
export async function recreateDatabase(url: string) {
  const { default: postgres } = await import("postgres");
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!/^[a-z0-9_]+_(test|e2e)$/.test(dbName)) {
    throw new Error(`Refusing to recreate non-test database "${dbName}"`);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`drop database if exists "${dbName}" with (force)`);
    await sql.unsafe(`create database "${dbName}"`);
  } finally {
    await sql.end();
  }
}
