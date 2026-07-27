# Foster Care Placement Dashboard

An internal web app for a child welfare agency that turns periodic CSV extracts
into a private, browsable dashboard focused on **foster home recruitment and
retention**. It identifies which licensed homes are most likely to stop
fostering, while they can still be reached, and where the agency is short of
homes relative to the children who need them. On top of that analytics layer,
staff track their actual outreach work as **cases** — one per home (retention)
or county (recruitment) — with notes and an open/closed status.

## What it does

The app ingests three CSV extracts (children, placements, providers), loads them
into Postgres as a clean relational model, and computes analytics through SQL
views. Several pages read those views:

- **At-risk homes** — currently licensed foster homes ranked 0–100 by
  likelihood of exiting, based on utilization relative to peers, disruption
  rate, and tenure. Each row shows *why* it was flagged. This is the primary
  screen: retaining an existing home is cheaper than recruiting a new one.
- **All homes** — every foster home, licensed or exited, sortable and
  filterable by county and status.
- **Counties** — supply and demand by county, led by *net outflow* (children a
  county cannot house in its own homes), the clearest recruitment target.
- **Recruitment** — county × age-band capacity gaps, so recruiters know which
  age ranges are hardest to place.
- **Trend** — monthly homes gained/lost/active, charted, plus a Federal
  context panel of national AFCARS figures for scale.
- **Provider detail** — one home's full service history, placement timeline,
  and retention contact log.
- **Data dictionary** — plain-English documentation of every page above and
  what each column on it means, reachable from the Analytics nav dropdown.

On top of the read-only analytics, signed-in staff get a working case system:

- **Dashboard** — each account's home page after sign-in: their own cases
  first, then everyone else's open cases below.
- **Cases** — a case is either a **retention** case (tied to a home) or a
  **recruitment** case (tied to a county), never both. Each has an open/closed
  status and a running, timestamped, attributed note log. Anyone can add a
  note; only the case's owner can close or reopen it.
- **Admin** — accounts flagged as admin (see [Setup](#setup)) get a different
  home page instead of the personal dashboard: every case across the team,
  filterable by type/status/owner, paginated, with the ability to permanently
  delete a case, plus a caseload-by-user breakdown. Admins also get a
  floating upload button (bottom-right, any page) to load a new CSV
  snapshot from the browser instead of the CLI.

Access is gated by authentication; only accounts created by an administrator can
sign in. That's separate from the in-app admin *role* above — signing in just
requires a Clerk account; the admin role is an additional flag set per-account
for the case-management view.

## Architecture

    CSV extracts
        │  ingest pipeline (validate, normalize, upsert)
        ▼
    Postgres: source of truth
        │  SQL views (some materialized): the analytics layer / de-facto API
        ▼
    Next.js (App Router, Server Components): pages read views directly

    cases / case_notes: staff-entered, not CSV-derived — a lightweight
    operational layer alongside the analytics, following the same
    Server-Component-reads-Postgres-directly pattern.

The SQL views *are* the API: each analytics page is a single query against a
view, so adding a metric means writing a view and a page, not a REST layer.
`v_provider_service_history` is materialized (see `db/materialized.sql`)
because its underlying calculation is expensive; `scripts/ingest.ts` refreshes
it automatically after every load.

## Tech stack

- **Next.js** (App Router, TypeScript, Server Components, Server Actions)
- **Postgres** (hosted on Neon)
- **node-postgres (pg)** for queries; **Papaparse + Zod** for CSV parsing/validation
- **Clerk** for authentication (closed sign-ups; admin creates all accounts) —
  also the source of the in-app admin role, stored in Clerk's private user
  metadata

## Repository layout

    db/
      schema.sql        tables, constraints, indexes
      views.sql         analytics views (foundation, retention, recruitment, QA)
      materialized.sql  materializes v_provider_service_history + dependents
      cases.sql         case management: cases, case_notes, v_cases
    scripts/
      ingest.ts         thin CLI wrapper around src/lib/ingest.ts (argv + file reads)
      run-sql.ts        runs a .sql file as one batch (use for every db/*.sql —
                         the Neon web editor mangles multi-statement SQL)
      set-admin.ts      grants/revokes the in-app admin role for a Clerk user
    tests/
      integration/      real-database tests (cases, ingest) — see Testing below
    src/
      lib/db.ts         shared connection pool + typed query()
      lib/ingest.ts     the actual CSV ingest pipeline — shared by the CLI and
                         the admin upload modal's Server Action
      lib/format.ts     display formatting
      lib/data-dictionary.ts  content for the Data dictionary page
      lib/require-user.ts  per-page auth guards: requireUser, isAdmin, requireAdmin
      proxy.ts          Clerk middleware (auth on all routes)
      app/
        at-risk/        the retention worklist
        homes/          all homes, sortable/filterable
        counties/       supply & demand
        recruitment/    county × age-band capacity gaps
        trend/          monthly chart + federal context
        data-dictionary/  page-by-page field documentation
        providers/[id]/ provider detail + retention contact log
        dashboard/      home page after sign-in (personal, or admin case list)
        cases/          case detail, new-case form
        admin/cases/    all-cases admin view (filter, paginate, delete)
        sign-in/        Clerk sign-in

## Setup

Requires Node 20.6+ and a Postgres database (Neon works out of the box).

1. **Install**

       npm install

2. **Environment** — create `.env.local`:

       DATABASE_URL=postgresql://...
       NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
       CLERK_SECRET_KEY=sk_...

3. **Create the database schema** — run each file in order with `run-sql.ts`
   (safer than `psql -f` on Windows, and avoids the Neon web editor's
   multi-statement issue):

       npx tsx scripts/run-sql.ts db/schema.sql
       npx tsx scripts/run-sql.ts db/views.sql
       npx tsx scripts/run-sql.ts db/materialized.sql
       npx tsx scripts/run-sql.ts db/cases.sql

4. **Load data**

       npx tsx scripts/ingest.ts --snapshot YYYY-MM-DD \
         --children  data/children.csv \
         --providers data/providers.csv \
         --placements data/placements.csv

   This also refreshes the materialized view, so re-run it after every new
   snapshot rather than editing the data tables directly.

   The ingest is transactional and idempotent: it validates every row, rolls
   back entirely on failure, and can be re-run safely.

5. **Create user accounts** in the Clerk dashboard (Users → Create user).
   Sign-ups are closed; only these accounts can log in.

6. **(Optional) Grant the admin role** to any account that should see the
   all-cases admin view instead of the personal dashboard:

       npx tsx scripts/set-admin.ts <email|username|user_id> admin

   Same command with `user` instead of `admin` revokes it. The role can also
   be set by hand in the Clerk dashboard, under that user's **Private**
   metadata: `{ "role": "admin" }`.

7. **Run**

       npm run dev

## Login credentials (development)

| Role | Username | Password |
|---|---|---|
| **Admin** | `admin` | `admin` |
| **Test user** | `testuser` | `testpass` |

The admin account lands on the all-cases admin view (see [Admin](#what-it-does));
the test user gets the regular personal dashboard.

## Testing

    npm test              # everything
    npm run test:unit     # pure functions, no database
    npm run test:integration  # real database — cases, ingest pipeline

Integration tests write real rows (clearly-fake IDs) to whatever `DATABASE_URL`
points at and clean them up afterward, including re-refreshing the materialized
view — don't point this at a database you can't afford to touch.
