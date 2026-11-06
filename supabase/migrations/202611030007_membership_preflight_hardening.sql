-- Migration 007: membership number and policy hardening.
-- Run as one transaction; any failed preflight or DDL statement rolls back all changes.
BEGIN;
-- Apply only after 004, 005 and 006 have completed successfully.
-- This migration changes schema/policies only. It does not UPDATE or DELETE rows,
-- and it does not touch auth.users, profiles, user_roles, or the Super Admin.
--
-- Assumptions and fail-closed behavior:
-- * Migrations 001-006 are already present in this database.
-- * The email pending-application unique index from 004 is present and valid.
-- * Policy names match the repository's 001-006 migrations. Unknown policies,
--   an out-of-scope policy definition, or a non-Super-Admin CMS/media policy
--   aborts before this migration changes anything.
-- * Other user-defined triggers on public.members also abort for manual review;
--   an uninspected trigger could assign or replace membership_no.

do $$
declare
  missing_objects text;
  unexpected_policies text;
  missing_policies text;
  bad_policy_definitions text;
  bad_scope_policy_definitions text;
  email_index_definition text;
  email_index_predicate text;
  old_mobile_index_definition text;
  mobile_lookup_definition text;
  mobile_lookup_predicate text;
  rls_disabled_tables text;
  sequence_last_value bigint;
  sequence_is_called boolean;
  current_year_max_number bigint;
begin
  if to_regclass('public.members') is null
     or to_regclass('public.membership_applications') is null
     or to_regclass('public.membership_number_seq') is null then
    raise exception 'Migration 007 requires migrations 001 and 004 (members, applications, membership sequence).';
  end if;

  select string_agg(format('%I.%I', req.table_name, req.column_name), ', ' order by req.table_name, req.column_name)
    into missing_objects
  from (values
    ('members','status'),
    ('members','membership_no'),
    ('membership_applications','email_normalized'),
    ('membership_applications','mobile_normalized')
  ) as req(table_name,column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = req.table_name
      and c.column_name = req.column_name
  );
  if missing_objects is not null then
    raise exception 'Migration 007 missing required columns: %', missing_objects;
  end if;

  -- Fail closed if the next generated number could collide with an existing
  -- number for this year. Do not change sequence state or member data here.
  select last_value, is_called into sequence_last_value, sequence_is_called
  from public.membership_number_seq;
  select max(substring(membership_no from '([0-9]+)$')::bigint)
    into current_year_max_number
  from public.members
  where membership_no like 'ABVDS-' || to_char(current_date, 'YYYY') || '-%';
  if current_year_max_number is not null
     and (case when sequence_is_called then sequence_last_value + 1 else sequence_last_value end) <= current_year_max_number then
    raise exception 'Membership sequence would reuse an existing current-year number; inspect and align it manually before continuing.';
  end if;

  select string_agg(req.table_name, ', ' order by req.table_name)
    into rls_disabled_tables
  from (values
    ('organizational_units'),('profiles'),('user_roles'),('members'),('managers'),('coordinators'),
    ('designations'),('membership_applications'),('activity_logs'),('notifications'),
    ('projects'),('news'),('events'),('photo_albums'),('gallery_images'),('videos'),('awards'),
    ('annual_audit_reports'),('management_team'),('homepage_slides'),('contact_enquiries')
  ) as req(table_name)
  where not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=req.table_name and c.relrowsecurity
  );
  if rls_disabled_tables is not null then
    raise exception 'RLS is disabled or a required table is missing: %. Enable/verify RLS before continuing.', rls_disabled_tables;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='storage' and c.relname='objects' and c.relrowsecurity
  ) then
    raise exception 'RLS is disabled on storage.objects; review storage access before continuing.';
  end if;

  select pg_get_indexdef(i.indexrelid), pg_get_expr(i.indpred, i.indrelid)
    into email_index_definition, email_index_predicate
  from pg_index i
  where i.indexrelid = to_regclass('public.membership_applications_pending_email_uidx')
    and i.indisunique
    and i.indisvalid
    and i.indnatts = 1
    and i.indnkeyatts = 1;
  if email_index_definition is null
     or email_index_definition not ilike '%(email_normalized)%'
     or email_index_predicate is null
     or email_index_predicate not ilike '%status%'
     or email_index_predicate not ilike '%pending%'
     or email_index_predicate not ilike '%email_normalized%' then
    raise exception 'Expected the valid pending-email unique index from 004; inspect it before continuing.';
  end if;

  select pg_get_indexdef(i.indexrelid)
    into old_mobile_index_definition
  from pg_index i
  where i.indexrelid = to_regclass('public.membership_applications_pending_mobile_uidx')
    and i.indisunique and i.indisvalid
    and i.indnatts = 1 and i.indnkeyatts = 1;
  if to_regclass('public.membership_applications_pending_mobile_uidx') is not null
     and (old_mobile_index_definition is null
       or old_mobile_index_definition not ilike '%(mobile_normalized)%') then
    raise exception 'The existing pending-mobile index has an unexpected definition; inspect before replacing it.';
  end if;

  select pg_get_indexdef(i.indexrelid), pg_get_expr(i.indpred, i.indrelid)
    into mobile_lookup_definition, mobile_lookup_predicate
  from pg_index i
  where i.indexrelid = to_regclass('public.membership_applications_pending_mobile_idx')
    and not i.indisunique and i.indisvalid
    and i.indnatts = 1 and i.indnkeyatts = 1;
  if to_regclass('public.membership_applications_pending_mobile_idx') is not null
     and (mobile_lookup_definition is null
       or mobile_lookup_definition not ilike '%(mobile_normalized)%'
       or mobile_lookup_predicate is null
       or mobile_lookup_predicate not ilike '%status%'
       or mobile_lookup_predicate not ilike '%pending%'
       or mobile_lookup_predicate not ilike '%mobile_normalized%') then
    raise exception 'The existing pending-mobile lookup index has an unexpected definition; inspect before continuing.';
  end if;

  -- Exact policy-name allowlist for the 005/006 scope and CMS setup.
  -- The two policies removed below are allowed here so a rerun is safe.
  with allowed(tablename, policyname) as (values
    ('organizational_units','public_units_read'),
    ('organizational_units','super_admin_units_manage'),
    ('organizational_units','scoped_admin_units_insert'),
    ('organizational_units','scoped_admin_units_update'),
    ('organizational_units','scoped_admin_units_delete'),
    ('profiles','own_profile_read'),('profiles','own_profile_update'),('profiles','scoped_profiles_read'),
    ('user_roles','own_roles_read'),('user_roles','scoped_user_roles_read'),
    ('members','scoped_members_read'),('managers','scoped_managers_read'),
    ('coordinators','scoped_coordinators_read'),
    ('designations','active_designations_read'),('designations','super_admin_designations_manage'),
    ('membership_applications','applications_public_submit'),
    ('membership_applications','scoped_applications_read'),
    ('membership_applications','scoped_applications_update'),
    ('activity_logs','scoped_activity_read'),
    ('notifications','own_notifications_read'),('notifications','own_notifications_update'),
    ('projects','public_projects_read'),('projects','super_admin_projects_manage'),
    ('news','public_news_read'),('news','super_admin_news_manage'),
    ('events','public_events_read'),('events','super_admin_events_manage'),
    ('photo_albums','public_albums_read'),('photo_albums','super_admin_albums_manage'),
    ('gallery_images','public_gallery_images_read'),('gallery_images','super_admin_images_manage'),
    ('videos','public_videos_read'),('videos','super_admin_videos_manage'),
    ('awards','public_awards_read'),('awards','super_admin_awards_manage'),
    ('annual_audit_reports','public_reports_read'),('annual_audit_reports','super_admin_reports_manage'),
    ('management_team','public_team_read'),('management_team','super_admin_team_manage'),
    ('homepage_slides','public_slides_read'),('homepage_slides','super_admin_slides_manage'),
    ('contact_enquiries','enquiries_public_submit'),('contact_enquiries','super_admin_enquiry_manage'),
    ('objects','public_media_read'),
    ('objects','super_admin_public_media_upload'),
    ('objects','super_admin_public_media_update'),
    ('objects','super_admin_public_media_delete')
  )
  select string_agg(format('%I.%I', p.tablename, p.policyname), ', ' order by p.tablename, p.policyname)
    into unexpected_policies
  from pg_policies p
  where ((p.schemaname = 'public' and p.tablename in (
           'organizational_units','profiles','user_roles','members','managers','coordinators',
           'designations','membership_applications','activity_logs','notifications','projects',
           'news','events','photo_albums','gallery_images','videos','awards',
           'annual_audit_reports','management_team','homepage_slides','contact_enquiries'
         ))
     or (p.schemaname = 'storage' and p.tablename = 'objects'
           and (coalesce(p.qual,'') ilike '%public-media%'
             or coalesce(p.with_check,'') ilike '%public-media%'
             or (p.qual is null and p.with_check is null)
             or (p.qual is not null and coalesce(p.qual,'') !~* 'bucket_id\s*=\s*''[^'']+''')
             or (p.with_check is not null and coalesce(p.with_check,'') !~* 'bucket_id\s*=\s*''[^'']+''')))
    and not exists (
      select 1 from allowed a
      where a.tablename = p.tablename and a.policyname = p.policyname
    );
  if unexpected_policies is not null then
    raise exception 'Unexpected RLS policies exist on affected tables: %. Review their definitions; no changes were made.', unexpected_policies;
  end if;

  with required(tablename, policyname) as (values
    ('organizational_units','public_units_read'),
    ('organizational_units','super_admin_units_manage'),
    ('organizational_units','scoped_admin_units_insert'),
    ('organizational_units','scoped_admin_units_update'),
    ('profiles','own_profile_read'),('profiles','own_profile_update'),('profiles','scoped_profiles_read'),
    ('user_roles','own_roles_read'),('user_roles','scoped_user_roles_read'),
    ('members','scoped_members_read'),('managers','scoped_managers_read'),
    ('coordinators','scoped_coordinators_read'),
    ('designations','active_designations_read'),('designations','super_admin_designations_manage'),
    ('membership_applications','applications_public_submit'),
    ('membership_applications','scoped_applications_read'),
    ('activity_logs','scoped_activity_read'),
    ('notifications','own_notifications_read'),('notifications','own_notifications_update'),
    ('projects','public_projects_read'),('projects','super_admin_projects_manage'),
    ('news','public_news_read'),('news','super_admin_news_manage'),
    ('events','public_events_read'),('events','super_admin_events_manage'),
    ('photo_albums','public_albums_read'),('photo_albums','super_admin_albums_manage'),
    ('gallery_images','public_gallery_images_read'),('gallery_images','super_admin_images_manage'),
    ('videos','public_videos_read'),('videos','super_admin_videos_manage'),
    ('awards','public_awards_read'),('awards','super_admin_awards_manage'),
    ('annual_audit_reports','public_reports_read'),('annual_audit_reports','super_admin_reports_manage'),
    ('management_team','public_team_read'),('management_team','super_admin_team_manage'),
    ('homepage_slides','public_slides_read'),('homepage_slides','super_admin_slides_manage'),
    ('contact_enquiries','enquiries_public_submit'),('contact_enquiries','super_admin_enquiry_manage'),
    ('objects','public_media_read'),
    ('objects','super_admin_public_media_upload'),
    ('objects','super_admin_public_media_update'),
    ('objects','super_admin_public_media_delete')
  )
  select string_agg(format('%I.%I', r.tablename, r.policyname), ', ' order by r.tablename, r.policyname)
    into missing_policies
  from required r
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = case when r.tablename = 'objects' then 'storage' else 'public' end
      and p.tablename = r.tablename
      and p.policyname = r.policyname
  );
  if missing_policies is not null then
    raise exception 'Required 005/006 policies are missing: %. Apply and verify prerequisites first.', missing_policies;
  end if;

  -- Validate definitions for the identity, public submission, lookup, and
  -- notification policies, not just their names. Keep the checks fail-closed.
  if exists (
    select 1 from pg_policies p
    where (p.schemaname,p.tablename,p.policyname) in (
      ('public','profiles','own_profile_read'),
      ('public','profiles','own_profile_update'),
      ('public','user_roles','own_roles_read'),
      ('public','designations','active_designations_read'),
      ('public','notifications','own_notifications_read'),
      ('public','notifications','own_notifications_update'),
      ('public','membership_applications','applications_public_submit'),
      ('public','organizational_units','public_units_read')
    ) and (
      p.permissive <> 'PERMISSIVE'
      or p.roles <> case when p.policyname in ('applications_public_submit','public_units_read')
                         then array['anon','authenticated']::name[]
                         else array['authenticated']::name[] end
      or (p.policyname in ('own_profile_read','own_roles_read','active_designations_read','own_notifications_read','public_units_read') and p.cmd <> 'SELECT')
      or (p.policyname in ('own_profile_update','own_notifications_update') and p.cmd <> 'UPDATE')
      or (p.policyname='applications_public_submit' and p.cmd <> 'INSERT')
      or (p.policyname in ('own_profile_read','own_profile_update') and
          (coalesce(p.qual,'') !~* 'id\s*=\s*auth\.uid\(\)' or coalesce(p.qual,'') ilike '%true%' or coalesce(p.qual,'') ~* '(^|[^a-z])or([^a-z]|$)'
           or (p.cmd='UPDATE' and (coalesce(p.with_check,'') !~* 'id\s*=\s*auth\.uid\(\)' or coalesce(p.with_check,'') ilike '%true%' or coalesce(p.with_check,'') ~* '(^|[^a-z])or([^a-z]|$)'))))
      or (p.policyname='own_roles_read' and (coalesce(p.qual,'') !~* 'user_id\s*=\s*auth\.uid\(\)' or coalesce(p.qual,'') ilike '%true%' or coalesce(p.qual,'') ~* '(^|[^a-z])or([^a-z]|$)' or coalesce(p.qual,'') ilike '%true%'))
      or (p.policyname in ('own_notifications_read','own_notifications_update') and
          (coalesce(p.qual,'') !~* 'user_id\s*=\s*auth\.uid\(\)' or coalesce(p.qual,'') ilike '%true%' or coalesce(p.qual,'') ~* '(^|[^a-z])or([^a-z]|$)'
           or (p.cmd='UPDATE' and (coalesce(p.with_check,'') !~* 'user_id\s*=\s*auth\.uid\(\)' or coalesce(p.with_check,'') ilike '%true%' or coalesce(p.with_check,'') ~* '(^|[^a-z])or([^a-z]|$)'))))
      or (p.policyname='active_designations_read' and (coalesce(p.qual,'') !~* 'active' or coalesce(p.qual,'') !~* 'has_role' or coalesce(p.qual,'') !~* 'super_admin' or coalesce(p.qual,'') !~* 'admin' or coalesce(p.qual,'') ilike '%true%'))
      or (p.policyname='public_units_read' and (coalesce(p.qual,'') !~* 'active' or coalesce(p.qual,'') ~* '(^|[^a-z])or([^a-z]|$)' or coalesce(p.qual,'') ilike '%true%'))
      or (p.policyname='applications_public_submit' and
          (coalesce(p.with_check,'') !~* 'status\s*=\s*''pending''' or coalesce(p.with_check,'') !~* 'reviewed_by\s+is\s+null'
           or coalesce(p.with_check,'') !~* 'reviewed_at\s+is\s+null' or coalesce(p.with_check,'') !~* 'final_reviewed_by\s+is\s+null'
           or coalesce(p.with_check,'') !~* 'approval_stage' or coalesce(p.with_check,'') !~* 'assigned_unit_id'
           or coalesce(p.with_check,'') !~* 'pending_admin' or coalesce(p.with_check,'') !~* 'pending_coordinator'
           or coalesce(p.with_check,'') !~* 'organizational_units' or coalesce(p.with_check,'') !~* 'active' or coalesce(p.with_check,'') ilike '%true%'))
    )
  ) then
    raise exception 'A required identity/public policy definition is broader than its approved predicate.';
  end if;

  -- The 006 write policies must be authenticated-only and Super Admin-only.
  select string_agg(format('%I.%I', p.tablename, p.policyname), ', ' order by p.tablename, p.policyname)
    into bad_policy_definitions
  from pg_policies p
  where p.schemaname = 'public'
    and p.policyname in (
      'super_admin_projects_manage','super_admin_news_manage','super_admin_events_manage',
      'super_admin_albums_manage','super_admin_images_manage','super_admin_videos_manage',
      'super_admin_awards_manage','super_admin_reports_manage','super_admin_team_manage',
      'super_admin_slides_manage','super_admin_enquiry_manage'
    )
    and (p.permissive <> 'PERMISSIVE'
      or p.cmd <> 'ALL'
      or p.roles <> array['authenticated']::name[]
      or p.qual is null or p.with_check is null
      or p.qual !~* 'super_admin' or p.with_check !~* 'super_admin'
      or p.qual ilike '%true%' or p.with_check ilike '%true%'
      or p.qual ~* '(^|[^a-z])or([^a-z]|$)'
      or p.with_check ~* '(^|[^a-z])or([^a-z]|$)'
      or p.qual ~* '(^|[^a-z0-9_])admin([^a-z0-9_]|$)'
      or p.with_check ~* '(^|[^a-z0-9_])admin([^a-z0-9_]|$)');

  if bad_policy_definitions is not null then
    raise exception 'A CMS Super Admin policy is not Super Admin-only: %. Review definitions before continuing.', bad_policy_definitions;
  end if;

  -- Scope-bearing policies must still call the helper from 004. This catches
  -- same-name policies whose expressions were broadened after migration 005.
  select string_agg(format('%I.%I', p.tablename, p.policyname), ', ' order by p.tablename, p.policyname)
    into bad_scope_policy_definitions
  from pg_policies p
  where p.schemaname = 'public'
    and p.policyname in (
      'scoped_admin_units_insert','scoped_admin_units_update','scoped_profiles_read',
      'scoped_user_roles_read','scoped_members_read','scoped_managers_read',
      'scoped_coordinators_read','scoped_applications_read','scoped_activity_read'
    )
    and (p.permissive <> 'PERMISSIVE'
      or p.roles <> array['authenticated']::name[]
      or p.cmd <> case p.policyname
        when 'scoped_admin_units_insert' then 'INSERT'
        when 'scoped_admin_units_update' then 'UPDATE'
        else 'SELECT' end
      or (p.policyname <> 'scoped_admin_units_insert'
        and coalesce(p.qual, '') !~* 'is_unit_in_my_scope')
      or (p.policyname in ('scoped_admin_units_insert','scoped_admin_units_update')
        and coalesce(p.with_check, '') !~* 'is_unit_in_my_scope')
      or coalesce(p.qual,'') ilike '%true%' or coalesce(p.with_check,'') ilike '%true%');

  if bad_scope_policy_definitions is not null then
    raise exception 'A scope policy is missing its expected unit-scope guard: %. Review definitions before continuing.', bad_scope_policy_definitions;
  end if;

  -- Super Admin unit/designation management remains Super Admin-only too.
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.policyname in ('super_admin_units_manage','super_admin_designations_manage')
      and (p.permissive <> 'PERMISSIVE' or p.cmd <> 'ALL'
        or p.roles <> array['authenticated']::name[]
        or p.qual is null or p.with_check is null
        or p.qual !~* 'super_admin' or p.with_check !~* 'super_admin'
        or p.qual ilike '%true%' or p.with_check ilike '%true%'
        or p.qual ~* '(^|[^a-z])or([^a-z]|$)'
        or p.with_check ~* '(^|[^a-z])or([^a-z]|$)'
        or p.qual ~* '(^|[^a-z0-9_])admin([^a-z0-9_]|$)'
        or p.with_check ~* '(^|[^a-z0-9_])admin([^a-z0-9_]|$)')
  ) then
    raise exception 'A Super Admin unit/designation policy has an unexpected definition.';
  end if;

  -- Public content reads stay limited to published, non-archived rows; public
  -- media reads stay limited to the dedicated public-media bucket.
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.policyname in (
        'public_projects_read','public_news_read','public_events_read','public_albums_read',
        'public_gallery_images_read','public_videos_read','public_awards_read','public_reports_read',
        'public_team_read'
      )
      and (p.permissive <> 'PERMISSIVE' or p.cmd <> 'SELECT'
        or cardinality(p.roles) <> 2
        or not (p.roles::text[] @> array['anon','authenticated']::text[])
        or p.qual is null
        or p.qual !~* 'published'
        or p.qual !~* 'not[[:space:]]+archived'
        or p.qual ilike '%true%'
        or p.qual ~* '(^|[^a-z])or([^a-z]|$)'
        or (p.policyname = 'public_gallery_images_read' and p.qual not ilike '%photo_albums%'))
  ) or exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.policyname = 'public_slides_read'
      and (p.permissive <> 'PERMISSIVE' or p.cmd <> 'SELECT'
        or cardinality(p.roles) <> 2
        or not (p.roles::text[] @> array['anon','authenticated']::text[])
        or p.qual is null or p.qual !~* 'published'
        or p.qual ilike '%true%' or p.qual ~* '(^|[^a-z])or([^a-z]|$)')
  ) or exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.policyname = 'enquiries_public_submit'
      and (p.permissive <> 'PERMISSIVE' or p.cmd <> 'INSERT'
        or cardinality(p.roles) <> 2
        or not (p.roles::text[] @> array['anon','authenticated']::text[])
        or p.with_check is null or p.with_check !~* 'status'
        or p.with_check !~* 'new' or p.with_check ilike '%true%'
        or p.with_check ~* '(^|[^a-z])or([^a-z]|$)')
  ) or exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname = 'public_media_read'
      and (p.permissive <> 'PERMISSIVE' or p.cmd <> 'SELECT'
        or cardinality(p.roles) <> 2
        or not (p.roles::text[] @> array['anon','authenticated']::text[])
        or p.qual is null or p.qual not ilike '%public-media%'
        or p.qual ilike '%true%' or p.qual ~* '(^|[^a-z])or([^a-z]|$)')
  ) then
    raise exception 'A public read/submit policy has an unexpected definition. Review policies before continuing.';
  end if;

  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname in ('super_admin_public_media_upload','super_admin_public_media_update','super_admin_public_media_delete')
      and (p.permissive <> 'PERMISSIVE'
        or p.roles <> array['authenticated']::name[]
        or (p.policyname = 'super_admin_public_media_upload'
            and (p.cmd <> 'INSERT' or p.with_check is null
              or p.with_check not ilike '%public-media%'
              or p.with_check ilike '%true%'
              or p.with_check ~* '(^|[^a-z])or([^a-z]|$)'
              or p.with_check !~* 'super_admin'
              or p.with_check ~* '(^|[^a-z0-9_])admin([^a-z0-9_]|$)'))
        or (p.policyname = 'super_admin_public_media_update'
            and (p.cmd <> 'UPDATE' or p.qual is null or p.with_check is null
              or p.qual not ilike '%public-media%' or p.with_check not ilike '%public-media%'
              or p.qual ilike '%true%' or p.with_check ilike '%true%'
              or p.qual ~* '(^|[^a-z])or([^a-z]|$)'
              or p.with_check ~* '(^|[^a-z])or([^a-z]|$)'
              or p.qual !~* 'super_admin' or p.with_check !~* 'super_admin'
              or p.qual ~* '(^|[^a-z0-9_])admin([^a-z0-9_]|$)'
              or p.with_check ~* '(^|[^a-z0-9_])admin([^a-z0-9_]|$)'))
        or (p.policyname = 'super_admin_public_media_delete'
            and (p.cmd <> 'DELETE' or p.qual is null
              or p.qual not ilike '%public-media%' or p.qual !~* 'super_admin'
              or p.qual ilike '%true%' or p.qual ~* '(^|[^a-z])or([^a-z]|$)'
              or p.qual ~* '(^|[^a-z0-9_])admin([^a-z0-9_]|$)')))
  ) then
    raise exception 'A public-media write policy is not restricted to Super Admin. Review definitions before continuing.';
  end if;

  -- Unknown user-defined member triggers could replace or assign membership_no.
  if exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.members'::regclass
      and not t.tgisinternal
      and t.tgname <> 'members_assign_membership_number'
  ) then
    raise exception 'Additional user-defined triggers exist on public.members. Review them before continuing.';
  end if;
end;
$$;

-- Keep the 004 pending-email uniqueness rule. Remove only the too-strict
-- pending-mobile unique index; retain a non-unique index for duplicate review.
drop index if exists public.membership_applications_pending_mobile_uidx;
create index if not exists membership_applications_pending_mobile_idx
  on public.membership_applications(mobile_normalized)
  where status = 'pending' and mobile_normalized is not null;

-- Preserve any existing non-blank membership number. Issue a number only when
-- an approved member is inserted or transitions to approved with no number.
create or replace function public.assign_membership_number()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'approved'
     and nullif(btrim(new.membership_no), '') is null then
    new.membership_no := 'ABVDS-' || to_char(current_date, 'YYYY') || '-'
      || lpad(nextval('public.membership_number_seq')::text, 6, '0');
  elsif tg_op = 'INSERT' then
    -- Do not accept a supplied number on a newly inserted non-approved row.
    new.membership_no := null;
  end if;
  return new;
end;
$$;

-- Recreate the named trigger only when absent, disabled, or defined differently.
-- Existing membership_no values are not updated by this migration.
do $$
declare
  status_attnum smallint;
  trigger_type smallint;
  trigger_columns text;
  trigger_function oid;
  trigger_enabled "char";
  trigger_when text;
  trigger_found boolean;
begin
  select a.attnum into status_attnum
  from pg_attribute a
  where a.attrelid = 'public.members'::regclass
    and a.attname = 'status' and not a.attisdropped;

  select t.tgtype, t.tgattr::text, t.tgfoid, t.tgenabled, pg_get_expr(t.tgqual, t.tgrelid)
    into trigger_type, trigger_columns, trigger_function, trigger_enabled, trigger_when
  from pg_trigger t
  where t.tgrelid = 'public.members'::regclass
    and t.tgname = 'members_assign_membership_number'
    and not t.tgisinternal;
  trigger_found := found;

  if not trigger_found
     or trigger_type <> 23 -- ROW | BEFORE | INSERT | UPDATE
     or trigger_columns <> status_attnum::text
     or trigger_function <> 'public.assign_membership_number()'::regprocedure::oid
     or trigger_enabled not in ('O','A')
     or trigger_when is not null then
    execute 'drop trigger if exists members_assign_membership_number on public.members';
    execute 'create trigger members_assign_membership_number '
      || 'before insert or update of status on public.members '
      || 'for each row execute function public.assign_membership_number()';
  end if;
end;
$$;

-- These permissions are already revoked by 005; repeat the revoke defensively.
revoke update on public.membership_applications from anon, authenticated;

-- These policies authorize destructive/direct writes that the server API does
-- not expose. Remove them; scoped reads and the server-side approval RPC remain.
drop policy if exists scoped_admin_units_delete on public.organizational_units;
drop policy if exists scoped_applications_update on public.membership_applications;

COMMIT;
