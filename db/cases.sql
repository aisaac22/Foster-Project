-- ============================================================================
-- Case management — recruitment & retention work items.
--
-- A case is owned by the Clerk user who created it. Every account sees every
-- case (open work is visible agency-wide), but each user's dashboard leads
-- with their own. A case is either:
--   retention  -> tied to a home  (id_provider)
--   recruitment -> tied to a county (county_id)
-- never both — enforced by the check constraint below, same pattern as
-- placements_provider_by_type in schema.sql.
--
-- Run via: npx tsx scripts/run-sql.ts db/cases.sql
-- ============================================================================

create table if not exists cases (
  id          bigserial primary key,
  case_type   text not null check (case_type in ('recruitment', 'retention')),
  status      text not null default 'open' check (status in ('open', 'closed')),

  id_provider bigint references providers(id_provider),
  county_id   int references counties(id),

  owner_id    text not null,
  owner_name  text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  closed_at   timestamptz,

  check (
       (case_type = 'retention'   and id_provider is not null and county_id is null)
    or (case_type = 'recruitment' and county_id is not null and id_provider is null)
  )
);

create index if not exists cases_owner_idx    on cases (owner_id);
create index if not exists cases_status_idx   on cases (status);
create index if not exists cases_provider_idx on cases (id_provider) where id_provider is not null;
create index if not exists cases_county_idx   on cases (county_id) where county_id is not null;

drop trigger if exists cases_touch on cases;
create trigger cases_touch before update on cases
  for each row execute function touch_updated_at();

-- Timestamped notes — the working log for a case. Same shape as
-- provider_contacts: one row per entry, author attributed for the record.
create table if not exists case_notes (
  id         bigserial primary key,
  case_id    bigint not null references cases(id) on delete cascade,
  author_id  text not null,
  author_name text,
  note       text not null,
  created_at timestamptz not null default now()
);

create index if not exists case_notes_case_idx on case_notes (case_id, created_at desc);

-- One row per case with its target resolved to a display name (the home's
-- county for retention cases, the chosen county for recruitment cases) and
-- note counts, so pages don't have to re-derive this in application code.
create or replace view v_cases as
select
  c.id,
  c.case_type,
  c.status,
  c.owner_id,
  c.owner_name,
  c.id_provider,
  c.county_id,
  coalesce(rc.name, pc.name)                        as county_name,
  c.created_at,
  c.updated_at,
  c.closed_at,
  (select count(*) from case_notes n where n.case_id = c.id)      as n_notes,
  (select max(n.created_at) from case_notes n where n.case_id = c.id) as last_note_at
from cases c
left join counties  rc on rc.id = c.county_id
left join providers pr on pr.id_provider = c.id_provider
left join counties  pc on pc.id = pr.county_id;
