import { Pool } from "pg";

// One pool for the whole app. In dev, Next.js hot-reload re-runs modules, so
// stash the pool on globalThis to avoid opening a new pool on every reload.
const globalForDb = globalThis as unknown as { _pool?: Pool };

export const pool =
  globalForDb._pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalForDb._pool = pool;

/** Run a read-only query and return typed rows. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}
