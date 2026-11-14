import { existsSync } from "node:fs";
import { backupDatabase, closeDatabase } from "../../lib/server/sqlite-runtime.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/self-host/db-backup.mjs [--output backups/name.sqlite] [--force]");
} else {
  try {
    if (args.some((arg, index) => !["--output", "--force"].includes(arg) && args[index - 1] !== "--output")) throw new Error("Unknown argument. Use --help for usage.");
    const outputIndex = args.indexOf("--output");
    if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith("--"))) throw new Error("--output requires a filename.");
    const target = outputIndex >= 0 ? args[outputIndex + 1] : `backups/tzai-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
    console.log(`Backup verified: ${await backupDatabase(target, { force: args.includes("--force") })}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { closeDatabase(); }
}
