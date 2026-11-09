-- Migration 008: extend the existing membership workflow for private public applications.
-- Additive only: existing application/member rows and numbering are preserved.
-- Do not run automatically from the application; apply through reviewed Supabase migrations.

begin;

do $$
declare
  unexpected_storage_policies text;
  invalid_storage_policies text;
begin
  if to_regclass('public.membership_applications') is null
     or to_regclass('public.members') is null
     or to_regclass('public.membership_number_seq') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Migration 008 requires the existing membership workflow and Supabase Storage schema.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='membership_applications'
      and column_name='approval_stage'
  ) then
    raise exception 'Migration 008 requires migration 004 membership approval stages.';
  end if;
  if to_regclass('public.membership_applications_pending_email_uidx') is null
     or to_regclass('public.membership_applications_pending_mobile_idx') is null
     or not exists (
       select 1 from pg_index
       where indexrelid=to_regclass('public.membership_applications_pending_email_uidx') and indisvalid and indisunique
     )
     or not exists (
       select 1 from pg_index
       where indexrelid=to_regclass('public.membership_applications_pending_mobile_idx') and indisvalid
     ) then
    raise exception 'Migration 008 requires the valid pending-email and mobile indexes from migrations 004/007.';
  end if;
  if to_regprocedure('public.assign_membership_number()') is null
     or not exists (
       select 1 from pg_trigger t
       where t.tgrelid='public.members'::regclass
         and t.tgname='members_assign_membership_number'
         and not t.tgisinternal
         and t.tgenabled <> 'D'
         and t.tgfoid=to_regprocedure('public.assign_membership_number()')::oid
     ) then
    raise exception 'Migration 008 requires the existing approved-member membership-number trigger.';
  end if;
  if exists (
    select 1 from storage.buckets
    where id='membership-application-photos' and public is true
  ) then
    raise exception 'The membership application photo bucket already exists as public; review it before continuing.';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='storage' and c.relname='objects' and c.relrowsecurity
  ) then
    raise exception 'Storage object row-level security must be enabled for private membership photos.';
  end if;

  -- The four reviewed public-media policies are the complete allowlist for
  -- storage.objects. Do not infer safety from a substring or an equality:
  -- compare each policy's deparsed predicate to the exact approved expression.
  -- This rejects NOT, OR, ALL, missing checks, unknown names, and any predicate
  -- that could widen access to membership-application-photos.
  select string_agg(p.policyname, ', ' order by p.policyname)
    into unexpected_storage_policies
  from pg_policies p
  where p.schemaname='storage' and p.tablename='objects'
    and p.policyname not in (
      'public_media_read',
      'super_admin_public_media_upload',
      'super_admin_public_media_update',
      'super_admin_public_media_delete'
    );
  if unexpected_storage_policies is not null then
    raise exception 'Unknown storage.objects policies require manual review: %', unexpected_storage_policies;
  end if;

  with expected(policyname, cmd, roles, using_expr, check_expr) as (
    values
      ('public_media_read', 'SELECT', array['anon','authenticated']::name[],
       'bucket_id=''public-media''::text', null::text),
      ('super_admin_public_media_upload', 'INSERT', array['authenticated']::name[],
       null::text,
       'bucket_id=''public-media''::textandhas_rolearray[''super_admin''::app_role]'),
      ('super_admin_public_media_update', 'UPDATE', array['authenticated']::name[],
       'bucket_id=''public-media''::textandhas_rolearray[''super_admin''::app_role]',
       'bucket_id=''public-media''::textandhas_rolearray[''super_admin''::app_role]'),
      ('super_admin_public_media_delete', 'DELETE', array['authenticated']::name[],
       'bucket_id=''public-media''::textandhas_rolearray[''super_admin''::app_role]',
       null::text)
  )
  select string_agg(e.policyname, ', ' order by e.policyname)
    into invalid_storage_policies
  from expected e
  left join pg_policies p
    on p.schemaname='storage'
   and p.tablename='objects'
   and p.policyname=e.policyname
  where p.policyname is null
     or p.permissive<>'PERMISSIVE'
     or p.cmd<>e.cmd
     or cardinality(p.roles)<>cardinality(e.roles)
     or not (p.roles @> e.roles)
     or case when p.qual is null then null else
          regexp_replace(regexp_replace(lower(p.qual), '[[:space:]()]', '', 'g'), 'public\.', '', 'g')
        end
          is distinct from e.using_expr
     or case when p.with_check is null then null else
          regexp_replace(regexp_replace(lower(p.with_check), '[[:space:]()]', '', 'g'), 'public\.', '', 'g')
        end
          is distinct from e.check_expr;
  if invalid_storage_policies is not null then
    raise exception 'A required public-media policy is missing or differs from its exact approved definition: %', invalid_storage_policies;
  end if;
end;
$$;

alter table public.membership_applications
  add column if not exists parent_name text,
  add column if not exists date_of_birth date,
  add column if not exists gender text,
  add column if not exists occupation text,
  add column if not exists education text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists district text,
  add column if not exists tehsil text,
  add column if not exists block text,
  add column if not exists pincode text,
  add column if not exists referrer_name text,
  add column if not exists referrer_member_no text,
  add column if not exists photo_path text,
  add column if not exists photo_mime_type text,
  add column if not exists declaration_accepted boolean not null default false;

alter table public.members
  add column if not exists parent_name text,
  add column if not exists gender text,
  add column if not exists occupation text,
  add column if not exists education text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists tehsil text,
  add column if not exists block text,
  add column if not exists pincode text,
  add column if not exists referrer_name text,
  add column if not exists referrer_member_no text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.membership_applications'::regclass and conname='membership_applications_photo_path_check') then
    alter table public.membership_applications
      add constraint membership_applications_photo_path_check
      check (photo_path is null or photo_path ~ '^applications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png)$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.membership_applications'::regclass and conname='membership_applications_photo_mime_check') then
    alter table public.membership_applications
      add constraint membership_applications_photo_mime_check
      check (photo_mime_type is null or photo_mime_type in ('image/jpeg','image/png'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.membership_applications'::regclass and conname='membership_applications_photo_pair_check') then
    alter table public.membership_applications
      add constraint membership_applications_photo_pair_check
      check ((photo_path is null) = (photo_mime_type is null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.membership_applications'::regclass and conname='membership_applications_gender_check') then
    alter table public.membership_applications
      add constraint membership_applications_gender_check
      check (gender is null or gender in ('male','female','other','prefer_not_to_say'));
  end if;
end;
$$;

-- Private bucket: no anon/authenticated Storage policies are added. The server
-- uploads with its server-only service client and issues short-lived signed URLs
-- only after the reviewer passes the existing role and scope checks.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('membership-application-photos','membership-application-photos',false,4194304,array['image/jpeg','image/png'])
on conflict(id) do nothing;

do $$
declare b storage.buckets%rowtype;
begin
  select * into b from storage.buckets where id='membership-application-photos';
  if not found or b.public is true or b.file_size_limit is distinct from 4194304
     or b.allowed_mime_types is null or cardinality(b.allowed_mime_types) <> 2
     or not (b.allowed_mime_types @> array['image/jpeg','image/png']) then
    raise exception 'Membership application photo bucket must remain private with the reviewed 4 MB JPG/PNG limits.';
  end if;
end;
$$;

-- Public submissions now pass through the validated server route. This prevents
-- callers from bypassing required photo, duplicate, and field validation with a
-- direct PostgREST insert. Keep the existing RLS policy as an additional guard.
revoke insert on public.membership_applications from public, anon, authenticated;
grant select,insert on public.membership_applications to service_role;

-- Serialize requests for the same normalized email/mobile pair. The existing
-- pending-email unique index remains intact; the mobile index from migration
-- 007 is intentionally non-unique to preserve pre-existing duplicate data.
create or replace function public.submit_membership_application(
  p_full_name text,
  p_parent_name text,
  p_date_of_birth date,
  p_gender text,
  p_occupation text,
  p_education text,
  p_mobile text,
  p_email text,
  p_state text,
  p_district text,
  p_tehsil text,
  p_block text,
  p_address_line1 text,
  p_address_line2 text,
  p_pincode text,
  p_referrer_name text,
  p_referrer_member_no text,
  p_photo_path text,
  p_photo_mime_type text,
  p_declaration_accepted boolean,
  p_message text,
  p_assigned_unit_id uuid
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog, public
as $$
declare
  email_lock bigint;
  mobile_lock bigint;
  application_id uuid;
  normalized_email text := lower(trim(coalesce(p_email,'')));
  normalized_mobile text := regexp_replace(coalesce(p_mobile,''),'[^0-9]','','g');
begin
  if p_declaration_accepted is distinct from true
     or nullif(btrim(p_full_name),'') is null
     or nullif(btrim(p_parent_name),'') is null
     or p_date_of_birth is null or p_date_of_birth > current_date
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(normalized_email) > 254
     or length(normalized_mobile) < 10 or length(normalized_mobile) > 15
     or nullif(btrim(p_state),'') is null
     or nullif(btrim(p_district),'') is null
     or nullif(btrim(p_address_line1),'') is null
     or coalesce(btrim(p_pincode),'') !~ '^[0-9]{6}$'
     or (p_gender is not null and p_gender not in ('male','female','other','prefer_not_to_say'))
     or p_photo_path is null
     or p_photo_path !~ '^applications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$'
     or p_photo_mime_type is null
     or p_photo_mime_type not in ('image/jpeg','image/png')
     or (p_photo_mime_type='image/jpeg' and p_photo_path !~* '\.jpg$')
     or (p_photo_mime_type='image/png' and p_photo_path !~* '\.png$') then
    raise exception 'Membership application is incomplete' using errcode='22023';
  end if;
  if p_assigned_unit_id is not null and not exists (
    select 1 from public.organizational_units where id=p_assigned_unit_id and active
  ) then
    raise exception 'Organizational unit is not active' using errcode='22023';
  end if;

  email_lock := hashtextextended('membership-email:' || normalized_email,0);
  mobile_lock := hashtextextended('membership-mobile:' || normalized_mobile,0);
  if email_lock = mobile_lock then
    perform pg_advisory_xact_lock(email_lock);
  elsif email_lock < mobile_lock then
    perform pg_advisory_xact_lock(email_lock);
    perform pg_advisory_xact_lock(mobile_lock);
  else
    perform pg_advisory_xact_lock(mobile_lock);
    perform pg_advisory_xact_lock(email_lock);
  end if;

  if exists (
    select 1 from public.membership_applications
    where status='pending'
      and (email_normalized=normalized_email or mobile_normalized=normalized_mobile)
  ) then
    raise exception 'A pending application already exists for this email or mobile number' using errcode='23505';
  end if;

  insert into public.membership_applications(
    full_name,parent_name,date_of_birth,gender,occupation,education,mobile,email,
    state,district,tehsil,block,address_line1,address_line2,pincode,
    referrer_name,referrer_member_no,photo_path,photo_mime_type,
    declaration_accepted,message,status,assigned_unit_id,approval_stage
  ) values (
    trim(p_full_name),trim(p_parent_name),p_date_of_birth,nullif(p_gender,''),
    nullif(trim(p_occupation),''),nullif(trim(p_education),''),trim(p_mobile),trim(p_email),
    trim(p_state),trim(p_district),nullif(trim(p_tehsil),''),nullif(trim(p_block),''),
    trim(p_address_line1),nullif(trim(p_address_line2),''),trim(p_pincode),
    nullif(trim(p_referrer_name),''),nullif(trim(p_referrer_member_no),''),
    p_photo_path,p_photo_mime_type,true,nullif(trim(p_message),''),'pending',p_assigned_unit_id,
    case when p_assigned_unit_id is null then 'pending_admin' else 'pending_coordinator' end
  ) returning id into application_id;

  return application_id;
end;
$$;

revoke all on function public.submit_membership_application(text,text,date,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.submit_membership_application(text,text,date,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text,uuid) to service_role;

-- Keep the existing RPC and approval stages. Copy application details only when
-- final approval inserts the approved member; the existing trigger issues a
-- membership number only for that approved member row.
create or replace function public.approve_membership_application(
  p_application_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_unit_id uuid,
  p_designation_id uuid
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog, public
as $$
declare
  a public.membership_applications%rowtype;
  new_member_id uuid;
  target_email text;
  profile_rows integer;
  actor_authorized boolean;
  target_profile_valid boolean;
begin
  select * into a
  from public.membership_applications
  where id=p_application_id
  for update;

  if not found or a.status<>'pending' or a.approval_stage<>'pending_admin' then
    raise exception 'Application is not pending';
  end if;
  if a.email is null or trim(a.email)='' then
    raise exception 'Applicant email is required';
  end if;
  if not exists(select 1 from public.organizational_units where id=p_unit_id and active) then
    raise exception 'Active organizational unit is required';
  end if;
  if p_designation_id is not null and not exists(select 1 from public.designations where id=p_designation_id and active) then
    raise exception 'Designation is not active';
  end if;

  if a.assigned_unit_id is not null and a.assigned_unit_id<>p_unit_id then
    raise exception 'Approval unit must match the application unit';
  end if;

  select u.email into target_email
  from auth.users u
  where u.id=p_user_id;
  if target_email is null or lower(btrim(target_email))<>lower(btrim(a.email)) then
    raise exception 'Applicant account does not match the application email';
  end if;

  select (p.is_active is true and p.account_status='active')
    into target_profile_valid
  from public.profiles p
  where p.id=p_user_id
  for update;
  if target_profile_valid is distinct from true then
    raise exception 'Applicant profile is missing or inactive';
  end if;

  select exists (
    select 1
    from public.profiles p
    join public.user_roles r on r.user_id=p.id
    where p.id=p_actor_id
      and p.is_active is true
      and p.account_status='active'
      and r.role in ('admin','super_admin')
  ) into actor_authorized;
  if not actor_authorized then
    raise exception 'Final approval actor is not an active Admin or Super Admin';
  end if;

  -- Service-role calls have no authenticated auth.uid(), so enforce the
  -- verified actor's organizational scope directly against the hierarchy.
  -- Super Admins retain access to any active unit; Admins are limited to their
  -- own active unit and active descendants, with the traversal capped at 12.
  if not exists (
    select 1
    from public.user_roles r
    where r.user_id=p_actor_id
      and r.role='super_admin'::public.app_role
  ) and not exists (
    with recursive unit_ancestors(id,parent_id,active,depth) as (
      select u.id,u.parent_id,u.active,0
      from public.organizational_units u
      where u.id=p_unit_id

      union all

      select parent.id,parent.parent_id,parent.active,child.depth+1
      from unit_ancestors child
      join public.organizational_units parent on parent.id=child.parent_id
      where child.active is true and child.depth<11
    )
    select 1
    from public.user_roles r
    join public.profiles actor_profile on actor_profile.id=r.user_id
    join unit_ancestors scope_unit on scope_unit.id=actor_profile.org_unit_id
    where r.user_id=p_actor_id
      and r.role='admin'::public.app_role
      and actor_profile.is_active is true
      and actor_profile.account_status='active'
      and scope_unit.active is true
  ) then
    raise exception 'Admin approval unit is outside the actor organizational scope';
  end if;

  if exists (
    select 1 from public.user_roles r
    where r.user_id=p_user_id and r.role='super_admin'
  ) then
    raise exception 'A Super Admin account cannot be approved as a member';
  end if;
  if exists (select 1 from public.members m where m.user_id=p_user_id) then
    raise exception 'This user already has a member record';
  end if;

  update public.profiles
  set full_name=a.full_name,
      mobile=a.mobile,
      org_unit_id=p_unit_id,
      designation_id=p_designation_id,
      state=a.state,
      district=a.district,
      tehsil=a.tehsil,
      block=a.block,
      account_status='active'
  where id=p_user_id;

  get diagnostics profile_rows = row_count;
  if profile_rows<>1 then
    raise exception 'Applicant profile is missing';
  end if;

  if exists (
    select 1 from public.user_roles r
    where r.user_id=p_user_id and r.role<>'member'
  ) then
    raise exception 'Applicant account already has a privileged or non-member role';
  end if;

  insert into public.user_roles(user_id,role)
  values(p_user_id,'member')
  on conflict do nothing;

  insert into public.members(
    user_id,unit_id,designation_id,full_name,mobile,email,state,district,
    parent_name,date_of_birth,gender,occupation,education,address_line1,address_line2,
    tehsil,block,pincode,referrer_name,referrer_member_no,photo_path,status,approved_at
  ) values (
    p_user_id,p_unit_id,p_designation_id,a.full_name,a.mobile,a.email,a.state,a.district,
    a.parent_name,a.date_of_birth,a.gender,a.occupation,a.education,a.address_line1,a.address_line2,
    a.tehsil,a.block,a.pincode,a.referrer_name,a.referrer_member_no,a.photo_path,'approved',now()
  ) returning id into new_member_id;

  update public.membership_applications
  set status='approved',
      approval_stage='approved',
      reviewed_by=p_actor_id,
      reviewed_at=now(),
      final_reviewed_by=p_actor_id,
      final_reviewed_at=now()
  where id=p_application_id and status='pending' and approval_stage='pending_admin';

  if not found then
    raise exception 'Application changed before final approval could be recorded';
  end if;

  insert into public.activity_logs(
    actor_id,target_user_id,target_application_id,org_unit_id,action,entity_type,entity_id,details
  ) values (
    p_actor_id,p_user_id,p_application_id,p_unit_id,'membership.approved','members',new_member_id,
    jsonb_build_object('application_id',p_application_id)
  );

  return new_member_id;
end;
$$;

revoke all on function public.approve_membership_application(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_membership_application(uuid,uuid,uuid,uuid,uuid) to service_role;

commit;
