# Foster Care Placement Dashboard

An internal web app for a child welfare agency that turns periodic CSV extracts
into a private, browsable dashboard focused on **foster home recruitment and
retention**. It identifies which licensed homes are most likely to stop
fostering, while they can still be reached, and where the agency is short of
homes relative to the children who need them.

## What it does

The app ingests three CSV extracts (children, placements, providers), loads them
into Postgres as a clean relational model, and computes analytics through SQL
views. Three pages read those views:

- **At-risk homes** — currently licensed foster homes ranked 0–100 by
  likelihood of exiting, based on utilization relative to peers, disruption
  rate, and tenure. Each row shows *why* it was flagged. This is the primary
  screen: retaining an existing home is cheaper than recruiting a new one.
- **Counties** — supply and demand by county, led by *net outflow* (children a
  county cannot house in its own homes), the clearest recruitment target.
- **Provider detail** — one home's full service history and placement timeline.

Access is gated by authentication; only accounts created by an administrator can
sign in.

## Architecture

    CSV extracts
        │  ingest pipeline (validate, normalize, upsert)
        ▼
    Postgres: source of truth
        │  SQL views: the analytics layer / de-facto API
        ▼
    Next.js (App Router, Server Components): pages read views directly

The SQL views *are* the API: each page is a single query against a view, so
adding a metric means writing a view and a page, not a REST layer.

## Tech stack

- **Next.js** (App Router, TypeScript, Server Components)
- **Postgres** (hosted on Neon)
- **node-postgres (pg)** for queries; **Papaparse + Zod** for CSV parsing/validation
- **Clerk** for authentication (closed sign-ups; admin creates all accounts)

## Repository layout

    db/
      schema.sql        tables, constraints, indexes
      views.sql         analytics views (foundation, retention, recruitment, QA)
    scripts/
      ingest.ts         batched CSV ingest pipeline (CLI + reusable function)
    src/
      lib/db.ts         shared connection pool + typed query()
      lib/format.ts     display formatting
      lib/require-user.ts  per-page auth guard
      proxy.ts          Clerk middleware (auth on all routes)
      app/
        at-risk/        the retention worklist
        counties/       supply & demand
        providers/[id]/ provider detail
        sign-in/        Clerk sign-in

## Setup

Requires Node 20.6+ and a Postgres database (Neon works out of the box).

1. **Install**

       npm install

2. **Environment** — create `.env.local`:

       DATABASE_URL=postgresql://...
       NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
       CLERK_SECRET_KEY=sk_...

3. **Create the database schema**

       psql $DATABASE_URL -f db/schema.sql
       psql $DATABASE_URL -f db/views.sql

4. **Load data**

       npx tsx scripts/ingest.ts --snapshot YYYY-MM-DD \
         --children  data/children.csv \
         --providers data/providers.csv \
         --placements data/placements.csv

   The ingest is transactional and idempotent: it validates every row, rolls
   back entirely on failure, and can be re-run safely.

5. **Create user accounts** in the Clerk dashboard (Users → Create user).
   Sign-ups are closed; only these accounts can log in.

6. **Run**

       npm run dev

