-- Read-only verification. Run after migrations 001 through 007 have completed.
with expected(table_name) as (values
 ('profiles'),('user_roles'),('permissions'),('role_permissions'),('organization_settings'),
 ('system_settings'),('organizational_units'),('designations'),('members'),
 ('membership_applications'),('membership_categories'),('membership_payments'),('membership_renewals'),
 ('id_cards'),('id_verifications'),('appointment_letters'),('appointment_verifications'),
 ('certificates'),('certificate_verifications'),('managers'),('coordinators'),('referrals'),
 ('donations'),('donation_receipts'),('crowdfunding_campaigns'),('campaign_updates'),('campaign_expenses'),
 ('projects'),('project_reports'),('events'),('news'),('photo_albums'),('gallery_images'),('videos'),
 ('homepage_slides'),('annual_audit_reports'),('awards'),('management_team'),('complaints'),
 ('complaint_updates'),('contact_enquiries'),('notifications'),('birthdays'),('website_pages'),
 ('translations'),('social_links'),('bank_details'),('organization_documents'),('analytics_settings'),('activity_logs')
)
select e.table_name,
       (c.oid is not null) as exists,
       coalesce(c.relrowsecurity,false) as rls_enabled,
       coalesce(p.policy_count,0) as policy_count
from expected e
left join pg_namespace n on n.nspname='public'
left join pg_class c on c.relnamespace=n.oid and c.relname=e.table_name and c.relkind='r'
left join (select schemaname,tablename,count(*) policy_count from pg_policies where schemaname='public' group by schemaname,tablename) p
  on p.schemaname='public' and p.tablename=e.table_name
order by e.table_name;

-- Expected policies after 007. The 005 unit DELETE and application UPDATE
-- policies are intentionally absent; direct application UPDATE stays revoked.
with expected(schemaname, tablename, policyname) as (values
 ('public','membership_applications','applications_public_submit'),
 ('public','contact_enquiries','enquiries_public_submit'),
 ('public','homepage_slides','public_slides_read'),
 ('public','profiles','own_profile_read'),('public','profiles','own_profile_update'),
 ('public','user_roles','own_roles_read'),
 ('public','projects','public_projects_read'),('public','news','public_news_read'),
 ('public','events','public_events_read'),('public','photo_albums','public_albums_read'),
 ('public','gallery_images','public_gallery_images_read'),('public','videos','public_videos_read'),
 ('public','awards','public_awards_read'),('public','annual_audit_reports','public_reports_read'),
 ('public','management_team','public_team_read'),
 ('public','projects','super_admin_projects_manage'),('public','news','super_admin_news_manage'),
 ('public','events','super_admin_events_manage'),('public','photo_albums','super_admin_albums_manage'),
 ('public','gallery_images','super_admin_images_manage'),('public','videos','super_admin_videos_manage'),
 ('public','awards','super_admin_awards_manage'),('public','annual_audit_reports','super_admin_reports_manage'),
 ('public','management_team','super_admin_team_manage'),('public','homepage_slides','super_admin_slides_manage'),
 ('public','contact_enquiries','super_admin_enquiry_manage'),
 ('public','organizational_units','public_units_read'),('public','organizational_units','super_admin_units_manage'),
 ('public','organizational_units','scoped_admin_units_insert'),('public','organizational_units','scoped_admin_units_update'),
 ('public','profiles','scoped_profiles_read'),('public','user_roles','scoped_user_roles_read'),
 ('public','members','scoped_members_read'),('public','managers','scoped_managers_read'),
 ('public','coordinators','scoped_coordinators_read'),('public','designations','active_designations_read'),
 ('public','designations','super_admin_designations_manage'),
 ('public','membership_applications','scoped_applications_read'),('public','activity_logs','scoped_activity_read'),
 ('public','notifications','own_notifications_read'),('public','notifications','own_notifications_update'),
 ('storage','objects','public_media_read'),('storage','objects','super_admin_public_media_upload'),
 ('storage','objects','super_admin_public_media_update'),('storage','objects','super_admin_public_media_delete')
)
select e.schemaname, e.tablename, e.policyname,
       (p.policyname is not null) as exists, p.permissive, p.cmd, p.roles, p.qual, p.with_check
from expected e
left join pg_policies p on p.schemaname=e.schemaname
  and p.tablename=e.tablename and p.policyname=e.policyname
order by e.schemaname,e.tablename,e.policyname;

select policyname as policy_name, tablename, permissive, cmd, roles, qual, with_check
from pg_policies
where schemaname='storage' and tablename='objects'
order by policyname;

select id,name,public,file_size_limit,allowed_mime_types
from storage.buckets where id='public-media';

-- New workflow columns and the RPC are present.
select table_name,column_name from information_schema.columns
where table_schema='public' and ((table_name='profiles' and column_name in
 ('account_status','org_unit_id','designation_id','reporting_officer_id','state','district','tehsil','block','area'))
 or (table_name='membership_applications' and column_name in
 ('approval_stage','assigned_unit_id','coordinator_reviewed_at','manager_reviewed_at','final_reviewed_at','email_normalized','mobile_normalized')))
order by table_name,column_name;
select to_regclass('public.membership_number_seq') as membership_number_sequence;
select last_value, is_called from public.membership_number_seq;
select max(substring(membership_no from '([0-9]+)$')::bigint) as current_year_max_membership_number
from public.members where membership_no like 'ABVDS-' || to_char(current_date, 'YYYY') || '-%';
select routine_name, routine_definition, security_type
from information_schema.routines
where routine_schema='public' and routine_name in
 ('is_unit_in_my_scope','can_create_role','approve_membership_application','assign_membership_number');

select has_function_privilege('anon', to_regprocedure('public.approve_membership_application(uuid,uuid,uuid,uuid,uuid)'), 'EXECUTE') as anon_can_approve,
       has_function_privilege('authenticated', to_regprocedure('public.approve_membership_application(uuid,uuid,uuid,uuid,uuid)'), 'EXECUTE') as authenticated_can_approve,
       has_function_privilege('service_role', to_regprocedure('public.approve_membership_application(uuid,uuid,uuid,uuid,uuid)'), 'EXECUTE') as service_role_can_approve;

-- Membership numbering must be guarded by approved status and both events.
select t.tgname, pg_get_triggerdef(t.oid) as trigger_definition,
       pg_get_functiondef(t.tgfoid) as function_definition
from pg_trigger t
where t.tgrelid='public.members'::regclass
  and t.tgname='members_assign_membership_number'
  and not t.tgisinternal;

select indexname, indexdef
from pg_indexes
where schemaname='public'
  and indexname in ('membership_applications_pending_email_uidx',
                    'membership_applications_pending_mobile_uidx',
                    'membership_applications_pending_mobile_idx');

-- Read-only inventory of every existing membership number. 007 must not
-- silently change any value; the second result highlights non-approved rows
-- that already carry a number for manual review.
select id, user_id, status, membership_no
from public.members
where membership_no is not null
order by created_at;
select id, user_id, status, membership_no
from public.members
where status <> 'approved' and membership_no is not null
order by created_at;

-- Full RLS definitions for the policies touched by 005/006. Review any policy
-- name not present in the repository's allowlist before enabling staff access.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where (schemaname='public' and tablename in (
  'organizational_units','profiles','user_roles','members','managers','coordinators',
  'designations','membership_applications','activity_logs','notifications',
  'projects','news','events','photo_albums','gallery_images','videos','awards',
  'annual_audit_reports','management_team','homepage_slides','contact_enquiries'
)) or (schemaname='storage' and tablename='objects')
order by schemaname, tablename, policyname;

-- Must return no rows after 006/007: global Admin policies and removed policies.
select schemaname, policyname, tablename from pg_policies where
 (schemaname='public' and policyname in
 ('admin_projects_manage','admin_news_manage','admin_events_manage','admin_albums_manage','admin_images_manage',
  'admin_videos_manage','admin_awards_manage','admin_reports_manage','admin_team_manage','admin_slides_manage',
  'admin_application_read','admin_application_update','admin_enquiry_read','admin_enquiry_update','admin_units_manage',
  'scoped_admin_units_delete','scoped_applications_update'))
 or (schemaname='storage' and policyname in
  ('admin_public_media_upload','admin_public_media_update','admin_public_media_delete'));

-- Check whether CLI migration history is available. Manual SQL Editor runs may
-- not create rows in this table, so also compare the schema/policy results above.
select to_regclass('supabase_migrations.schema_migrations') as migration_history_table;

-- This Super Admin identity should remain unchanged before and after migration.
select u.id, u.email, r.role, p.is_active, p.account_status
from auth.users u
left join public.user_roles r on r.user_id=u.id
left join public.profiles p on p.id=u.id
where u.id='75493860-6055-4c5d-8f1b-475f5e690315'::uuid;
