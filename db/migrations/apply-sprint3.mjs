#!/usr/bin/env node
// Apply sprint3_uuid_phase1.sql using the postgres-js client.
// Run: node db/migrations/apply-sprint3.mjs
// Requires DATABASE_URL in env (e.g. from: vercel env pull .env.local.prod --environment=production)

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const sql_path = join(__dir, "sprint3_uuid_phase1.sql");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  console.error("Run: vercel env pull .env.local.prod --environment=production");
  process.exit(1);
}

const { default: postgres } = await import(join(__dir, "../../node_modules/postgres/src/index.js"));
const db = postgres(DATABASE_URL, { prepare: false, max: 1 });

const migration_sql = readFileSync(sql_path, "utf-8");

console.log("Applying sprint3_uuid_phase1.sql …");
console.log("(Additive only — adds id_uuid shadow columns to all 57 live tables)");

try {
  await db.unsafe(`BEGIN;\n${migration_sql}\nCOMMIT;`);
  console.log("✅ Migration applied successfully.");
  console.log("");
  console.log("Verifying — querying information_schema for id_uuid columns …");

  const rows = await db`
    SELECT table_name
      FROM information_schema.columns
     WHERE column_name = 'id_uuid'
       AND table_schema = 'public'
     ORDER BY table_name
  `;

  console.log(`Found ${rows.length} tables with id_uuid column:`);
  rows.forEach((r) => console.log(`  • ${r.table_name}`));

  if (rows.length === 57) {
    console.log("\n✅ All 57 live tables confirmed.");
  } else {
    console.warn(`\n⚠️  Expected 57, got ${rows.length}. Check for missing or extra tables.`);
  }
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
} finally {
  await db.end();
}
