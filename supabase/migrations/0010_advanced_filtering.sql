-- 0010_advanced_filtering.sql
--
-- C7b anchor. Extends the provider search surface with advanced filtering:
--   - gender column on provider_profiles (UK care-sector values)
--   - array-based multi-select filters for services, capabilities, certifications
--   - hourly rate range filtering (min/max)
--   - replaces the single-slug service_slug/capability_slug params with arrays
--
-- DESIGN NOTES
-- ------------
-- 1. Gender column uses a CHECK constraint with values appropriate for the UK
--    care sector. "prefer_not_to_say" is included for profile completeness but
--    is deliberately excluded from search filter UI - the RPC still accepts it
--    to avoid a silent mismatch if someone passes it.
--
-- 2. The existing app.search_providers signature changes: service_slug and
--    capability_slug are replaced by text[] arrays, and new filter params are
--    added. Because PostgreSQL distinguishes function overloads by argument
--    types, we DROP the old signature first to avoid stale overloads lingering.
--
-- 3. Rate filtering uses the existing hourly_rate_pence column on
--    provider_profiles (migration 0004). No new rate columns needed.
--
-- 4. Certification filtering joins through provider_certifications (which is
--    soft-deleted) and only matches active (deleted_at is null) rows,
--    consistent with the public_read RLS policy on that table.

-- =============================================================================
-- Gender column on provider_profiles
-- =============================================================================
alter table public.provider_profiles
  add column if not exists gender text;

alter table public.provider_profiles
  drop constraint if exists provider_profiles_gender_check;
alter table public.provider_profiles
  add constraint provider_profiles_gender_check
  check (gender is null or gender in ('female', 'male', 'non_binary', 'prefer_not_to_say'));

-- Grant the new column to anon for directory display (gender is not sensitive
-- in the care-sector directory context - clients filter by it for personal care).
grant select (gender) on public.provider_profiles to anon, authenticated;

-- Index for gender filter performance (partial, verified-only).
create index if not exists provider_profiles_gender_idx
  on public.provider_profiles (gender)
  where gender is not null and verified_at is not null and deleted_at is null;

-- Index for rate range filtering.
create index if not exists provider_profiles_hourly_rate_idx
  on public.provider_profiles (hourly_rate_pence)
  where hourly_rate_pence is not null and verified_at is not null and deleted_at is null;

-- =============================================================================
-- Drop old search_providers signatures before replacing
-- =============================================================================
-- Drop the public wrapper first (it depends on the app version).
drop function if exists public.search_providers(
  text, double precision, double precision, int, text, text, int, int
);
-- Drop the app version.
drop function if exists app.search_providers(
  text, double precision, double precision, int, text, text, int, int
);

-- =============================================================================
-- app.search_providers v2 (expanded filters)
-- =============================================================================
create or replace function app.search_providers(
  query               text        default null,
  near_lat            double precision default null,
  near_lng            double precision default null,
  radius_km           int         default null,
  filter_services     text[]      default null,
  filter_capabilities text[]      default null,
  filter_certifications text[]    default null,
  filter_gender       text        default null,
  filter_rate_min     int         default null,
  filter_rate_max     int         default null,
  limit_count         int         default null,
  offset_count        int         default null
)
returns table (
  id                uuid,
  headline          text,
  bio               text,
  city              text,
  country           char(2),
  hourly_rate_pence int,
  years_experience  int,
  gender            text,
  latitude          double precision,
  longitude         double precision,
  distance_km       double precision,
  verified_at       timestamptz
)
language sql
stable
security definer
set search_path = public, app
as $$
  with clamp as (
    select
      least(coalesce(radius_km, 25), 200) as radius_km_clamped,
      least(greatest(coalesce(offset_count, 0), 0), 10000) as offset_clamped,
      least(coalesce(limit_count, 20), 100) as limit_clamped,
      '%' || app.escape_like(query) || '%' as query_pattern
  )
  select
    pp.id,
    pp.headline,
    pp.bio,
    pp.city,
    pp.country,
    pp.hourly_rate_pence,
    pp.years_experience,
    pp.gender,
    pp.latitude,
    pp.longitude,
    case
      when near_lat is not null
       and near_lng is not null
       and pp.latitude is not null
       and pp.longitude is not null
      then round(
        (public.earth_distance(
           public.ll_to_earth(near_lat, near_lng),
           public.ll_to_earth(pp.latitude, pp.longitude)
         ) / 1000)::numeric,
        2
      )::double precision
      else null
    end as distance_km,
    pp.verified_at
  from public.provider_profiles pp
  cross join clamp c
  where pp.verified_at is not null
    and pp.deleted_at is null
    -- Text search
    and (
      query is null
      or query = ''
      or pp.headline ilike c.query_pattern
      or pp.bio      ilike c.query_pattern
      or pp.city     ilike c.query_pattern
    )
    -- Geo radius
    and (
      near_lat is null
      or near_lng is null
      or radius_km is null
      or (
        pp.latitude is not null
        and pp.longitude is not null
        and public.earth_box(
              public.ll_to_earth(near_lat, near_lng),
              c.radius_km_clamped * 1000
            ) @> public.ll_to_earth(pp.latitude, pp.longitude)
        and public.earth_distance(
              public.ll_to_earth(near_lat, near_lng),
              public.ll_to_earth(pp.latitude, pp.longitude)
            ) <= c.radius_km_clamped * 1000
      )
    )
    -- Service filter (array of slugs, ALL must match)
    and (
      filter_services is null
      or array_length(filter_services, 1) is null
      or not exists (
        select unnest(filter_services)
        except
        select sc.slug
        from public.provider_services ps
        join public.service_categories sc on sc.id = ps.service_category_id
        where ps.provider_id = pp.id
      )
    )
    -- Capability filter (array of slugs, ALL must match)
    and (
      filter_capabilities is null
      or array_length(filter_capabilities, 1) is null
      or not exists (
        select unnest(filter_capabilities)
        except
        select cap.slug
        from public.provider_capabilities pc
        join public.capabilities cap on cap.id = pc.capability_id
        where pc.provider_id = pp.id
      )
    )
    -- Certification filter (array of slugs, ALL must match, active only)
    and (
      filter_certifications is null
      or array_length(filter_certifications, 1) is null
      or not exists (
        select unnest(filter_certifications)
        except
        select cert.slug
        from public.provider_certifications pcert
        join public.certifications cert on cert.id = pcert.certification_id
        where pcert.provider_id = pp.id
          and pcert.deleted_at is null
      )
    )
    -- Gender filter
    and (
      filter_gender is null
      or pp.gender = filter_gender
    )
    -- Rate range filter
    and (
      filter_rate_min is null
      or pp.hourly_rate_pence >= filter_rate_min
    )
    and (
      filter_rate_max is null
      or pp.hourly_rate_pence <= filter_rate_max
    )
  order by
    case
      when near_lat is not null
       and near_lng is not null
       and pp.latitude is not null
       and pp.longitude is not null
      then public.earth_distance(
             public.ll_to_earth(near_lat, near_lng),
             public.ll_to_earth(pp.latitude, pp.longitude)
           )
      else null
    end asc nulls last,
    pp.verified_at desc
  limit  (select limit_clamped from clamp)
  offset (select offset_clamped from clamp);
$$;

revoke all on function app.search_providers(
  text, double precision, double precision, int,
  text[], text[], text[], text, int, int, int, int
) from public;

grant execute on function app.search_providers(
  text, double precision, double precision, int,
  text[], text[], text[], text, int, int, int, int
) to anon, authenticated;

-- =============================================================================
-- public.search_providers wrapper (PostgREST surface)
-- =============================================================================
create or replace function public.search_providers(
  query               text        default null,
  near_lat            double precision default null,
  near_lng            double precision default null,
  radius_km           int         default null,
  filter_services     text[]      default null,
  filter_capabilities text[]      default null,
  filter_certifications text[]    default null,
  filter_gender       text        default null,
  filter_rate_min     int         default null,
  filter_rate_max     int         default null,
  limit_count         int         default null,
  offset_count        int         default null
)
returns table (
  id                uuid,
  headline          text,
  bio               text,
  city              text,
  country           char(2),
  hourly_rate_pence int,
  years_experience  int,
  gender            text,
  latitude          double precision,
  longitude         double precision,
  distance_km       double precision,
  verified_at       timestamptz
)
language sql
stable
security invoker
set search_path = public, app
as $$
  select *
  from app.search_providers(
    query, near_lat, near_lng, radius_km,
    filter_services, filter_capabilities, filter_certifications,
    filter_gender, filter_rate_min, filter_rate_max,
    limit_count, offset_count
  );
$$;

revoke all on function public.search_providers(
  text, double precision, double precision, int,
  text[], text[], text[], text, int, int, int, int
) from public;

grant execute on function public.search_providers(
  text, double precision, double precision, int,
  text[], text[], text[], text, int, int, int, int
) to anon, authenticated;
