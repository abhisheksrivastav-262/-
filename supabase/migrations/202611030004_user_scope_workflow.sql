-- Non-destructive extension for scoped users, organizational assignments,
-- approval history, duplicate application protection and member numbering.
alter table public.profiles
  add column if not exists account_status text not null default 'active',
  add column if not exists org_unit_id uuid references public.organizational_units(id),
  add column if not exists designation_id uuid references public.designations(id),
  add column if not exists reporting_officer_id uuid references public.profiles(id),
  add column if not exists state text,
  add column if not exists district text,
  add column if not exists tehsil text,
  add column if not exists block text,
  add column if not exists area text,
  add column if not exists suspended_at timestamptz,
  add column if not exists created_by uuid references auth.users(id);
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check check(account_status in ('active','inactive','suspended'));
create index if not exists profiles_org_unit_idx on public.profiles(org_unit_id);
create index if not exists profiles_reporting_officer_idx on public.profiles(reporting_officer_id);
create unique index if not exists managers_user_uidx on public.managers(user_id);
create unique index if not exists coordinators_user_uidx on public.coordinators(user_id);

alter table public.membership_applications
  add column if not exists approval_stage text not null default 'pending_admin',
  add column if not exists assigned_unit_id uuid references public.organizational_units(id),
  add column if not exists coordinator_reviewed_by uuid references auth.users(id),
  add column if not exists coordinator_reviewed_at timestamptz,
  add column if not exists manager_reviewed_by uuid references auth.users(id),
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists final_reviewed_by uuid references auth.users(id),
  add column if not exists final_reviewed_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists email_normalized text generated always as (nullif(lower(trim(email)),'')) stored,
  add column if not exists mobile_normalized text generated always as (nullif(regexp_replace(coalesce(mobile,''),'[^0-9]','','g'),'')) stored;
alter table public.membership_applications drop constraint if exists membership_applications_approval_stage_check;
alter table public.membership_applications add constraint membership_applications_approval_stage_check check(approval_stage in ('pending_coordinator','pending_manager','pending_admin','approved','rejected'));
create unique index if not exists membership_applications_pending_email_uidx on public.membership_applications(email_normalized) where status='pending' and email_normalized is not null;
create unique index if not exists membership_applications_pending_mobile_uidx on public.membership_applications(mobile_normalized) where status='pending' and mobile_normalized is not null;
create index if not exists membership_applications_unit_stage_idx on public.membership_applications(assigned_unit_id,approval_stage,status);

alter table public.activity_logs
  add column if not exists target_user_id uuid references auth.users(id),
  add column if not exists target_application_id uuid references public.membership_applications(id),
  add column if not exists org_unit_id uuid references public.organizational_units(id);
create index if not exists activity_logs_target_user_idx on public.activity_logs(target_user_id,created_at desc);
create index if not exists activity_logs_unit_idx on public.activity_logs(org_unit_id,created_at desc);

create sequence if not exists public.membership_number_seq;
create or replace function public.assign_membership_number()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.membership_no is null or trim(new.membership_no)='' then
    new.membership_no := 'ABVDS-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.membership_number_seq')::text,6,'0');
  end if;
  return new;
end;
$$;
drop trigger if exists members_assign_membership_number on public.members;
create trigger members_assign_membership_number before insert on public.members
for each row execute function public.assign_membership_number();

create or replace function public.sync_profile_account_status()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.account_status='active' then new.is_active:=true; new.suspended_at:=null;
  else new.is_active:=false; if new.account_status='suspended' and new.suspended_at is null then new.suspended_at:=now(); end if; end if;
  return new;
end;
$$;
drop trigger if exists profiles_sync_account_status on public.profiles;
create trigger profiles_sync_account_status before insert or update of account_status,is_active on public.profiles
for each row execute function public.sync_profile_account_status();

create or replace function public.validate_organizational_unit_level()
returns trigger language plpgsql set search_path=public as $$
declare parent_level smallint; parent_active boolean;
begin
  if new.parent_id is null then
    if new.level<>1 then raise exception 'Root organizational units must be level 1'; end if;
  else
    select level,active into parent_level,parent_active from public.organizational_units where id=new.parent_id;
    if parent_level is null or not parent_active or new.level<>parent_level+1 then
      raise exception 'An organizational unit must be exactly one level below its active parent';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists organizational_units_validate_level on public.organizational_units;
create trigger organizational_units_validate_level before insert or update of parent_id,level on public.organizational_units
for each row execute function public.validate_organizational_unit_level();

create or replace function public.is_unit_in_my_scope(target_unit_id uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare actor_unit uuid;
begin
  if target_unit_id is null or auth.uid() is null then return false; end if;
  if public.has_role(array['super_admin']::public.app_role[]) then return true; end if;
  if not public.has_role(array['admin','manager','coordinator']::public.app_role[]) then return false; end if;
  select org_unit_id into actor_unit from public.profiles where id=auth.uid() and is_active and account_status='active';
  if actor_unit is null then return false; end if;
  return exists(
    with recursive scope(id) as (
      select id from public.organizational_units where id=actor_unit and active
      union all
      select child.id from public.organizational_units child join scope parent on child.parent_id=parent.id where child.active
    ) select 1 from scope where id=target_unit_id
  );
end;
$$;
revoke all on function public.is_unit_in_my_scope(uuid) from public;
grant execute on function public.is_unit_in_my_scope(uuid) to authenticated,service_role;

create or replace function public.can_create_role(target_role public.app_role)
returns boolean language sql stable security definer set search_path=public as $$
  select case
    when public.has_role(array['super_admin']::public.app_role[]) then target_role in ('admin','manager','coordinator','member')
    when public.has_role(array['admin']::public.app_role[]) then target_role in ('manager','coordinator','member')
    when public.has_role(array['manager']::public.app_role[]) then target_role in ('coordinator','member')
    when public.has_role(array['coordinator']::public.app_role[]) then target_role='member'
    else false end
$$;
revoke all on function public.can_create_role(public.app_role) from public;
grant execute on function public.can_create_role(public.app_role) to authenticated,service_role;
