import { existsSync } from "node:fs";
import { restoreDatabase } from "../../lib/server/sqlite-runtime.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/self-host/db-restore.mjs --input backup.sqlite --confirm-stopped [--force]");
  console.log("Stop every application instance first. --force preserves a safety backup before replacing an existing database.");
} else {
  try {
    if (args.some((arg, index) => !["--input", "--force", "--confirm-stopped"].includes(arg) && args[index - 1] !== "--input")) throw new Error("Unknown argument. Use --help for usage.");
    const inputIndex = args.indexOf("--input");
    if (inputIndex < 0 || !args[inputIndex + 1] || args[inputIndex + 1].startsWith("--")) throw new Error("--input requires a backup filename.");
    const result = await restoreDatabase(args[inputIndex + 1], { confirmStopped: args.includes("--confirm-stopped"), force: args.includes("--force") });
    console.log(`Database restored: ${result.filename}`);
    if (result.previousBackup) console.log(`Previous database preserved: ${result.previousBackup}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
