import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

try {
  process.loadEnvFile();
} catch {}

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
await sql.end();
console.log("migrations applied");
