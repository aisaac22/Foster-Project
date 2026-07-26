/**
 * Runs a .sql file against DATABASE_URL as a single batch.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL='postgresql://...'
 *   npx tsx scripts/run-sql.ts db/materialized.sql
 *
 * Why this exists: the Neon web editor was mangling multi-statement SQL. The
 * pg client sends the whole file as one query string, which Postgres executes
 * as a batch — exactly like psql -f, but using the library you already have.
 */

import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx scripts/run-sql.ts <path-to.sql>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set. Run: $env:DATABASE_URL='postgresql://...'");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const sql = await readFile(file, "utf8");
  console.log(`Running ${file} …`);
  const start = Date.now();
  // A single query() with multiple statements runs them as one batch.
  const result = await pool.query(sql);
  const secs = ((Date.now() - start) / 1000).toFixed(1);

  // If the file ends in a SELECT, show its rows so we can confirm success.
  const last = Array.isArray(result) ? result[result.length - 1] : result;
  if (last?.rows?.length) {
    console.log("Result:", last.rows);
  }
  console.log(`Done in ${secs}s.`);
} catch (e) {
  console.error("\nSQL FAILED:\n" + (e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
