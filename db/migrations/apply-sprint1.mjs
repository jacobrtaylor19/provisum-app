#!/usr/bin/env node
// Apply sprint1_defensibility.sql using the postgres-js client (same driver as the app).
// Run: node db/migrations/apply-sprint1.mjs
// Requires DATABASE_URL in env (e.g., from .env.local.prod via vercel env pull).

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const sql_path = join(__dir, "sprint1_defensibility.sql");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set. Run: vercel env pull .env.local.prod --environment=production");
  process.exit(1);
}

const { default: postgres } = await import(join(__dir, "../../node_modules/postgres/src/index.js"));
const db = postgres(DATABASE_URL, { prepare: false, max: 1 });

const migration_sql = readFileSync(sql_path, "utf-8");

console.log("Applying sprint1_defensibility.sql …");

try {
  // Split on statement boundaries and execute each non-comment block.
  // We execute the whole file as a single transaction for atomicity.
  await db.unsafe(`BEGIN;\n${migration_sql}\nCOMMIT;`);
  console.log("✅ Migration applied successfully.");
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
} finally {
  await db.end();
}
