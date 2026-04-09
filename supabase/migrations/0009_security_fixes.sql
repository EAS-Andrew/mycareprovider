-- 0009_security_fixes.sql
--
-- Forward-only security fixes for the bugs documented in
-- docs/bug-hunt/{rls,auth,storage,contact}-findings.md.
--
-- Migrations 0001-0008 are immutable (already applied to hosted Supabase);
-- every fix below is expressed as a CREATE OR REPLACE / DROP-and-CREATE on
-- policies, triggers, functions, and grants. No DROP TABLE, no DROP COLUMN.
--
-- Groups (referencing the finding IDs in the bug-hunt docs):
--
--   A. Identity / role enforcement
--      - auth#1 / rls#1  handle_new_auth_user coerces non-receiver signups
--      - rls#12           app.current_role() cross-checks profiles.deleted_at
--      - rls#6            revoke ensure_super_admin from anon/authenticated
--
--   B. profiles surface
--      - rls#2 / contact M-4  narrow authenticated column grant on profiles
--                             + app.profile_display_name / app.profile_email
--
--   C. Documents / storage
--      - rls#3 / storage M-5  documents_owner_insert pins unused subject FKs
--      - rls#5                tg_documents_guard early-return for service_role
--      - rls#7                documents_owner_read restores deleted_at IS NULL
--                             + app.soft_delete_document helper
--      - rls#8                tg_provider_certifications_guard
--      - storage C-1          drop lat/lng/service_postcode from anon grant
--      - storage M-5          provider_profiles_owner_insert role gate
--      - rls#14               app.is_public_provider helper + linking-table policies
--      - rls#16 / storage M-2 app.escape_like + search_providers caps
--
--   D. Audit log
--      - rls#4 / auth#6  audit_log_insert_authenticated drops null-actor branch
--                        + app.record_system_audit SECURITY DEFINER helper
--
--   E. Contact / messaging
--      - rls#9 / contact H-1  tg_contact_requests_guard rejects non-admin deleted_at
--      - rls#10 / contact C-6 thread-post rate limit keyed on thread_id
--      - contact H-3          thread-post rate limit moved to AFTER INSERT
--      - rls#11 / contact C-1 tg_contact_requests_rate_limit
--      - contact C-2          tg_meeting_proposals_rate_limit
--      - rls#13               tg_meeting_proposals_guard is SECURITY DEFINER
--      - rls#15               meeting_proposals_party_{read,update} re-check cr.deleted_at
--      - contact M-1          meeting_at lead time >= now() + 1h
--      - contact M-2          AFTER INSERT arm on tg_contact_requests_open_thread
--      - contact H-8          one-accepted-meeting-per-request unique index
--      - contact M-8          contact_thread_posts_party_read re-checks cr.status/deleted_at
--      - contact M-7          app.bump_rate_limit guards window_seconds <= 0
--      - contact H-2          app.vacuum_rate_limit_buckets helper
--
-- =============================================================================

-- =============================================================================
-- A. Identity / role enforcement
-- =============================================================================

-- auth#1 / rls#1: never honour raw_user_meta_data.role on public signups.
-- Only the admin invite path (raw_app_meta_data.invited_by set by
-- auth.admin.inviteUserByEmail on the service-role key) may escalate.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       public.app_role := 'receiver'::public.app_role;
  v_raw_role   text;
  v_invited_by text;
begin
  v_invited_by := (new.raw_app_meta_data ->> 'invited_by');

  if v_invited_by is not null and length(v_invited_by) > 0 then
    v_raw_role := new.raw_user_meta_data ->> 'role';
    if v_raw_role is not null then
      begin
        v_role := v_raw_role::public.app_role;
      exception
        when invalid_text_representation then
          v_role := 'receiver'::public.app_role;
      end;
    end if;
  end if;

  insert into public.profiles (id, role, display_name, email)
  values (
    new.id,
    v_role,
    new.raw_user_meta_data ->> 'display_name',
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- rls#12: current_role() must cross-check profiles.deleted_at so a soft-
-- deleted user loses their role claim immediately, not on JWT refresh.
create or replace function app.current_role()
returns public.app_role
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_live  boolean;
  v_role  public.app_role;
  v_claim text;
begin
  if v_uid is null then
    return null;
  end if;

  select (deleted_at is null), role
    into v_live, v_role
  from public.profiles
  where id = v_uid;

  if v_live is not true then
    return null;
  end if;

  v_claim := nullif(current_setting('request.jwt.claims', true), '');
  if v_claim is not null then
    begin
      v_role := coalesce(
        (v_claim::jsonb ->> 'app_role')::public.app_role,
        v_role
      );
    exception
      when others then
        null;
    end;
  end if;

  return v_role;
end;
$$;

-- rls#6: ensure_super_admin must not be reachable from anon/authenticated.
revoke execute on function public.ensure_super_admin(text) from public;
revoke execute on function public.ensure_super_admin(text) from anon;
revoke execute on function public.ensure_super_admin(text) from authenticated;

-- =============================================================================
-- B. profiles surface
-- =============================================================================

-- rls#2 / contact M-4: narrow the authenticated column grant so that a
-- signed-in receiver cannot harvest provider email columns via the public
-- directory policy. UPDATE / INSERT / DELETE grants keep their full column
-- set so the self-update path still works.
revoke select on public.profiles from authenticated;
grant select (id, role, display_name) on public.profiles to authenticated;

-- Owners and admins still need to read their own (or any) email column.
-- Expose it via narrow SECURITY DEFINER helpers rather than a per-policy
-- column grant (which PostgreSQL does not support).
create or replace function app.profile_display_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public, app
as $$
  select display_name
  from public.profiles
  where id = p_id
    and deleted_at is null;
$$;

revoke all on function app.profile_display_name(uuid) from public;
grant execute on function app.profile_display_name(uuid) to authenticated;

create or replace function app.profile_email(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  v_me    uuid := app.current_profile_id();
  v_role  public.app_role := app.current_role();
  v_email text;
begin
  if v_me is null then
    return null;
  end if;
  if v_me <> p_id and v_role is distinct from 'admin'::public.app_role then
    return null;
  end if;

  select email
    into v_email
  from public.profiles
  where id = p_id
    and deleted_at is null;

  return v_email;
end;
$$;

revoke all on function app.profile_email(uuid) from public;
grant execute on function app.profile_email(uuid) to authenticated;

-- =============================================================================
-- C. Documents / storage
-- =============================================================================

-- rls#3 / storage M-5: pin every non-provider subject FK to NULL for Phase 1a
-- so a malicious provider cannot attribute a document to a victim receiver,
-- care_plan, visit, or message row.
drop policy if exists documents_owner_insert on public.documents;
create policy documents_owner_insert
  on public.documents
  for insert
  to authenticated
  with check (
    uploaded_by = app.current_profile_id()
    and status = 'quarantined'
    and (provider_id is null or provider_id = app.current_profile_id())
    and provider_company_id is null
    and receiver_id         is null
    and care_plan_id        is null
    and visit_id            is null
    and message_id          is null
  );

-- rls#5: the service-role promote path (lib/documents/promote.ts) flips
-- status from quarantined to available via createAdminClient(). The admin
-- client bypasses RLS but not triggers, and the service role carries no
-- app_role claim, so the guard used to raise. Early-return for service_role.
create or replace function public.tg_documents_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;

  if app.current_role() = 'admin'::public.app_role then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'status changes are admin-only'
      using errcode = '42501';
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'undelete is admin-only'
      using errcode = '42501';
  end if;

  if new.uploaded_by         is distinct from old.uploaded_by
  or new.provider_id         is distinct from old.provider_id
  or new.provider_company_id is distinct from old.provider_company_id
  or new.receiver_id         is distinct from old.receiver_id
  or new.care_plan_id        is distinct from old.care_plan_id
  or new.visit_id            is distinct from old.visit_id
  or new.message_id          is distinct from old.message_id
  or new.kind                is distinct from old.kind
  or new.title               is distinct from old.title
  or new.description         is distinct from old.description
  or new.storage_bucket      is distinct from old.storage_bucket
  or new.storage_path        is distinct from old.storage_path
  or new.mime_type           is distinct from old.mime_type
  or new.size_bytes          is distinct from old.size_bytes
  or new.sha256              is distinct from old.sha256
  or new.rejected_reason     is distinct from old.rejected_reason
  or new.expires_at          is distinct from old.expires_at then
    raise exception 'documents are immutable on the owner path (only deleted_at may change)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- rls#7: restore the PID-mandated deleted_at IS NULL on documents_owner_read.
-- The previous 0007 workaround (dropping the filter) leaks soft-deleted rows
-- to their owner under any .select() that forgets to re-add the filter.
-- The soft-delete path itself is now routed through a SECURITY DEFINER helper
-- so the "updated row must remain visible" RLS gotcha does not bite.
drop policy if exists documents_owner_read on public.documents;
create policy documents_owner_read
  on public.documents
  for select
  to authenticated
  using (uploaded_by = app.current_profile_id() and deleted_at is null);

create or replace function app.soft_delete_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_me      uuid := app.current_profile_id();
  v_owner   uuid;
  v_deleted timestamptz;
begin
  if v_me is null then
    raise exception 'not_authenticated'
      using errcode = '42501';
  end if;

  select uploaded_by, deleted_at
    into v_owner, v_deleted
  from public.documents
  where id = p_document_id;

  if v_owner is null then
    raise exception 'document not found'
      using errcode = 'P0002';
  end if;

  if v_owner <> v_me then
    raise exception 'not_owner'
      using errcode = '42501';
  end if;

  if v_deleted is not null then
    return;
  end if;

  update public.documents
     set deleted_at = now()
   where id = p_document_id;
end;
$$;

revoke all on function app.soft_delete_document(uuid) from public, anon;
grant execute on function app.soft_delete_document(uuid) to authenticated;

-- rls#8: provider_certifications needs a BEFORE UPDATE guard so the owner
-- cannot un-soft-delete and cannot swap certification_id / document_id.
create or replace function public.tg_provider_certifications_guard()
returns trigger
language plpgsql
as $$
begin
  if app.current_role() = 'admin'::public.app_role then
    return new;
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'undelete is admin-only'
      using errcode = '42501';
  end if;

  if new.certification_id is distinct from old.certification_id then
    raise exception 'certification_id is immutable on the owner path'
      using errcode = '42501';
  end if;

  if new.document_id is distinct from old.document_id then
    raise exception 'document_id is immutable on the owner path'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tg_provider_certifications_guard on public.provider_certifications;
create trigger tg_provider_certifications_guard
before update on public.provider_certifications
for each row execute function public.tg_provider_certifications_guard();

-- storage C-1 (DB half): drop latitude / longitude / service_postcode from
-- the anon column grant. The directory still returns distance_km from the
-- RPC, which is the only locational signal anon clients legitimately need.
revoke select (latitude, longitude, service_postcode)
  on public.provider_profiles from anon;

-- storage M-5 (second arm): gate provider_profiles_owner_insert on role so a
-- receiver cannot seed a provider_profiles row (and then upload documents
-- against it).
drop policy if exists provider_profiles_owner_insert on public.provider_profiles;
create policy provider_profiles_owner_insert
  on public.provider_profiles
  for insert
  to authenticated
  with check (
    id = app.current_profile_id()
    and verified_at is null
    and deleted_at is null
    and app.current_role() in (
      'provider'::public.app_role,
      'provider_company'::public.app_role
    )
  );

-- rls#14: replace the inline EXISTS in provider_services_public_read and
-- provider_capabilities_public_read with a helper that also checks
-- pp.deleted_at is null. The helper is SECURITY DEFINER so it does not
-- inherit the anon column-grant restriction on provider_profiles.deleted_at.
create or replace function app.is_public_provider(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1
    from public.provider_profiles pp
    where pp.id = p_id
      and pp.verified_at is not null
      and pp.deleted_at is null
  );
$$;

revoke all on function app.is_public_provider(uuid) from public;
grant execute on function app.is_public_provider(uuid) to anon, authenticated;

drop policy if exists provider_services_public_read on public.provider_services;
create policy provider_services_public_read
  on public.provider_services
  for select
  to anon, authenticated
  using (app.is_public_provider(provider_services.provider_id));

drop policy if exists provider_capabilities_public_read on public.provider_capabilities;
create policy provider_capabilities_public_read
  on public.provider_capabilities
  for select
  to anon, authenticated
  using (app.is_public_provider(provider_capabilities.provider_id));

-- rls#16 / storage M-2: escape LIKE metacharacters in the search query and
-- cap radius_km + offset_count inside the function body (do not trust the
-- TypeScript clamp - PostgREST exposes the RPC directly).
create or replace function app.escape_like(p_text text)
returns text
language sql
immutable
as $$
  select replace(
           replace(
             replace(coalesce(p_text, ''), '\', '\\'),
             '%',
             '\%'
           ),
           '_',
           '\_'
         );
$$;

grant execute on function app.escape_like(text) to anon, authenticated;

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
    and (
      query is null
      or query = ''
      or pp.headline ilike c.query_pattern
      or pp.bio      ilike c.query_pattern
      or pp.city     ilike c.query_pattern
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
              c.radius_km_clamped * 1000
            ) @> public.ll_to_earth(pp.latitude, pp.longitude)
        and public.earth_distance(
              public.ll_to_earth(near_lat, near_lng),
              public.ll_to_earth(pp.latitude, pp.longitude)
            ) <= c.radius_km_clamped * 1000
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
        join public.capabilities cap on cap.id = pc.capability_id
        where pc.provider_id = pp.id
          and cap.slug = capability_slug
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
  limit  (select limit_clamped from clamp)
  offset (select offset_clamped from clamp);
$$;

-- app.search_providers is SECURITY DEFINER so that anon (which no longer has
-- SELECT on latitude/longitude/service_postcode) can still exercise the
-- geo-box filter. Lock execution down to anon/authenticated (the PostgREST
-- surfaces) and revoke from PUBLIC.
revoke all on function app.search_providers(
  text, double precision, double precision, int, text, text, int, int
) from public;
grant execute on function app.search_providers(
  text, double precision, double precision, int, text, text, int, int
) to anon, authenticated;

-- The public wrapper forwards unchanged; replace it so the signature stays
-- in lockstep with app.search_providers.
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

-- =============================================================================
-- D. Audit log
-- =============================================================================

-- rls#4 / auth#6: drop the null-actor branch. The only legal path for a
-- "system" audit event is now app.record_system_audit, which runs as
-- SECURITY DEFINER owned by postgres and therefore bypasses RLS.
drop policy if exists audit_log_insert_authenticated on public.audit_log;
create policy audit_log_insert_authenticated
  on public.audit_log
  for insert
  to authenticated
  with check (
    actor_id is not null
    and (
      actor_id = app.current_profile_id()
      or app.current_role() = 'admin'::public.app_role
    )
  );

create or replace function app.record_system_audit(
  p_action        text,
  p_subject_table text,
  p_subject_id    text,
  p_before        jsonb,
  p_after         jsonb
)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
begin
  insert into public.audit_log
    (actor_id, actor_role, action, subject_table, subject_id, before, after)
  values
    (null, null, p_action, p_subject_table, p_subject_id, p_before, p_after);
end;
$$;

revoke all on function app.record_system_audit(text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function app.record_system_audit(text, text, text, jsonb, jsonb)
  to service_role;

-- =============================================================================
-- E. Contact / messaging
-- =============================================================================

-- rls#9 / contact H-1: reject non-admin writes that touch deleted_at, so a
-- provider cannot censor a pending receiver request (and vice versa).
create or replace function public.tg_contact_requests_guard()
returns trigger
language plpgsql
as $$
declare
  v_role public.app_role := app.current_role();
  v_me   uuid             := app.current_profile_id();
begin
  if v_role = 'admin'::public.app_role then
    return new;
  end if;

  if new.receiver_id is distinct from old.receiver_id
  or new.provider_id is distinct from old.provider_id
  or new.subject     is distinct from old.subject
  or new.body        is distinct from old.body then
    raise exception 'contact_requests core fields are immutable after insert'
      using errcode = '42501';
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'contact_requests soft-delete is admin-only'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if v_me = old.receiver_id
       and old.status = 'pending'
       and new.status = 'withdrawn' then
      new.responded_at := coalesce(new.responded_at, now());
      return new;
    end if;

    if v_me = old.provider_id
       and old.status = 'pending'
       and new.status in ('accepted','declined') then
      new.responded_at := coalesce(new.responded_at, now());
      return new;
    end if;

    raise exception 'illegal contact_requests status transition: % -> % (by %)',
      old.status, new.status, v_me
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- rls#11 / contact C-1: DB-side rate limit on contact_requests creation
-- (20/hour/account). IP bucketing stays in the Server Action per the PID.
create or replace function public.tg_contact_requests_rate_limit()
returns trigger
language plpgsql
as $$
begin
  perform app.bump_rate_limit('contact_request.create', 3600, 20);
  return new;
end;
$$;

drop trigger if exists tg_contact_requests_rate_limit on public.contact_requests;
create trigger tg_contact_requests_rate_limit
before insert on public.contact_requests
for each row execute function public.tg_contact_requests_rate_limit();

-- contact C-2: DB-side rate limit on meeting_proposals creation
-- (30/hour/account, same pattern).
create or replace function public.tg_meeting_proposals_rate_limit()
returns trigger
language plpgsql
as $$
begin
  perform app.bump_rate_limit('meeting_proposal.create', 3600, 30);
  return new;
end;
$$;

drop trigger if exists tg_meeting_proposals_rate_limit on public.meeting_proposals;
create trigger tg_meeting_proposals_rate_limit
before insert on public.meeting_proposals
for each row execute function public.tg_meeting_proposals_rate_limit();

-- rls#13: the meeting_proposals guard looked up contact_requests in the
-- caller's invoker context, which can now fail if the underlying request
-- row has been soft-deleted (or is otherwise invisible to one party). Run
-- the body as SECURITY DEFINER with a narrowed search_path.
create or replace function public.tg_meeting_proposals_guard()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_role public.app_role := app.current_role();
  v_me   uuid             := app.current_profile_id();
  v_cr   public.contact_requests%rowtype;
begin
  if v_role = 'admin'::public.app_role then
    return new;
  end if;

  if new.contact_request_id is distinct from old.contact_request_id
  or new.proposed_by        is distinct from old.proposed_by
  or new.proposed_at        is distinct from old.proposed_at
  or new.meeting_at         is distinct from old.meeting_at
  or new.duration_minutes   is distinct from old.duration_minutes
  or new.location_mode      is distinct from old.location_mode
  or new.location_detail    is distinct from old.location_detail then
    raise exception 'meeting_proposals core fields are immutable after insert'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    select * into v_cr from public.contact_requests where id = old.contact_request_id;

    if old.status <> 'proposed' then
      raise exception 'meeting_proposals status is terminal once it leaves proposed'
        using errcode = '42501';
    end if;

    if v_me = old.proposed_by then
      if new.status <> 'cancelled' then
        raise exception 'proposer may only cancel a proposal'
          using errcode = '42501';
      end if;
    else
      if v_me not in (v_cr.receiver_id, v_cr.provider_id) then
        raise exception 'only a party on the contact request may respond to a proposal'
          using errcode = '42501';
      end if;
      if new.status not in ('accepted','declined','cancelled') then
        raise exception 'illegal counter-party transition'
          using errcode = '42501';
      end if;
    end if;

    new.responded_at := coalesce(new.responded_at, now());
  end if;

  return new;
end;
$$;

-- rls#15: re-check cr.deleted_at in the meeting_proposals party read and
-- update policies, so soft-deleted requests do not leak their proposals.
drop policy if exists meeting_proposals_party_read on public.meeting_proposals;
create policy meeting_proposals_party_read
  on public.meeting_proposals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.contact_requests cr
      where cr.id = meeting_proposals.contact_request_id
        and cr.status = 'accepted'
        and cr.deleted_at is null
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  );

drop policy if exists meeting_proposals_party_update on public.meeting_proposals;
create policy meeting_proposals_party_update
  on public.meeting_proposals
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.contact_requests cr
      where cr.id = meeting_proposals.contact_request_id
        and cr.deleted_at is null
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  )
  with check (
    exists (
      select 1
      from public.contact_requests cr
      where cr.id = meeting_proposals.contact_request_id
        and cr.deleted_at is null
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  );

-- contact M-1: promote the +1h lead time into SQL so a direct HTTP insert
-- cannot schedule a meeting 1s from now.
create or replace function public.tg_meeting_proposals_future_only()
returns trigger
language plpgsql
as $$
begin
  if new.meeting_at <= now() + interval '1 hour' then
    raise exception 'meeting_at must be at least 1 hour in the future'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- contact M-2: handle both INSERT and UPDATE in the open-thread trigger so
-- admin-seeded accepted rows also open a bridge thread.
create or replace function public.tg_contact_requests_open_thread()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'accepted'::text then
      insert into public.contact_threads (id, contact_request_id)
      values (gen_random_uuid(), new.id)
      on conflict (contact_request_id) do nothing;
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status is distinct from 'accepted'::text
     and new.status = 'accepted'::text then
    insert into public.contact_threads (id, contact_request_id)
    values (gen_random_uuid(), new.id)
    on conflict (contact_request_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_contact_requests_open_thread_insert on public.contact_requests;
create trigger tg_contact_requests_open_thread_insert
after insert on public.contact_requests
for each row execute function public.tg_contact_requests_open_thread();

-- contact H-8: at most one accepted meeting proposal per contact_request.
-- Partial unique index so declined / cancelled siblings do not collide.
create unique index if not exists meeting_proposals_one_accepted_idx
  on public.meeting_proposals (contact_request_id)
  where status = 'accepted' and deleted_at is null;

-- contact M-8: contact_thread_posts_party_read must also filter on
-- cr.status = 'accepted' and cr.deleted_at is null so posts do not remain
-- readable after an admin moves the parent request out of accepted.
drop policy if exists contact_thread_posts_party_read on public.contact_thread_posts;
create policy contact_thread_posts_party_read
  on public.contact_thread_posts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.contact_threads t
      join public.contact_requests cr on cr.id = t.contact_request_id
      where t.id = contact_thread_posts.thread_id
        and t.deleted_at is null
        and cr.status = 'accepted'
        and cr.deleted_at is null
        and (cr.receiver_id = app.current_profile_id()
             or cr.provider_id = app.current_profile_id())
    )
  );

-- rls#10 / contact C-6 + contact H-3: per-thread rate-limit scope, AFTER
-- INSERT so failed RLS inserts do not consume the author's bucket.
create or replace function public.tg_contact_thread_posts_rate_limit()
returns trigger
language plpgsql
as $$
begin
  perform app.bump_rate_limit(
    'thread_post.create:' || new.thread_id::text,
    60,
    30
  );
  return new;
end;
$$;

drop trigger if exists tg_contact_thread_posts_rate_limit on public.contact_thread_posts;
create trigger tg_contact_thread_posts_rate_limit
after insert on public.contact_thread_posts
for each row execute function public.tg_contact_thread_posts_rate_limit();

-- contact M-7: guard bump_rate_limit against a zero / negative window so a
-- future misuse does not divide by zero.
create or replace function app.bump_rate_limit(
  p_scope          text,
  p_window_seconds int,
  p_max_count      int
)
returns int
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_profile      uuid := app.current_profile_id();
  v_window_start timestamptz;
  v_count        int;
begin
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'rate_limited'
      using errcode = 'P0001',
            detail  = 'invalid window_seconds';
  end if;

  if v_profile is null then
    raise exception 'rate_limited'
      using errcode = 'P0001',
            detail  = 'no authenticated profile';
  end if;

  v_window_start := to_timestamp(
    (floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)::double precision
  );

  perform pg_advisory_xact_lock(
    hashtext(v_profile::text || '|' || p_scope)
  );

  insert into public.rate_limit_buckets
    (profile_id, scope_key, window_start, window_seconds, count)
  values
    (v_profile, p_scope, v_window_start, p_window_seconds, 1)
  on conflict (profile_id, scope_key, window_start)
    do update set count      = public.rate_limit_buckets.count + 1,
                  updated_at = now()
  returning count into v_count;

  if v_count > p_max_count then
    raise exception 'rate_limited'
      using errcode = 'P0001',
            detail  = format('scope=%s window=%ss count=%s max=%s',
                             p_scope, p_window_seconds, v_count, p_max_count);
  end if;

  return v_count;
end;
$$;

-- contact H-2: admin-only vacuum helper for the append-only rate-limit
-- buckets table. A follow-up Vercel Cron will call this via service_role.
create or replace function app.vacuum_rate_limit_buckets()
returns bigint
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_deleted bigint;
begin
  with d as (
    delete from public.rate_limit_buckets
     where window_start < now() - interval '1 day'
    returning 1
  )
  select count(*) into v_deleted from d;
  return v_deleted;
end;
$$;

revoke all on function app.vacuum_rate_limit_buckets() from public, anon, authenticated;
grant execute on function app.vacuum_rate_limit_buckets() to service_role;
