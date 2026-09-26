import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __esionageSql?: postgres.Sql };

// One pool per process. The custom server and Next route handlers share it via globalThis.
const sql = (globalForDb.__esionageSql ??= postgres(env.databaseUrl, { max: 10 }));

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export { schema };
