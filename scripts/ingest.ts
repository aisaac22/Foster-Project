/**
 * CSV ingest pipeline (batched).
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL='postgresql://...'
 *   npx tsx scripts/ingest.ts --snapshot 2026-07-01 --children data/child_level.csv --providers data/provider_level_updated.csv --placements data/placement_level.csv
 *
 * Validation and parsing are unchanged from the first version. What changed is
 * the write strategy: rows are inserted in chunks of ~500 via multi-row VALUES,
 * and every lookup (counties, provider existence, episode ids) is resolved once
 * into an in-memory Map instead of one query per row.
 */

import { Pool, type PoolClient } from "pg";
import Papa from "papaparse";
import { z } from "zod";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CHUNK = 500;
const log = (msg: string) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// ---------------------------------------------------------------------------
// Parsing primitives
// ---------------------------------------------------------------------------

const NULLISH = new Set(["", "na", "n/a", "null", "none", "-", "unknown", "nan"]);

const nullable = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return NULLISH.has(s.toLowerCase()) ? null : s;
};

function parseDate(raw: unknown): string | null {
  const s = nullable(raw);
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return iso(+m[3], +m[1], +m[2]); // US month-first

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  throw new Error(`Unparseable date: "${s}"`);
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const num = (raw: unknown): number | null => {
  const s = nullable(raw);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  if (Number.isNaN(n)) throw new Error(`Unparseable number: "${s}"`);
  return n;
};

/**
 * The snapshot convention: a date equal to the snapshot means "still open".
 * Storing it literally would make ongoing placements look closed and every
 * duration look truncated.
 */
function openEndedDate(raw: unknown, snapshot: string): string | null {
  const d = parseDate(raw);
  return d === null || d === snapshot ? null : d;
}

const RESOURCE_TYPES: Record<string, "kin" | "foster_home" | "nonfamily"> = {
  kin: "kin",
  foster_home: "foster_home",
  fosterhome: "foster_home",
  foster: "foster_home",
  nonfamily: "nonfamily",
  non_family: "nonfamily",
};

function parseResourceType(raw: unknown): "kin" | "foster_home" | "nonfamily" {
  const s = nullable(raw)?.toLowerCase().replace(/[\s-]+/g, "_");
  const mapped = s ? RESOURCE_TYPES[s] : undefined;
  if (!mapped) throw new Error(`Unknown resource_type: "${raw}"`);
  return mapped;
}

// ---------------------------------------------------------------------------
// Row schemas
// ---------------------------------------------------------------------------

const ChildRow = z.object({
  id_child: z.number().int().positive(),
  removal_date: z.string(),
  discharge_date: z.string().nullable(),
  age_at_removal: z.number().int().min(0).max(21).nullable(),
  most_recent_age: z.number().int().min(0).max(26).nullable(),
  removal_county: z.string().nullable(),
});

const PlacementRow = z.object({
  id_child: z.number().int().positive(),
  placement_start_date: z.string(),
  placement_end_date: z.string().nullable(),
  resource_type: z.enum(["kin", "foster_home", "nonfamily"]),
  placement_index: z.number().int().positive(),
  removal_county: z.string().nullable(),
  placement_county: z.string().nullable(),
  id_provider: z.number().int().positive().nullable(),
  id_facility: z.number().int().positive().nullable(),
  placement_length: z.number().int().nullable(),
});

const ProviderRow = z.object({
  id_provider: z.number().int().positive(),
  license_start_date: z.string().nullable(),
  license_end_date: z.string().nullable(),
  county_provider: z.string().nullable(),
  n_days_licensed: z.number().int().nullable(),
  n_days_active: z.number().int().nullable(),
  min_age: z.number().int().min(0).max(17).nullable(),
  max_age: z.number().int().min(1).max(18).nullable(),
}).refine(
  (r) => r.min_age === null || r.max_age === null || r.max_age >= r.min_age,
  { message: "max_age must be >= min_age" },
);

type Child = z.infer<typeof ChildRow>;
type Placement = z.infer<typeof PlacementRow>;
type Provider = z.infer<typeof ProviderRow>;

// ---------------------------------------------------------------------------
// CSV + validation
// ---------------------------------------------------------------------------

export function parseCsv(text: string): Record<string, string>[] {
  const out = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  const fatal = out.errors.filter((e) => e.type !== "FieldMismatch");
  if (fatal.length) {
    throw new Error(
      `CSV parse failed: ${fatal.slice(0, 3).map((e) => e.message).join("; ")}`,
    );
  }
  return out.data;
}

function validateAll<T>(
  rows: Record<string, string>[],
  coerce: (r: Record<string, string>) => T,
  label: string,
): T[] {
  const ok: T[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    try {
      ok.push(coerce(r));
    } catch (e) {
      const msg = e instanceof z.ZodError
        ? e.issues.map((s) => `${s.path.join(".")}: ${s.message}`).join("; ")
        : (e as Error).message;
      errors.push(`  ${label} line ${i + 2}: ${msg}`);
    }
  });
  if (errors.length) {
    throw new Error(
      `${errors.length} invalid ${label} rows (of ${rows.length}):\n` +
        errors.slice(0, 20).join("\n") +
        (errors.length > 20 ? `\n  …and ${errors.length - 20} more` : ""),
    );
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Batch insert helper
// ---------------------------------------------------------------------------

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

/** Builds "($1,$2),($3,$4)" plus the flat parameter array. */
function valuesClause(rows: unknown[][]): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const ph = row.map((v) => {
      params.push(v);
      return `$${params.length}`;
    });
    return `(${ph.join(",")})`;
  });
  return { text: tuples.join(","), params };
}

async function batchInsert(
  db: PoolClient,
  prefix: string,
  rows: unknown[][],
  suffix: string,
  label: string,
) {
  let done = 0;
  for (const chunk of chunks(rows, CHUNK)) {
    const { text, params } = valuesClause(chunk);
    await db.query(`${prefix} values ${text} ${suffix}`, params);
    done += chunk.length;
    if (done % 5000 === 0 || done === rows.length) {
      log(`  ${label}: ${done}/${rows.length}`);
    }
  }
}

// ---------------------------------------------------------------------------
// County dimension — resolved once, across all three files
// ---------------------------------------------------------------------------

async function resolveCounties(db: PoolClient, names: Set<string>) {
  const list = [...names].filter((n) => n && n.trim());
  for (const chunk of chunks(list, CHUNK)) {
    const { text, params } = valuesClause(chunk.map((n) => [n.trim()]));
    await db.query(
      `insert into counties (name) values ${text} on conflict (name) do nothing`,
      params,
    );
  }
  const { rows } = await db.query<{ id: number; name: string }>(
    `select id, name from counties`,
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.name.trim().toLowerCase(), r.id);
  log(`counties resolved: ${map.size}`);
  return map;
}

const cid = (map: Map<string, number>, name: string | null) =>
  name ? map.get(name.trim().toLowerCase()) ?? null : null;

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadChildren(
  db: PoolClient,
  counties: Map<string, number>,
  rows: Child[],
  snapshot: string,
) {
  await batchInsert(
    db,
    `insert into children (id_child)`,
    rows.map((r) => [r.id_child]),
    `on conflict (id_child) do nothing`,
    "children",
  );

  await batchInsert(
    db,
    `insert into episodes (id_child, episode_index, removal_date, discharge_date,
       age_at_removal, age_at_observation, observed_as_of, removal_county_id)`,
    rows.map((r) => [
      r.id_child, 1, r.removal_date, r.discharge_date,
      r.age_at_removal, r.most_recent_age, snapshot,
      cid(counties, r.removal_county),
    ]),
    `on conflict (id_child, episode_index) do update set
       removal_date       = excluded.removal_date,
       discharge_date     = excluded.discharge_date,
       age_at_removal     = excluded.age_at_removal,
       age_at_observation = excluded.age_at_observation,
       observed_as_of     = excluded.observed_as_of,
       removal_county_id  = excluded.removal_county_id`,
    "episodes",
  );

  return rows.length;
}

async function loadProviders(
  db: PoolClient,
  counties: Map<string, number>,
  rows: Provider[],
  snapshot: string,
) {
  await batchInsert(
    db,
    `insert into providers (id_provider, license_start_date, license_end_date, county_id)`,
    rows.map((r) => [
      r.id_provider, r.license_start_date, r.license_end_date,
      cid(counties, r.county_provider),
    ]),
    `on conflict (id_provider) do update set
       license_start_date = excluded.license_start_date,
       license_end_date   = excluded.license_end_date,
       county_id          = excluded.county_id`,
    "providers",
  );

  // Slowly-changing age preferences: read current state once, diff in memory.
  const { rows: existing } = await db.query<{
    id_provider: string; min_age: number; max_age: number;
  }>(`select id_provider, min_age, max_age
        from provider_age_preferences where effective_to is null`);

  const current = new Map(
    existing.map((r) => [Number(r.id_provider), { min: r.min_age, max: r.max_age }]),
  );

  const toClose: number[] = [];
  const toInsert: unknown[][] = [];

  for (const r of rows) {
    if (r.min_age === null || r.max_age === null) continue;
    const cur = current.get(r.id_provider);
    if (cur && cur.min === r.min_age && cur.max === r.max_age) continue;
    if (cur) toClose.push(r.id_provider);
    toInsert.push([
      r.id_provider, r.min_age, r.max_age, r.license_start_date ?? snapshot,
    ]);
  }

  for (const chunk of chunks(toClose, CHUNK)) {
    await db.query(
      `update provider_age_preferences
          set effective_to = ($2::date - 1)
        where id_provider = any($1::bigint[]) and effective_to is null`,
      [chunk, snapshot],
    );
  }

  if (toInsert.length) {
    await batchInsert(
      db,
      `insert into provider_age_preferences (id_provider, min_age, max_age, effective_from)`,
      toInsert,
      ``,
      "preferences",
    );
  }
  log(`  preferences: ${toInsert.length} new, ${toClose.length} superseded`);

  return rows.length;
}

async function loadPlacements(
  db: PoolClient,
  counties: Map<string, number>,
  rows: Placement[],
) {
  // Referential checks: one query each, then compared in memory.
  const { rows: provRows } = await db.query<{ id_provider: string }>(
    `select id_provider from providers`,
  );
  const knownProviders = new Set(provRows.map((r) => Number(r.id_provider)));

  const missing = new Set<number>();
  for (const r of rows) {
    if (r.id_provider !== null && !knownProviders.has(r.id_provider)) {
      missing.add(r.id_provider);
    }
  }
  if (missing.size) {
    throw new Error(
      `${missing.size} placements reference providers not present in the providers file ` +
      `(e.g. ${[...missing].slice(0, 5).join(", ")}).`,
    );
  }

  // Children referenced by placements but absent from the children file.
  const { rows: kidRows } = await db.query<{ id_child: string }>(
    `select id_child from children`,
  );
  const knownChildren = new Set(kidRows.map((r) => Number(r.id_child)));
  const orphanKids = [
    ...new Set(rows.filter((r) => !knownChildren.has(r.id_child)).map((r) => r.id_child)),
  ];
  if (orphanKids.length) {
    log(`  note: ${orphanKids.length} children in placements but not in children.csv — creating stubs`);
    await batchInsert(
      db,
      `insert into children (id_child)`,
      orphanKids.map((id) => [id]),
      `on conflict (id_child) do nothing`,
      "child stubs",
    );
  }

  const { rows: epRows } = await db.query<{ id: string; id_child: string }>(
    `select id, id_child from episodes where episode_index = 1`,
  );
  const episodeByChild = new Map(epRows.map((r) => [Number(r.id_child), Number(r.id)]));

  await batchInsert(
    db,
    `insert into placements (id_child, episode_id, placement_index, start_date, end_date,
       resource_type, id_provider, id_facility, removal_county_id, placement_county_id)`,
    rows.map((r) => [
      r.id_child,
      episodeByChild.get(r.id_child) ?? null,
      r.placement_index,
      r.placement_start_date,
      r.placement_end_date,
      r.resource_type,
      r.id_provider,
      r.id_facility,
      cid(counties, r.removal_county),
      cid(counties, r.placement_county),
    ]),
    `on conflict (id_child, placement_index) do update set
       start_date          = excluded.start_date,
       end_date            = excluded.end_date,
       resource_type       = excluded.resource_type,
       id_provider         = excluded.id_provider,
       id_facility         = excluded.id_facility,
       removal_county_id   = excluded.removal_county_id,
       placement_county_id = excluded.placement_county_id,
       episode_id          = coalesce(excluded.episode_id, placements.episode_id)`,
    "placements",
  );

  return rows.length;
}

// ---------------------------------------------------------------------------
// Reconciliation — the source's derived columns vs. ours
// ---------------------------------------------------------------------------

function reconcile(rows: Placement[], raw: Record<string, string>[], snapshot: string) {
  const issues: { id_child: number; index: number; source: number; calc: number }[] = [];
  rows.forEach((r, i) => {
    const supplied = num(raw[i]?.placement_length);
    if (supplied === null) return;
    const end = r.placement_end_date ?? snapshot;
    const calc = Math.round(
      (Date.parse(end) - Date.parse(r.placement_start_date)) / 86_400_000,
    );
    if (Math.abs(calc - supplied) > 1) {
      issues.push({ id_child: r.id_child, index: r.placement_index, source: supplied, calc });
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface IngestInput {
  snapshotDate: string;
  children?: string;
  providers?: string;
  placements?: string;
  source?: string;
}

export async function ingest(input: IngestInput) {
  const snapshot = input.snapshotDate;
  const db = await pool.connect();
  let loadId: number | undefined;

  try {
    // Recorded OUTSIDE the transaction so failed attempts remain visible.
    const { rows: [load] } = await db.query<{ id: number }>(
      `insert into data_loads (snapshot_date, source) values ($1, $2) returning id`,
      [snapshot, input.source ?? "cli"],
    );
    loadId = load.id;

    log("parsing and validating…");
    const rawChildren   = input.children   ? parseCsv(input.children)   : [];
    const rawProviders  = input.providers  ? parseCsv(input.providers)  : [];
    const rawPlacements = input.placements ? parseCsv(input.placements) : [];

    const children = validateAll(rawChildren, (r) => ChildRow.parse({
      id_child: num(r.id_child),
      removal_date: parseDate(r.removal_date),
      discharge_date: openEndedDate(r.discharge_date, snapshot),
      age_at_removal: num(r.age_at_removal),
      most_recent_age: num(r.most_recent_age),
      removal_county: nullable(r.removal_county),
    }), "children");

    const providers = validateAll(rawProviders, (r) => ProviderRow.parse({
      id_provider: num(r.id_provider),
      license_start_date: parseDate(r.license_start_date),
      license_end_date: openEndedDate(r.license_end_date, snapshot),
      county_provider: nullable(r.county_provider),
      n_days_licensed: num(r.n_days_licensed),
      n_days_active: num(r.n_days_active),
      min_age: num(r.min_age),
      max_age: num(r.max_age),
    }), "providers");

    const placements = validateAll(rawPlacements, (r) => {
      const type = parseResourceType(r.resource_type_on_this_placement);
      // The source reuses one id column for two different entities:
      // foster homes (present in providers.csv) and congregate care
      // facilities (800xxx range, not in providers.csv). Kin has neither.
      const ref = num(r.id_provider);
      if (type === "kin" && ref !== null) {
        throw new Error(`kin placement unexpectedly has id_provider=${ref}`);
      }
      return PlacementRow.parse({
        id_child: num(r.id_child),
        placement_start_date: parseDate(r.placement_start_date),
        placement_end_date: openEndedDate(r.placement_end_date, snapshot),
        resource_type: type,
        placement_index: num(r.placement_index),
        removal_county: nullable(r.removal_county),
        placement_county: nullable(r.placement_county),
        id_provider: type === "foster_home" ? ref : null,
        id_facility: type === "nonfamily" ? ref : null,
        placement_length: num(r.placement_length),
      });
    }, "placements");

    log(`validated: ${children.length} children, ${providers.length} providers, ${placements.length} placements`);

    await db.query("begin");

    const countyNames = new Set<string>();
    for (const r of children)  if (r.removal_county)  countyNames.add(r.removal_county);
    for (const r of providers) if (r.county_provider) countyNames.add(r.county_provider);
    for (const r of placements) {
      if (r.removal_county)   countyNames.add(r.removal_county);
      if (r.placement_county) countyNames.add(r.placement_county);
    }
    const counties = await resolveCounties(db, countyNames);

    const counts: Record<string, number> = {};
    if (children.length) {
      log("loading children…");
      counts.children = await loadChildren(db, counties, children, snapshot);
    }
    if (providers.length) {
      log("loading providers…");
      counts.providers = await loadProviders(db, counties, providers, snapshot);
    }
    if (placements.length) {
      log("loading placements…");
      counts.placements = await loadPlacements(db, counties, placements);
    }

    const discrepancies = reconcile(placements, rawPlacements, snapshot);

    await db.query(
      `update data_loads set status = 'complete', finished_at = now(),
              row_counts = $2, discrepancies = $3 where id = $1`,
      [loadId, JSON.stringify(counts), JSON.stringify(discrepancies.slice(0, 500))],
    );

    await db.query("commit");
    log("done");

    log("refreshing materialized view…");
    await db.query("refresh materialized view v_provider_service_history");
    log("refresh complete");

    return { loadId, counts, discrepancyCount: discrepancies.length };
  } catch (err) {
    try { await db.query("rollback"); } catch { /* no active transaction */ }
    if (loadId !== undefined) {
      await db.query(
        `update data_loads set status = 'failed', finished_at = now(),
                discrepancies = $2 where id = $1`,
        [loadId, JSON.stringify([{ error: (err as Error).message.slice(0, 4000) }])],
      );
    }
    throw err;
  } finally {
    db.release();
  }
}

// ---------------------------------------------------------------------------
// CLI  (no import.meta guard — that comparison never matches on Windows)
// ---------------------------------------------------------------------------

{
  const { readFile } = await import("node:fs/promises");
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
}
