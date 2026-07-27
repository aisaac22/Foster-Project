/**
 * Integration test for the CSV ingest pipeline (src/lib/ingest.ts), against
 * the real database — same approach used to verify the pipeline by hand
 * after extracting it from scripts/ingest.ts: real CSV text through the
 * real ingest() function, real rows checked, then cleaned up.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { pool } from "@/lib/db";
import { ingest } from "@/lib/ingest";

// Comfortably clear of real IDs (providers start at 500001; nonfamily
// facility IDs use the 800xxx range) and of each other, per test.
let counter = 0;
function testIds() {
  counter += 1;
  const base = 999_100_000 + counter * 10;
  return { child: base, provider: base + 1 };
}

const testCounties = new Set<string>();

// Set right after a test's own `await ingest(...)` call returns successfully
// — ingest() refreshes v_provider_service_history as its last internal step,
// which means our test row is now baked into that materialized snapshot.
// Deleting the underlying row afterward does NOT retroactively update it:
// a materialized view only changes when something explicitly refreshes it
// again. Skipping that second refresh is exactly how a deleted test
// provider went on showing up on the real At-risk page — the base row was
// gone, but the stale snapshot still had it.
let needsMatviewRefresh = false;

afterEach(async () => {
  // Children/episodes/placements/providers cascade or are re-deletable
  // directly; counties created just for these tests are cleaned up by name.
  await pool.query(`delete from placements where id_child >= 999100000`);
  await pool.query(`delete from provider_age_preferences where id_provider >= 999100000`);
  await pool.query(`delete from providers where id_provider >= 999100000`);
  await pool.query(`delete from episodes where id_child >= 999100000`);
  await pool.query(`delete from children where id_child >= 999100000`);
  if (testCounties.size) {
    await pool.query(`delete from counties where name = any($1::text[])`, [[...testCounties]]);
    testCounties.clear();
  }
  // Catches both successful loads AND loads that failed mid-ingest — a
  // rejected ingest() call still writes a data_loads row before throwing.
  await pool.query(`delete from data_loads where source = 'vitest'`);

  if (needsMatviewRefresh) {
    await pool.query(`refresh materialized view v_provider_service_history`);
    needsMatviewRefresh = false;
  }
});

// Unconditional final safety net: if a test times out or the process is
// interrupted mid-run, the per-test refresh above can be skipped even
// though the underlying ingest() already committed and refreshed with test
// data present. This is what actually leaked a phantom row onto the real
// At-risk page once — cheap insurance against it happening again.
afterAll(async () => {
  await pool.query(`refresh materialized view v_provider_service_history`);
});

describe("ingest()", () => {
  it("loads a child, provider, and placement end to end", async () => {
    const { child, provider } = testIds();
    const county = `Vitest County ${provider}`;
    testCounties.add(county);

    const result = await ingest({
      snapshotDate: "2026-07-01",
      children: `id_child,removal_date,discharge_date,age_at_removal,most_recent_age,removal_county\n${child},2024-01-15,,8,10,${county}`,
      providers: `id_provider,license_start_date,license_end_date,county_provider,n_days_licensed,n_days_active,min_age,max_age\n${provider},2023-06-01,,${county},,,0,12`,
      placements: `id_child,placement_start_date,placement_end_date,resource_type_on_this_placement,placement_index,removal_county,placement_county,id_provider,placement_length\n${child},2024-01-20,,foster_home,1,${county},${county},${provider},`,
      source: "vitest",
    });
    needsMatviewRefresh = true;
    expect(result.counts).toEqual({ children: 1, providers: 1, placements: 1 });
    expect(result.discrepancyCount).toBe(0);

    const placement = (
      await pool.query(`select resource_type, id_provider from placements where id_child = $1`, [child])
    ).rows[0];
    expect(placement.resource_type).toBe("foster_home");
    expect(Number(placement.id_provider)).toBe(provider);

    const pref = (
      await pool.query(`select min_age, max_age from provider_age_preferences where id_provider = $1`, [provider])
    ).rows[0];
    expect(pref.min_age).toBe(0);
    expect(pref.max_age).toBe(12);
  });

  it("flags a placement_length that disagrees with the computed duration", async () => {
    const { child, provider } = testIds();
    const county = `Vitest County ${provider}`;
    testCounties.add(county);

    const result = await ingest({
      snapshotDate: "2026-07-01",
      providers: `id_provider,license_start_date,license_end_date,county_provider,n_days_licensed,n_days_active,min_age,max_age\n${provider},2023-06-01,,${county},,,0,12`,
      // Actual duration is 10 days; supplied placement_length claims 500.
      placements: `id_child,placement_start_date,placement_end_date,resource_type_on_this_placement,placement_index,removal_county,placement_county,id_provider,placement_length\n${child},2024-01-01,2024-01-11,foster_home,1,${county},${county},${provider},500`,
      source: "vitest",
    });
    needsMatviewRefresh = true;
    expect(result.discrepancyCount).toBe(1);
  });

  it("rejects a kin placement that also carries a provider id", async () => {
    const { child, provider } = testIds();
    const county = `Vitest County ${provider}`;

    await expect(
      ingest({
        snapshotDate: "2026-07-01",
        placements: `id_child,placement_start_date,placement_end_date,resource_type_on_this_placement,placement_index,removal_county,placement_county,id_provider,placement_length\n${child},2024-01-01,,kin,1,${county},${county},${provider},`,
        source: "vitest",
      }),
    ).rejects.toThrow(/kin placement unexpectedly has id_provider/);
  });

  it("rejects a placement referencing a provider not present in the providers file", async () => {
    const { child, provider } = testIds();
    const county = `Vitest County ${provider}`;

    await expect(
      ingest({
        snapshotDate: "2026-07-01",
        placements: `id_child,placement_start_date,placement_end_date,resource_type_on_this_placement,placement_index,removal_county,placement_county,id_provider,placement_length\n${child},2024-01-01,,foster_home,1,${county},${county},${provider},`,
        source: "vitest",
      }),
    ).rejects.toThrow(/reference providers not present/);
  });
});
