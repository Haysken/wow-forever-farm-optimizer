import { loadLocalEnv } from "./src/lib/env";
import { defineConfig } from "drizzle-kit";

loadLocalEnv();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/wow_forever_farm",
  },
  verbose: true,
  strict: true,
});
