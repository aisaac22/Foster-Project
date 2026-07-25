-- ============================================================================
-- Foster care placement analytics — core schema
-- Postgres 14+
--
-- Design notes:
--   * Source CSVs are a SNAPSHOT as of a given date (currently 2026-07-01).
--     Open-ended facts (ongoing placements, current licenses) are stored as
--     NULL end dates, never as the snapshot date.
--   * Derived source columns (placement_length, n_days_licensed, n_days_active,
--     most_recent_age) are NOT stored as authoritative. They land in staging
--     and are used to validate values we compute ourselves.
--   * Provider age preferences are slowly-changing: they describe the home
--     TODAY and may not match historical placements.
-- ============================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Load metadata
-- ---------------------------------------------------------------------------

create table if not exists data_loads (
  id            bigserial primary key,
  snapshot_date date        not null,
  source        text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text        not null default 'running'
                  check (status in ('running','complete','failed')),
  row_counts    jsonb       not null default '{}'::jsonb,
  discrepancies jsonb       not null default '[]'::jsonb
);

create index if not exists data_loads_snapshot_idx
  on data_loads (snapshot_date desc);

-- The "as of" date every open-ended calculation measures against.
create or replace function current_snapshot_date() returns date
language sql stable as $$
  select coalesce(
    (select max(snapshot_date) from data_loads where status = 'complete'),
    current_date
  );
$$;

-- ---------------------------------------------------------------------------
-- Dimensions
-- ---------------------------------------------------------------------------

create table if not exists counties (
  id    serial primary key,
  name  text not null unique,
  fips  text unique
);

do $$ begin
  create type resource_type as enum ('kin', 'foster_home', 'nonfamily');
exception when duplicate_object then null; end $$;

-- Age bands used across recruitment views. Edit to match how your agency
-- actually talks about age groups; every age-based view reads from here.
create table if not exists age_bands (
  id        serial primary key,
  label     text not null unique,
  age_lo    int  not null,
  age_hi    int  not null,
  sort_order int not null,
  check (age_hi >= age_lo)
);

insert into age_bands (label, age_lo, age_hi, sort_order) values
  ('0-2 (infant/toddler)',  0,  2, 1),
  ('3-5 (preschool)',       3,  5, 2),
  ('6-9',                   6,  9, 3),
  ('10-12',                10, 12, 4),
  ('13-15',                13, 15, 5),
  ('16-18 (older teen)',   16, 18, 6)
on conflict (label) do nothing;

-- ---------------------------------------------------------------------------
-- Children and episodes
-- ---------------------------------------------------------------------------

create table if not exists children (
  id_child   bigint primary key,           -- natural key from source system
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per removal episode. Source currently supplies one per child, but
-- re-entry into care is common; episode_index lets that arrive without a
-- schema change.
create table if not exists episodes (
  id                 bigserial primary key,
  id_child           bigint not null references children(id_child) on delete cascade,
  episode_index      int    not null default 1,

  removal_date       date not null,
  discharge_date     date,                  -- NULL = still in care

  -- Nullable: a small number of children in the source have no recorded age.
  age_at_removal     int  check (age_at_removal between 0 and 21),

  -- Age as observed at the snapshot (or at discharge). Stored WITH its
  -- observation date so it stays meaningful across loads.
  age_at_observation int,
  observed_as_of     date,

  removal_county_id  int references counties(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id_child, episode_index),
  check (discharge_date is null or discharge_date >= removal_date)
);

create index if not exists episodes_child_idx   on episodes (id_child);
create index if not exists episodes_removal_idx on episodes (removal_date);
create index if not exists episodes_open_idx    on episodes (discharge_date)
  where discharge_date is null;
create index if not exists episodes_county_idx  on episodes (removal_county_id);

-- ---------------------------------------------------------------------------
-- Providers (licensed foster homes)
-- ---------------------------------------------------------------------------

create table if not exists providers (
  id_provider        bigint primary key,
  license_start_date date,
  license_end_date   date,                  -- NULL = no known end
  county_id          int references counties(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (license_end_date is null or license_start_date is null
         or license_end_date >= license_start_date)
);

create index if not exists providers_county_idx on providers (county_id);
create index if not exists providers_license_idx
  on providers (license_start_date, license_end_date);

-- Slowly-changing: the source note states these are CURRENT preferences and
-- can be changed at any time at the home's request. One row per distinct
-- preference period, built up across snapshots.
create table if not exists provider_age_preferences (
  id             bigserial primary key,
  id_provider    bigint not null references providers(id_provider) on delete cascade,
  min_age        int not null check (min_age between 0 and 17),
  max_age        int not null check (max_age between 1 and 18),
  effective_from date not null,
  effective_to   date,                      -- NULL = current
  check (max_age >= min_age),
  check (effective_to is null or effective_to >= effective_from)
);

-- At most one open preference row per provider, and no overlapping periods.
create unique index if not exists provider_pref_current_idx
  on provider_age_preferences (id_provider)
  where effective_to is null;

alter table provider_age_preferences
  drop constraint if exists provider_pref_no_overlap;
alter table provider_age_preferences
  add constraint provider_pref_no_overlap
  exclude using gist (
    id_provider with =,
    daterange(effective_from, effective_to, '[]') with &&
  );

-- ---------------------------------------------------------------------------
-- Placements
-- ---------------------------------------------------------------------------

create table if not exists placements (
  id                  bigserial primary key,
  id_child            bigint not null references children(id_child) on delete cascade,
  episode_id          bigint references episodes(id) on delete set null,
  placement_index     int  not null,

  start_date          date not null,
  end_date            date,                 -- NULL = ongoing at snapshot

  resource_type       resource_type not null,

  -- Licensed foster home (foster_home placements only).
  id_provider         bigint references providers(id_provider),

  -- Congregate care facility / group home / shelter (nonfamily placements
  -- only). Numbered in a separate 800xxx range by the source system and NOT
  -- present in the providers file — facilities are not recruited or retained,
  -- so they are deliberately kept out of the providers table.
  id_facility         bigint,

  removal_county_id   int references counties(id),
  placement_county_id int references counties(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id_child, placement_index),
  check (end_date is null or end_date >= start_date)
);

-- Each resource type carries exactly one kind of reference:
--   foster_home -> id_provider (a licensed home)
--   nonfamily   -> id_facility (a group home / shelter), optional
--   kin         -> neither
alter table placements drop constraint if exists placements_provider_by_type;
alter table placements add constraint placements_provider_by_type
  check (
       (resource_type = 'foster_home' and id_provider is not null and id_facility is null)
    or (resource_type = 'nonfamily'   and id_provider is null)
    or (resource_type = 'kin'         and id_provider is null and id_facility is null)
  );

create index if not exists placements_child_idx    on placements (id_child, placement_index);
create index if not exists placements_provider_idx on placements (id_provider);
create index if not exists placements_dates_idx    on placements (start_date, end_date);
create index if not exists placements_open_idx     on placements (id_provider)
  where end_date is null;
create index if not exists placements_type_idx     on placements (resource_type);
create index if not exists placements_facility_idx on placements (id_facility)
  where id_facility is not null;
create index if not exists placements_pcounty_idx  on placements (placement_county_id);

-- ---------------------------------------------------------------------------
-- Staging tables — raw CSV rows land here first, typed as text.
-- Nothing downstream reads these; they exist for validation + reconciliation.
-- ---------------------------------------------------------------------------

create table if not exists stg_placements (
  load_id bigint references data_loads(id) on delete cascade,
  row_num int,
  id_child text, placement_start_date text, placement_end_date text,
  resource_type_on_this_placement text, placement_index text,
  removal_county text, placement_county text, id_provider text,
  placement_length text
);

create table if not exists stg_children (
  load_id bigint references data_loads(id) on delete cascade,
  row_num int,
  id_child text, removal_date text, discharge_date text,
  age_at_removal text, most_recent_age text, removal_county text
);

create table if not exists stg_providers (
  load_id bigint references data_loads(id) on delete cascade,
  row_num int,
  id_provider text, license_start_date text, license_end_date text,
  county_provider text, n_days_licensed text, n_days_active text,
  min_age text, max_age text
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['children','episodes','providers','placements'] loop
    execute format(
      'drop trigger if exists %I_touch on %I; '
      'create trigger %I_touch before update on %I '
      'for each row execute function touch_updated_at();',
      t, t, t, t);
  end loop;
end $$;
