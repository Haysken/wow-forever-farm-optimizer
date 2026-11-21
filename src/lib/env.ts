import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

let loaded = false;

/**
 * Loads `.env.local` (preferred, matching Next.js convention) and `.env` for CLI workers
 * and Drizzle tooling without overwriting already-exported process environment variables.
 */
export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;

  const cwd = process.cwd();
  const envLocalPath = path.join(cwd, ".env.local");
  const envPath = path.join(cwd, ".env");

  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath, override: false });
  }
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}
