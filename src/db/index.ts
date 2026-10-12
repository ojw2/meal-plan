import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 10 });
  return drizzle({ client, schema });
}

export type Db = ReturnType<typeof createDb>;
/** A transaction handle or the db itself; services accept either. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// Reuse one pool across dev hot reloads.
const globalForDb = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  globalForDb.__db ??= createDb();
  return globalForDb.__db;
}
