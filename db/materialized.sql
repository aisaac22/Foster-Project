-- ============================================================================
-- Materialized v_provider_service_history + dependent views.
--
-- Run this from a terminal via psql, NOT the Neon web editor (the editor was
-- mangling the multi-statement run):
--
--   psql "$env:DATABASE_URL" -f db/materialized.sql        (PowerShell)
--
-- The heavy day-by-day active-days calculation is computed ONCE here and
-- stored. Pages then read stored rows (milliseconds) instead of recomputing
-- (17 seconds). Refresh after each data load — see the REFRESH line at the end
-- and the note about wiring it into ingest.
--
-- Snapshot date is hardcoded to 2026-07-01. When you load a new snapshot,
-- change every '2026-07-01' below to the new date and re-run this file.
-- (The ingest can do this automatically later; for now it's a manual edit.)
-- ============================================================================

drop view if exists v_provider_service_history cascade;
drop materialized view if exists v_provider_service_history cascade;

create materialized view v_provider_service_history as
with pl as (
  select
    p.id_provider,
    count(*)                                         as n_placements,
    count(distinct p.id_child)                       as n_children_served,
    min(p.start_date)                                as first_placement_date,
    max(p.start_date)                                as last_placement_start,
    max(coalesce(p.end_date, date '2026-07-01'))     as last_placement_end,
    count(*) filter (where p.end_date is null)       as n_open_placements,
    count(*) filter (where p.is_short_stay)          as n_short_stays,
    sum(p.days_in_placement)                         as total_placement_days,
    avg(p.days_in_placement)::numeric(10,1)          as avg_placement_days
  from v_placements_enriched p
  where p.id_provider is not null
  group by p.id_provider
),
active as (
  select id_provider, count(*) as n_days_active_calc
  from (
    select distinct p.id_provider, gs::date as d
    from placements p
    cross join lateral generate_series(
      p.start_date,
      coalesce(p.end_date, date '2026-07-01'),
      interval '1 day'
    ) gs
    where p.id_provider is not null
  ) days
  group by id_provider
)
select
  pr.id_provider,
  co.name                                 as county,
  pr.county_id,
  pr.license_start_date,
  pr.license_end_date,
  (pr.license_end_date is null
   or pr.license_end_date > date '2026-07-01')       as is_currently_licensed,
  coalesce(pr.license_end_date, date '2026-07-01') - pr.license_start_date
                                          as days_licensed_calc,
  coalesce(a.n_days_active_calc, 0)       as days_active_calc,
  round(
    coalesce(a.n_days_active_calc, 0)::numeric
    / nullif(coalesce(pr.license_end_date, date '2026-07-01')
             - pr.license_start_date, 0), 3
  )                                       as utilization_rate,
  coalesce(pl.n_placements, 0)            as n_placements,
  coalesce(pl.n_children_served, 0)       as n_children_served,
  coalesce(pl.n_short_stays, 0)           as n_short_stays,
  pl.avg_placement_days,
  pl.first_placement_date,
  pl.first_placement_date - pr.license_start_date  as days_to_first_placement,
  pl.last_placement_end,
  coalesce(pl.n_open_placements, 0) > 0   as has_child_now,
  case
    when coalesce(pl.n_open_placements, 0) > 0 then 0
    else date '2026-07-01' - pl.last_placement_end
  end                                     as days_idle,
  ap.min_age                              as current_min_age,
  ap.max_age                              as current_max_age
from providers pr
left join counties co on co.id = pr.county_id
left join pl on pl.id_provider = pr.id_provider
left join active a on a.id_provider = pr.id_provider
left join provider_age_preferences ap
       on ap.id_provider = pr.id_provider and ap.effective_to is null;

-- Indexes on the stored result — makes single-home lookups instant too.
create unique index v_psh_provider_idx on v_provider_service_history (id_provider);
create index v_psh_county_idx on v_provider_service_history (county_id);

-- ---------------------------------------------------------------------------
-- Dependent views, recreated to read from the materialized base.
-- These were dropped by the cascade above. Logic is unchanged.
-- ---------------------------------------------------------------------------

create view v_provider_at_risk as
with tenure_stats as (
  select width_bucket(days_licensed_calc, 0, 3650, 5) as tenure_bucket,
         avg(utilization_rate) as band_avg_util
  from v_provider_service_history
  where is_currently_licensed and days_licensed_calc > 0
  group by 1
)
select
  h.id_provider,
  h.county,
  round(h.days_licensed_calc / 365.0, 1) as tenure_years,
  h.n_placements,
  h.utilization_rate,
  h.days_idle,
  h.has_child_now,
  (h.n_placements = 0) as never_placed,
  round(
      least(45, greatest(0,
        (coalesce(t.band_avg_util, 0.5) - h.utilization_rate) * 90))
    + (case when h.n_placements = 0 then 25 else 0 end)
    + least(20, greatest(0, h.days_idle - 60) / 30.0 * 5)
    + greatest(0, (730 - h.days_licensed_calc) / 730.0) * 10
  , 1) as risk_score
from v_provider_service_history h
left join tenure_stats t
  on t.tenure_bucket = width_bucket(h.days_licensed_calc, 0, 3650, 5)
where h.is_currently_licensed
order by risk_score desc;

create view v_provider_utilization as
select
  h.*,
  case
    when h.n_placements = 0            then 'never used'
    when h.utilization_rate < 0.10     then 'very low (<10%)'
    when h.utilization_rate < 0.35     then 'low (10-35%)'
    when h.utilization_rate < 0.70     then 'moderate (35-70%)'
    when h.utilization_rate < 0.90     then 'high (70-90%)'
    else                                    'saturated (90%+)'
  end as utilization_band
from v_provider_service_history h;

create view v_county_supply_demand as
with origin as (
  select p.removal_county_id as county_id,
         count(*) filter (where p.is_ongoing) as children_from_county,
         count(*) filter (where p.is_ongoing and p.is_out_of_county) as placed_away,
         count(*) filter (where p.is_ongoing and p.resource_type = 'kin') as open_kin,
         count(*) filter (where p.is_ongoing and p.resource_type = 'nonfamily') as open_nonfamily
  from v_placements_enriched p group by 1
),
located as (
  select p.placement_county_id as county_id,
         count(*) filter (where p.is_ongoing and p.resource_type = 'foster_home')
           as children_in_local_homes
  from v_placements_enriched p group by 1
),
supply as (
  select h.county_id,
         count(*) filter (where h.is_currently_licensed) as homes_licensed,
         count(*) filter (where h.is_currently_licensed and h.has_child_now) as homes_with_child
  from v_provider_service_history h group by 1
)
select c.name as county,
       coalesce(o.children_from_county, 0)   as children_from_county,
       coalesce(l.children_in_local_homes,0) as children_in_local_homes,
       coalesce(s.homes_licensed, 0)         as homes_licensed,
       coalesce(s.homes_with_child, 0)       as homes_with_child,
       round(coalesce(l.children_in_local_homes,0)::numeric
             / nullif(s.homes_licensed,0), 2) as load_per_home,
       round(coalesce(o.placed_away,0)::numeric
             / nullif(o.children_from_county,0), 3) as export_rate,
       round(coalesce(o.open_kin,0)::numeric
             / nullif(o.children_from_county,0), 3) as kin_rate,
       coalesce(o.children_from_county,0) - coalesce(l.children_in_local_homes,0)
                                              as net_outflow
from counties c
left join origin  o on o.county_id = c.id
left join located l on l.county_id = c.id
left join supply  s on s.county_id = c.id
order by net_outflow desc;

create view v_age_capacity_gap as
with demand as (
  select ce.removal_county_id as county_id, b.id as band_id,
         count(*) as children_in_band
  from v_children_enriched ce
  join age_bands b on ce.current_age between b.age_lo and b.age_hi
  where ce.is_in_care
  group by ce.removal_county_id, b.id
),
supply as (
  select h.county_id, b.id as band_id,
         count(*) as homes_accepting_band,
         count(*) filter (where not h.has_child_now) as homes_available_now
  from v_provider_service_history h
  join age_bands b
    on h.current_min_age <= b.age_hi and h.current_max_age >= b.age_lo
  where h.is_currently_licensed
  group by h.county_id, b.id
)
select
  c.name                             as county,
  c.id                               as county_id,
  b.label                            as age_band,
  b.sort_order,
  coalesce(d.children_in_band, 0)    as children_in_band,
  coalesce(s.homes_accepting_band, 0) as homes_accepting_band,
  coalesce(s.homes_available_now, 0)  as homes_available_now,
  round(coalesce(d.children_in_band, 0)::numeric
        / nullif(s.homes_accepting_band, 0), 2) as children_per_accepting_home,
  greatest(coalesce(d.children_in_band, 0)
           - coalesce(s.homes_available_now, 0), 0) as unmet_need_estimate
from counties c
cross join age_bands b
left join demand d on d.county_id = c.id and d.band_id = b.id
left join supply s on s.county_id = c.id and s.band_id = b.id;

-- Confirm it built.
select 'materialized rows:' as label, count(*) from v_provider_service_history;
