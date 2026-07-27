/**
 * Integration tests against the real database (DATABASE_URL from
 * .env.local) — same pattern used to verify the case system by hand during
 * development: real inserts with a clearly-fake owner_id prefix, real
 * queries, cleanup after every test. No mocking; check constraints, views,
 * and cascades only mean something when exercised against real Postgres.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { pool } from "@/lib/db";

const OWNER_PREFIX = "vitest_owner_";
const owner = () => `${OWNER_PREFIX}${Math.random().toString(36).slice(2)}`;

let homeId: string;
let countyId: number;
let countyName: string;

beforeAll(async () => {
  const [home] = (await pool.query(`select id_provider from providers limit 1`)).rows;
  const [county] = (await pool.query(`select id, name from counties limit 1`)).rows;
  if (!home || !county) {
    throw new Error("Integration tests need at least one provider and one county loaded.");
  }
  homeId = home.id_provider;
  countyId = county.id;
  countyName = county.name;
});

// Safety net: even if a test fails mid-way and its own cleanup doesn't run,
// nothing tagged with the vitest prefix survives the file.
afterEach(async () => {
  await pool.query(`delete from cases where owner_id like $1`, [`${OWNER_PREFIX}%`]);
});
afterAll(async () => {
  await pool.query(`delete from cases where owner_id like $1`, [`${OWNER_PREFIX}%`]);
});

describe("cases check constraint", () => {
  it("allows a retention case with a home and no county", async () => {
    const { rows } = await pool.query(
      `insert into cases (case_type, id_provider, county_id, owner_id)
       values ('retention', $1, null, $2) returning id`,
      [homeId, owner()],
    );
    expect(rows).toHaveLength(1);
  });

  it("allows a recruitment case with a county and no home", async () => {
    const { rows } = await pool.query(
      `insert into cases (case_type, id_provider, county_id, owner_id)
       values ('recruitment', null, $1, $2) returning id`,
      [countyId, owner()],
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects a retention case that also has a county set", async () => {
    await expect(
      pool.query(
        `insert into cases (case_type, id_provider, county_id, owner_id)
         values ('retention', $1, $2, $3)`,
        [homeId, countyId, owner()],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects a recruitment case that also has a home set", async () => {
    await expect(
      pool.query(
        `insert into cases (case_type, id_provider, county_id, owner_id)
         values ('recruitment', $1, $2, $3)`,
        [homeId, countyId, owner()],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects a case with neither a home nor a county", async () => {
    await expect(
      pool.query(
        `insert into cases (case_type, id_provider, county_id, owner_id)
         values ('retention', null, null, $1)`,
        [owner()],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("v_cases view", () => {
  it("resolves county_name from the home's own county on a retention case", async () => {
    const [{ id }] = (
      await pool.query(
        `insert into cases (case_type, id_provider, county_id, owner_id)
         values ('retention', $1, null, $2) returning id`,
        [homeId, owner()],
      )
    ).rows;

    const [{ county_id, county_name }] = (
      await pool.query(`select county_id, county_name from v_cases where id = $1`, [id])
    ).rows;

    // A retention case has no county_id of its own — county_name still
    // resolves, via the home it's tied to.
    expect(county_id).toBeNull();
    expect(county_name).not.toBeNull();
  });

  it("resolves county_name directly from county_id on a recruitment case", async () => {
    const [{ id }] = (
      await pool.query(
        `insert into cases (case_type, id_provider, county_id, owner_id)
         values ('recruitment', null, $1, $2) returning id`,
        [countyId, owner()],
      )
    ).rows;

    const [row] = (
      await pool.query(`select county_name from v_cases where id = $1`, [id])
    ).rows;

    expect(row.county_name).toBe(countyName);
  });

  it("counts notes via n_notes", async () => {
    const ownerId = owner();
    const [{ id }] = (
      await pool.query(
        `insert into cases (case_type, id_provider, county_id, owner_id)
         values ('retention', $1, null, $2) returning id`,
        [homeId, ownerId],
      )
    ).rows;
    await pool.query(
      `insert into case_notes (case_id, author_id, note) values ($1, $2, 'note one'), ($1, $2, 'note two')`,
      [id, ownerId],
    );

    const [row] = (await pool.query(`select n_notes from v_cases where id = $1`, [id])).rows;
    expect(Number(row.n_notes)).toBe(2);
  });
});

describe("case deletion", () => {
  it("cascades to case_notes", async () => {
    const ownerId = owner();
    const [{ id }] = (
      await pool.query(
        `insert into cases (case_type, id_provider, county_id, owner_id)
         values ('retention', $1, null, $2) returning id`,
        [homeId, ownerId],
      )
    ).rows;
    await pool.query(
      `insert into case_notes (case_id, author_id, note) values ($1, $2, 'will be cascaded')`,
      [id, ownerId],
    );

    await pool.query(`delete from cases where id = $1`, [id]);

    const notes = await pool.query(`select 1 from case_notes where case_id = $1`, [id]);
    expect(notes.rowCount).toBe(0);
  });
});

describe("ownership-scoped status update", () => {
  it("updates when owner_id matches", async () => {
    const ownerId = owner();
    const [{ id }] = (
      await pool.query(
        `insert into cases (case_type, id_provider, county_id, owner_id)
         values ('retention', $1, null, $2) returning id`,
        [homeId, ownerId],
      )
    ).rows;

    const result = await pool.query(
      `update cases set status = 'closed', closed_at = now() where id = $1 and owner_id = $2`,
      [id, ownerId],
    );
    expect(result.rowCount).toBe(1);
  });

  it("affects zero rows when owner_id does not match — the ownership check itself", async () => {
    const ownerId = owner();
    const [{ id }] = (
      await pool.query(
        `insert into cases (case_type, id_provider, county_id, owner_id)
         values ('retention', $1, null, $2) returning id`,
        [homeId, ownerId],
      )
    ).rows;

    const result = await pool.query(
      `update cases set status = 'closed', closed_at = now() where id = $1 and owner_id = $2`,
      [id, "someone_else_entirely"],
    );
    expect(result.rowCount).toBe(0);

    const [row] = (await pool.query(`select status from cases where id = $1`, [id])).rows;
    expect(row.status).toBe("open");
  });
});

describe("caseload by user", () => {
  it("aggregates open and total counts correctly", async () => {
    const ownerId = owner();
    await pool.query(
      `insert into cases (case_type, id_provider, county_id, owner_id, status)
       values ('retention', $1, null, $2, 'open'),
              ('retention', $1, null, $2, 'open'),
              ('retention', $1, null, $2, 'closed')`,
      [homeId, ownerId],
    );

    const [row] = (
      await pool.query(
        `select count(*) filter (where status = 'open')::int as open_count,
                count(*)::int as total_count
         from cases where owner_id = $1`,
        [ownerId],
      )
    ).rows;

    expect(row.open_count).toBe(2);
    expect(row.total_count).toBe(3);
  });
});
