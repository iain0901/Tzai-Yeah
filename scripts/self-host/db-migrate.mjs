import { existsSync } from "node:fs";
import { getDatabase, closeDatabase } from "../../lib/server/sqlite-runtime.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
try {
  const database = getDatabase();
  const count = database.raw.prepare("SELECT COUNT(*) AS count FROM _tzai_migrations").get().count;
  console.log(`Database ready: ${database.filename} (${count} migrations applied)`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { closeDatabase(); }
