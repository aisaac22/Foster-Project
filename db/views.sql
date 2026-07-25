-- ============================================================================
-- Analytics layer — recruitment & retention
--
-- Layer 1  foundation views (enrichment, no aggregation)
-- Layer 2  retention views  (are we keeping the homes we have?)
-- Layer 3  recruitment views (which homes do we need, and where?)
-- Layer 4  data quality
--
-- Every open-ended interval is measured against current_snapshot_date().
-- ============================================================================


-- ============================================================================
-- LAYER 1 — FOUNDATION
-- ============================================================================

-- Estimated date of birth, derived from removal_date and age_at_removal.
-- Accurate to within one year. Good enough for age banding; do NOT use it
-- for anything that needs an exact birthday.
create or replace view v_children_enriched as
select
  e.id                                   as episode_id,
  e.id_child,
  e.episode_index,
  e.removal_date,
  e.discharge_date,
  e.discharge_date is null               as is_in_care,
  e.age_at_removal,
  (e.removal_date - make_interval(years => e.age_at_removal))::date as dob_est,
  coalesce(e.discharge_date, current_snapshot_date()) - e.removal_date
                                         as days_in_care,
  extract(year from age(
    coalesce(e.discharge_date, current_snapshot_date()),
    (e.removal_date - make_interval(years => e.age_at_removal))::date
  ))::int                                as current_age,
  c.name                                 as removal_county,
  e.removal_county_id
from episodes e
left join counties c on c.id = e.removal_county_id;


create or replace view v_placements_enriched as
select
  p.id                                    as placement_id,
  p.id_child,
  p.episode_id,
  p.placement_index,
  p.start_date,
  p.end_date,
  p.end_date is null                      as is_ongoing,
  coalesce(p.end_date, current_snapshot_date()) - p.start_date
                                          as days_in_placement,
  p.resource_type,
  p.id_provider,
  rc.name                                 as removal_county,
  pc.name                                 as placement_county,
  p.removal_county_id,
  p.placement_county_id,
  (p.removal_county_id is not null
   and p.placement_county_id is not null
   and p.removal_county_id <> p.placement_county_id)
                                          as is_out_of_county,
  extract(year from age(p.start_date, ce.dob_est))::int
                                          as age_at_placement_start,
  -- A closed placement under 30 days that was NOT the child's exit from care
  -- is a reasonable disruption proxy.
  (p.end_date is not null
   and (p.end_date - p.start_date) < 30
   and (ce.discharge_date is null or p.end_date < ce.discharge_date))
                                          as is_short_stay
from placements p
left join counties rc on rc.id = p.removal_county_id
left join counties pc on pc.id = p.placement_county_id
left join v_children_enriched ce on ce.episode_id = p.episode_id;


-- One row per licensed home: the spine of every retention metric.
create or replace view v_provider_service_history as
with pl as (
  select
    p.id_provider,
    count(*)                                         as n_placements,
    count(distinct p.id_child)                       as n_children_served,
    min(p.start_date)                                as first_placement_date,
    max(p.start_date)                                as last_placement_start,
    max(coalesce(p.end_date, current_snapshot_date())) as last_placement_end,
    count(*) filter (where p.end_date is null)       as n_open_placements,
    count(*) filter (where p.is_short_stay)          as n_short_stays,
    sum(p.days_in_placement)                         as total_placement_days,
    avg(p.days_in_placement)::numeric(10,1)          as avg_placement_days
  from v_placements_enriched p
  where p.id_provider is not null
  group by p.id_provider
),
-- Distinct calendar days with at least one child placed (handles overlaps).
active as (
  select id_provider, count(*) as n_days_active_calc
  from (
    select distinct p.id_provider, gs::date as d
    from placements p
    cross join lateral generate_series(
      p.start_date,
      coalesce(p.end_date, current_snapshot_date()),
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
   or pr.license_end_date > current_snapshot_date())  as is_currently_licensed,

  coalesce(pr.license_end_date, current_snapshot_date()) - pr.license_start_date
                                          as days_licensed_calc,
  coalesce(a.n_days_active_calc, 0)       as days_active_calc,
  round(
    coalesce(a.n_days_active_calc, 0)::numeric
    / nullif(coalesce(pr.license_end_date, current_snapshot_date())
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
    else current_snapshot_date() - pl.last_placement_end
  end                                     as days_idle,

  ap.min_age                              as current_min_age,
  ap.max_age                              as current_max_age
from providers pr
left join counties co on co.id = pr.county_id
left join pl on pl.id_provider = pr.id_provider
left join active a on a.id_provider = pr.id_provider
left join provider_age_preferences ap
       on ap.id_provider = pr.id_provider and ap.effective_to is null;


-- ============================================================================
-- LAYER 2 — RETENTION
-- ============================================================================

-- Cohort survival. Structured for Kaplan-Meier: `is_event` marks a genuine
-- exit, `is_censored` marks a home still licensed at the snapshot. Averaging
-- tenure without this distinction understates retention badly.
create or replace view v_provider_retention_cohorts as
select
  date_trunc('quarter', h.license_start_date)::date as cohort_quarter,
  date_trunc('year',    h.license_start_date)::date as cohort_year,
  h.county,
  h.county_id,
  h.id_provider,
  h.license_start_date,
  h.license_end_date,
  h.days_licensed_calc                    as tenure_days,
  round(h.days_licensed_calc / 30.44, 1)  as tenure_months,
  not h.is_currently_licensed             as is_event,      -- exited
  h.is_currently_licensed                 as is_censored,   -- still active
  h.n_placements > 0                      as ever_placed,
  h.utilization_rate,
  h.days_to_first_placement
from v_provider_service_history h
where h.license_start_date is not null;


-- Utilization banding. "Never used" is the single strongest attrition
-- signal in foster home data — a licensed home that never receives a child
-- is a recruitment investment that produced nothing.
create or replace view v_provider_utilization as
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


-- THE OUTREACH QUEUE. Currently licensed homes carrying retention risk,
-- scored so the list can be worked top-down.
create or replace view v_provider_at_risk as
select
  h.id_provider,
  h.county,
  h.license_start_date,
  h.license_end_date,
  h.days_licensed_calc,
  h.n_placements,
  h.days_to_first_placement,
  h.days_idle,
  h.n_short_stays,
  h.utilization_rate,
  h.has_child_now,

  -- risk factors
  (h.n_placements = 0 and h.days_licensed_calc > 180)          as f_never_placed,
  (h.n_placements > 0 and not h.has_child_now
     and h.days_idle > 180)                                    as f_long_idle,
  (h.days_to_first_placement > 270)                            as f_slow_start,
  (h.n_short_stays >= 2)                                       as f_repeat_disruption,
  (h.license_end_date is not null
     and h.license_end_date <= current_snapshot_date() + 90)   as f_expiring_soon,
  (h.utilization_rate < 0.10 and h.days_licensed_calc > 365)   as f_chronic_underuse,

  (  (h.n_placements = 0 and h.days_licensed_calc > 180)::int * 3
   + (h.n_placements > 0 and not h.has_child_now
        and h.days_idle > 180)::int                      * 3
   + (h.days_to_first_placement > 270)::int              * 2
   + (h.n_short_stays >= 2)::int                         * 2
   + (h.license_end_date is not null
        and h.license_end_date <= current_snapshot_date() + 90)::int * 2
   + (h.utilization_rate < 0.10
        and h.days_licensed_calc > 365)::int             * 1
  ) as risk_score
from v_provider_service_history h
where h.is_currently_licensed;


-- Licenses coming up for renewal — retention work has a deadline.
create or replace view v_license_expiry_pipeline as
select
  h.id_provider,
  h.county,
  h.license_end_date,
  h.license_end_date - current_snapshot_date() as days_until_expiry,
  case
    when h.license_end_date - current_snapshot_date() <= 30  then '0-30 days'
    when h.license_end_date - current_snapshot_date() <= 60  then '31-60 days'
    when h.license_end_date - current_snapshot_date() <= 90  then '61-90 days'
    when h.license_end_date - current_snapshot_date() <= 180 then '91-180 days'
    else '180+ days'
  end as expiry_bucket,
  h.n_placements,
  h.utilization_rate,
  h.has_child_now
from v_provider_service_history h
where h.is_currently_licensed
  and h.license_end_date is not null
  and h.license_end_date <= current_snapshot_date() + 180;


-- Net capacity change over time. If exits outpace new licenses, recruitment
-- is running to stand still.
create or replace view v_provider_churn_monthly as
with months as (
  select generate_series(
    date_trunc('month', (select min(license_start_date) from providers)),
    date_trunc('month', current_snapshot_date()),
    interval '1 month'
  )::date as month
),
grid as (
  select m.month, c.id as county_id, c.name as county
  from months m cross join counties c
)
select
  g.month,
  g.county,
  g.county_id,
  count(pr_in.id_provider)  as homes_licensed,
  count(pr_out.id_provider) as homes_exited,
  count(pr_in.id_provider) - count(pr_out.id_provider) as net_change,
  (select count(*) from providers p2
    where p2.county_id = g.county_id
      and p2.license_start_date <= (g.month + interval '1 month - 1 day')::date
      and (p2.license_end_date is null
           or p2.license_end_date > (g.month + interval '1 month - 1 day')::date)
  ) as homes_active_eom
from grid g
left join providers pr_in
       on pr_in.county_id = g.county_id
      and date_trunc('month', pr_in.license_start_date)::date = g.month
left join providers pr_out
       on pr_out.county_id = g.county_id
      and date_trunc('month', pr_out.license_end_date)::date = g.month
      and pr_out.license_end_date <= current_snapshot_date()
group by g.month, g.county, g.county_id;


-- ============================================================================
-- LAYER 3 — RECRUITMENT
-- ============================================================================

-- Where is the shortage, and how big is it?
create or replace view v_county_supply_demand as
with demand as (
  select
    ce.removal_county_id as county_id,
    count(*) filter (where ce.is_in_care)                        as children_in_care,
    count(*) filter (where ce.removal_date >= current_snapshot_date() - 365)
                                                                 as entries_last_12mo,
    count(*) filter (where ce.is_in_care and ce.current_age >= 13)
                                                                 as teens_in_care
  from v_children_enriched ce
  group by ce.removal_county_id
),
supply as (
  select
    h.county_id,
    count(*) filter (where h.is_currently_licensed)              as homes_licensed,
    count(*) filter (where h.is_currently_licensed
                       and h.has_child_now)                      as homes_with_child,
    count(*) filter (where h.is_currently_licensed
                       and h.n_placements = 0)                   as homes_never_used,
    count(*) filter (where h.is_currently_licensed
                       and h.current_max_age >= 13)              as homes_accepting_teens,
    avg(h.utilization_rate) filter (where h.is_currently_licensed)
                                                                 as avg_utilization
  from v_provider_service_history h
  group by h.county_id
),
flow as (
  select
    p.removal_county_id as county_id,
    count(*) filter (where p.is_ongoing)                         as open_placements,
    count(*) filter (where p.is_ongoing and p.is_out_of_county)  as open_out_of_county,
    count(*) filter (where p.is_ongoing
                       and p.resource_type = 'nonfamily')        as open_nonfamily
  from v_placements_enriched p
  group by p.removal_county_id
)
select
  c.id   as county_id,
  c.name as county,
  coalesce(d.children_in_care, 0)      as children_in_care,
  coalesce(d.entries_last_12mo, 0)     as entries_last_12mo,
  coalesce(d.teens_in_care, 0)         as teens_in_care,
  coalesce(s.homes_licensed, 0)        as homes_licensed,
  coalesce(s.homes_with_child, 0)      as homes_with_child,
  coalesce(s.homes_never_used, 0)      as homes_never_used,
  coalesce(s.homes_accepting_teens, 0) as homes_accepting_teens,
  round(s.avg_utilization, 3)          as avg_utilization,
  round(coalesce(d.children_in_care, 0)::numeric
        / nullif(s.homes_licensed, 0), 2)      as children_per_licensed_home,
  round(coalesce(f.open_out_of_county, 0)::numeric
        / nullif(f.open_placements, 0), 3)     as out_of_county_rate,
  round(coalesce(f.open_nonfamily, 0)::numeric
        / nullif(f.open_placements, 0), 3)     as nonfamily_rate
from counties c
left join demand d on d.county_id = c.id
left join supply s on s.county_id = c.id
left join flow   f on f.county_id = c.id;


-- THE RECRUITMENT TARGETING VIEW.
-- For each county x age band: children needing placement vs. homes whose
-- CURRENT stated preferences would accept a child of that age.
-- A ratio well above 1 tells a recruiter exactly who to go find.
create or replace view v_age_capacity_gap as
with demand as (
  select
    ce.removal_county_id as county_id,
    b.id                 as band_id,
    count(*)             as children_in_band
  from v_children_enriched ce
  join age_bands b
    on ce.current_age between b.age_lo and b.age_hi
  where ce.is_in_care
  group by ce.removal_county_id, b.id
),
supply as (
  select
    h.county_id,
    b.id       as band_id,
    count(*)   as homes_accepting_band,
    count(*) filter (where not h.has_child_now) as homes_available_now
  from v_provider_service_history h
  join age_bands b
    -- interval overlap: home accepts any age within the band
    on h.current_min_age <= b.age_hi
   and h.current_max_age >= b.age_lo
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


-- Origin -> placement county matrix. Counties that export children are
-- your recruitment priority; the volume sizes the ask.
create or replace view v_out_of_county_flow as
select
  rc.name as removal_county,
  pc.name as placement_county,
  p.removal_county_id,
  p.placement_county_id,
  count(*)                                as n_placements,
  count(*) filter (where p.is_ongoing)    as n_open,
  round(avg(p.days_in_placement), 1)      as avg_days,
  count(distinct p.id_child)              as n_children
from v_placements_enriched p
join counties rc on rc.id = p.removal_county_id
join counties pc on pc.id = p.placement_county_id
group by rc.name, pc.name, p.removal_county_id, p.placement_county_id;


-- Placement type mix. A rising nonfamily share — especially for young
-- children — is the clearest signal that family homes have run out.
create or replace view v_placement_type_mix as
select
  coalesce(rc.name, 'Unknown') as removal_county,
  b.label                      as age_band,
  b.sort_order,
  date_trunc('quarter', p.start_date)::date as quarter,
  count(*)                                                     as n_placements,
  count(*) filter (where p.resource_type = 'kin')              as n_kin,
  count(*) filter (where p.resource_type = 'foster_home')      as n_foster_home,
  count(*) filter (where p.resource_type = 'nonfamily')        as n_nonfamily,
  round(count(*) filter (where p.resource_type = 'kin')::numeric
        / nullif(count(*), 0), 3)                              as pct_kin,
  round(count(*) filter (where p.resource_type = 'nonfamily')::numeric
        / nullif(count(*), 0), 3)                              as pct_nonfamily
from v_placements_enriched p
left join counties rc on rc.id = p.removal_county_id
join age_bands b on p.age_at_placement_start between b.age_lo and b.age_hi
group by rc.name, b.label, b.sort_order, date_trunc('quarter', p.start_date);


-- Does recruitment convert into actual capacity, and does it stick?
-- Separates a recruitment problem from a retention problem.
create or replace view v_recruitment_funnel as
select
  date_trunc('year', h.license_start_date)::date as cohort_year,
  h.county,
  count(*)                                              as homes_licensed,
  count(*) filter (where h.n_placements > 0)            as homes_ever_placed,
  round(count(*) filter (where h.n_placements > 0)::numeric
        / nullif(count(*), 0), 3)                       as first_placement_rate,
  round(avg(h.days_to_first_placement), 0)              as avg_days_to_first_placement,
  count(*) filter (where h.days_licensed_calc >= 365)   as survived_12mo,
  count(*) filter (where h.days_licensed_calc >= 730)   as survived_24mo,
  round(avg(h.utilization_rate), 3)                     as avg_utilization,
  round(avg(h.n_children_served), 1)                    as avg_children_served
from v_provider_service_history h
where h.license_start_date is not null
group by date_trunc('year', h.license_start_date), h.county;


-- Placement stability per child. High placement counts indicate the system
-- is churning children through homes — bad for kids, and a leading cause of
-- foster parent burnout.
create or replace view v_placement_stability as
select
  ce.id_child,
  ce.removal_county,
  ce.age_at_removal,
  ce.current_age,
  ce.is_in_care,
  ce.days_in_care,
  count(p.placement_id)                                    as n_placements,
  count(p.placement_id) filter (where p.is_short_stay)     as n_short_stays,
  round(count(p.placement_id)::numeric
        / nullif(ce.days_in_care, 0) * 365.25, 2)          as placements_per_year,
  min(p.start_date)                                        as first_placement,
  max(p.start_date)                                        as latest_placement
from v_children_enriched ce
left join v_placements_enriched p on p.episode_id = ce.episode_id
group by ce.id_child, ce.removal_county, ce.age_at_removal,
         ce.current_age, ce.is_in_care, ce.days_in_care;


-- ============================================================================
-- LAYER 4 — DATA QUALITY
-- Compares values we compute against the derived columns the source supplies.
-- Run after every load; a growing discrepancy count means an upstream change.
-- ============================================================================

create or replace view v_dq_provider_derived_mismatch as
select
  s.id_provider::bigint,
  s.n_days_licensed::int  as source_days_licensed,
  h.days_licensed_calc    as calc_days_licensed,
  s.n_days_active::int    as source_days_active,
  h.days_active_calc      as calc_days_active,
  abs(s.n_days_licensed::int - h.days_licensed_calc) as licensed_delta,
  abs(s.n_days_active::int  - h.days_active_calc)    as active_delta
from stg_providers s
join v_provider_service_history h on h.id_provider = s.id_provider::bigint
where s.load_id = (select max(id) from data_loads where status = 'complete')
  and (abs(s.n_days_licensed::int - h.days_licensed_calc) > 1
    or abs(s.n_days_active::int  - h.days_active_calc)  > 1);

create or replace view v_dq_orphans as
select 'placement without episode' as issue, p.id::text as ref
from placements p where p.episode_id is null
union all
select 'foster_home placement, unknown provider', p.id::text
from placements p
where p.resource_type = 'foster_home'
  and p.id_provider not in (select id_provider from providers)
union all
select 'placement county disagrees with episode removal county', p.id::text
from placements p
join episodes e on e.id = p.episode_id
where p.removal_county_id is distinct from e.removal_county_id
union all
select 'placement outside episode window', p.id::text
from placements p
join episodes e on e.id = p.episode_id
where p.start_date < e.removal_date
   or (e.discharge_date is not null and p.start_date > e.discharge_date);

-- Placement_index should be dense and start at 1 for every child.
create or replace view v_dq_placement_index_gaps as
select
  id_child,
  count(*)              as n_placements,
  min(placement_index)  as min_index,
  max(placement_index)  as max_index
from placements
group by id_child
having min(placement_index) <> 1
    or max(placement_index) <> count(*);
