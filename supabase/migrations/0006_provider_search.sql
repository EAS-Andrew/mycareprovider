-- 0006_provider_search.sql
--
-- C7a anchor. Adds the geocoded location columns, trigram + geospatial
-- indexes, and the app.search_providers() RPC that powers the public
-- provider directory search (stories 18 + 20).
--
-- DESIGN NOTES / REVIEW FLAGS
-- ---------------------------
-- 1. Extension choice: earthdistance + cube rather than PostGIS. Radius
--    search is the only geospatial workload C7a requires and earthdistance
--    gives us earth_box / earth_distance out of the box with a GiST index,
--    which keeps extension sprawl low per the PID guidance.
--
-- 2. The RPC is STABLE SECURITY INVOKER so anon RLS on provider_profiles and
--    the linking tables applies transparently inside the function body. That
--    means verified-only + non-soft-deleted filtering is reinforced twice:
--    once by the function's own WHERE clause (verified_at is not null) and
--    once by the provider_profiles_public_read RLS policy which also asserts
--    deleted_at is null. The function body cannot reference deleted_at
--    itself because the anon column grant on provider_profiles deliberately
--    omits it (same constraint 0005 documented in design note 6); RLS is the
--    load-bearing check for soft-delete visibility.
--
-- 3. Column grants: the new public-facing columns (service_postcode,
--    latitude, longitude, service_radius_km) are explicitly added to the
--    narrow anon + authenticated SELECT grants. geocoded_at is deliberately
--    withheld from anon because it is an ops/backfill column.
--
-- 4. limit_count is capped at 100 inside the function via least() so anon
--    callers cannot blow up a page by passing an enormous limit. The cap is
--    also asserted by the pgTAP test.
--
-- 5. provider_profiles_verified_idx already exists from 0004. The CREATE
--    INDEX IF NOT EXISTS in this migration is a no-op in fresh environments
--    but keeps the spec explicit alongside the other C7a indexes.

-- =============================================================================
-- Extensions
-- =============================================================================
create extension if not exists pg_trgm with schema public;
create extension if not exists cube with schema public;
create extension if not exists earthdistance with schema public;

-- =============================================================================
-- Geocoded location columns on provider_profiles
-- =============================================================================
alter table public.provider_profiles
  add column if not exists service_postcode   text,
  add column if not exists latitude            double precision,
  add column if not exists longitude           double precision,
  add column if not exists service_radius_km   int,
  add column if not exists geocoded_at         timestamptz;

alter table public.provider_profiles
  drop constraint if exists provider_profiles_service_radius_km_check;
alter table public.provider_profiles
  add constraint provider_profiles_service_radius_km_check
  check (service_radius_km is null or (service_radius_km >= 0 and service_radius_km <= 200));

-- =============================================================================
-- Search indexes
-- =============================================================================
create index if not exists provider_profiles_trgm_headline_idx
  on public.provider_profiles using gin (headline public.gin_trgm_ops)
  where deleted_at is null;

create index if not exists provider_profiles_trgm_bio_idx
  on public.provider_profiles using gin (bio public.gin_trgm_ops)
  where deleted_at is null;

-- Partial GiST index covering only rows anon callers can actually see.
create index if not exists provider_profiles_earth_idx
  on public.provider_profiles using gist (public.ll_to_earth(latitude, longitude))
  where latitude is not null
    and longitude is not null
    and verified_at is not null
    and deleted_at is null;

-- Cheap filter for the default "all verified providers" listing. Already
-- created in 0004; kept here with IF NOT EXISTS to keep the C7a spec co-located.
create index if not exists provider_profiles_verified_idx
  on public.provider_profiles (verified_at)
  where verified_at is not null and deleted_at is null;

-- =============================================================================
-- Public column grants (explicit, no blanket grant)
-- =============================================================================
grant select (service_postcode, latitude, longitude, service_radius_km)
  on public.provider_profiles to anon, authenticated;

-- =============================================================================
-- app.search_providers RPC
-- =============================================================================
create or replace function app.search_providers(
  query           text,
  near_lat        double precision,
  near_lng        double precision,
  radius_km       int,
  service_slug    text,
  capability_slug text,
  limit_count     int,
  offset_count    int
)
returns table (
  id                uuid,
  headline          text,
  bio               text,
  city              text,
  country           char(2),
  hourly_rate_pence int,
  years_experience  int,
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
  select
    pp.id,
    pp.headline,
    pp.bio,
    pp.city,
    pp.country,
    pp.hourly_rate_pence,
    pp.years_experience,
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
  where pp.verified_at is not null
    -- soft-delete filtering is enforced by provider_profiles_public_read RLS
    -- (anon has no column grant on deleted_at so we cannot reference it here)
    and (
      query is null
      or query = ''
      or pp.headline ilike '%' || query || '%'
      or pp.bio ilike '%' || query || '%'
      or pp.city ilike '%' || query || '%'
    )
    and (
      near_lat is null
      or near_lng is null
      or radius_km is null
      or (
        pp.latitude is not null
        and pp.longitude is not null
        and public.earth_box(
              public.ll_to_earth(near_lat, near_lng),
              radius_km * 1000
            ) @> public.ll_to_earth(pp.latitude, pp.longitude)
        and public.earth_distance(
              public.ll_to_earth(near_lat, near_lng),
              public.ll_to_earth(pp.latitude, pp.longitude)
            ) <= radius_km * 1000
      )
    )
    and (
      service_slug is null
      or exists (
        select 1
        from public.provider_services ps
        join public.service_categories sc on sc.id = ps.service_category_id
        where ps.provider_id = pp.id
          and sc.slug = service_slug
      )
    )
    and (
      capability_slug is null
      or exists (
        select 1
        from public.provider_capabilities pc
        join public.capabilities c on c.id = pc.capability_id
        where pc.provider_id = pp.id
          and c.slug = capability_slug
      )
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
  limit  least(coalesce(limit_count, 20), 100)
  offset coalesce(offset_count, 0);
$$;

revoke all on function app.search_providers(
  text, double precision, double precision, int, text, text, int, int
) from public;

grant execute on function app.search_providers(
  text, double precision, double precision, int, text, text, int, int
) to anon, authenticated;

-- =============================================================================
-- public.search_providers wrapper (PostgREST surface)
-- =============================================================================
-- PostgREST only exposes schemas listed in config.toml `schemas`, and the
-- `app` schema deliberately stays off that list because it contains internal
-- helpers (current_profile_id, current_role, is_provider_verified,
-- tg_set_updated_at, ...) that should never be reachable over HTTP. This
-- thin wrapper is the single public-facing entry point: it delegates
-- straight to app.search_providers with no added logic, preserving the
-- STABLE SECURITY INVOKER contract so anon RLS on provider_profiles and the
-- linking tables still applies.
create or replace function public.search_providers(
  query           text,
  near_lat        double precision,
  near_lng        double precision,
  radius_km       int,
  service_slug    text,
  capability_slug text,
  limit_count     int,
  offset_count    int
)
returns table (
  id                uuid,
  headline          text,
  bio               text,
  city              text,
  country           char(2),
  hourly_rate_pence int,
  years_experience  int,
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
    service_slug, capability_slug, limit_count, offset_count
  );
$$;

revoke all on function public.search_providers(
  text, double precision, double precision, int, text, text, int, int
) from public;

grant execute on function public.search_providers(
  text, double precision, double precision, int, text, text, int, int
) to anon, authenticated;
