/**
 * CLI entry point for the CSV ingest pipeline. The actual logic lives in
 * src/lib/ingest.ts (shared with the admin CSV-upload modal in the app) —
 * this file only parses argv and reads files from disk.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL='postgresql://...'
 *   npx tsx scripts/ingest.ts --snapshot 2026-07-01 --children data/child_level.csv --providers data/provider_level_updated.csv --placements data/placement_level.csv
 */

import { readFile } from "node:fs/promises";
import { ingest } from "../src/lib/ingest";
import { pool } from "../src/lib/db";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const read = async (p?: string) => (p ? await readFile(p, "utf8") : undefined);

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. In PowerShell:\n  $env:DATABASE_URL='postgresql://...'",
  );
  process.exit(1);
}

try {
  const result = await ingest({
    snapshotDate: arg("snapshot") ?? "2026-07-01",
    children: await read(arg("children")),
    providers: await read(arg("providers")),
    placements: await read(arg("placements")),
    source: "cli",
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.discrepancyCount > 0) {
    console.warn(
      `\n${result.discrepancyCount} placements where the supplied placement_length ` +
      `disagrees with the computed duration. See data_loads.discrepancies.`,
    );
  }
} catch (e) {
  console.error("\nINGEST FAILED\n" + (e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
