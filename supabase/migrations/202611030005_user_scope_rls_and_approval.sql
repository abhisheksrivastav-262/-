-- Role-scoped reads and hierarchy management. The server admin API repeats
-- these scope checks because service-role clients bypass RLS.
drop policy if exists admin_units_manage on public.organizational_units;
create policy super_admin_units_manage on public.organizational_units for all to authenticated
  using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy scoped_admin_units_insert on public.organizational_units for insert to authenticated
  with check(public.has_role(array['admin']::public.app_role[]) and public.is_unit_in_my_scope(parent_id));
create policy scoped_admin_units_update on public.organizational_units for update to authenticated
  using(public.has_role(array['admin']::public.app_role[]) and public.is_unit_in_my_scope(id))
  with check(public.has_role(array['admin']::public.app_role[]) and public.is_unit_in_my_scope(parent_id));
create policy scoped_admin_units_delete on public.organizational_units for delete to authenticated
  using(public.has_role(array['admin']::public.app_role[]) and public.is_unit_in_my_scope(id));

create policy scoped_profiles_read on public.profiles for select to authenticated
  using(public.has_role(array['super_admin']::public.app_role[]) or public.is_unit_in_my_scope(org_unit_id));
create policy scoped_user_roles_read on public.user_roles for select to authenticated
  using(public.has_role(array['super_admin']::public.app_role[]) or exists(select 1 from public.profiles p where p.id=user_id and public.is_unit_in_my_scope(p.org_unit_id)));
create policy scoped_members_read on public.members for select to authenticated
  using(user_id=auth.uid() or public.is_unit_in_my_scope(unit_id));
create policy scoped_managers_read on public.managers for select to authenticated
  using(user_id=auth.uid() or public.is_unit_in_my_scope(unit_id));
create policy scoped_coordinators_read on public.coordinators for select to authenticated
  using(user_id=auth.uid() or public.is_unit_in_my_scope(unit_id));
create policy active_designations_read on public.designations for select to authenticated
  using(active or public.has_role(array['super_admin','admin']::public.app_role[]));
create policy super_admin_designations_manage on public.designations for all to authenticated
  using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));

drop policy if exists admin_application_read on public.membership_applications;
drop policy if exists admin_application_update on public.membership_applications;
create policy scoped_applications_read on public.membership_applications for select to authenticated
  using(public.has_role(array['super_admin']::public.app_role[]) or (assigned_unit_id is not null and public.is_unit_in_my_scope(assigned_unit_id)) or (assigned_unit_id is null and public.has_role(array['admin']::public.app_role[])));
create policy scoped_applications_update on public.membership_applications for update to authenticated
  using(public.has_role(array['super_admin']::public.app_role[]) or (assigned_unit_id is not null and public.is_unit_in_my_scope(assigned_unit_id)) or (assigned_unit_id is null and public.has_role(array['admin']::public.app_role[])))
  with check(public.has_role(array['super_admin','admin','manager','coordinator']::public.app_role[]));
revoke update on public.membership_applications from anon,authenticated;
drop policy if exists applications_public_submit on public.membership_applications;
create policy applications_public_submit on public.membership_applications for insert to anon,authenticated
  with check(status='pending' and reviewed_by is null and reviewed_at is null and final_reviewed_by is null
    and ((assigned_unit_id is null and approval_stage='pending_admin') or (assigned_unit_id is not null and approval_stage='pending_coordinator' and exists(select 1 from public.organizational_units u where u.id=assigned_unit_id and u.active))));

create policy scoped_activity_read on public.activity_logs for select to authenticated
  using(actor_id=auth.uid() or public.has_role(array['super_admin']::public.app_role[]) or public.is_unit_in_my_scope(org_unit_id));
create policy own_notifications_read on public.notifications for select to authenticated using(user_id=auth.uid());
create policy own_notifications_update on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

-- Called only by the server after Auth invitation succeeds. This transaction
-- links the invitation, role, profile, member row and final approval history.
create or replace function public.approve_membership_application(
  p_application_id uuid,p_user_id uuid,p_actor_id uuid,p_unit_id uuid,p_designation_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare a public.membership_applications%rowtype; new_member_id uuid;
begin
  select * into a from public.membership_applications where id=p_application_id for update;
  if not found or a.status<>'pending' then raise exception 'Application is not pending'; end if;
  if a.email is null or trim(a.email)='' then raise exception 'Applicant email is required'; end if;
  if not exists(select 1 from public.organizational_units where id=p_unit_id and active) then raise exception 'Active organizational unit is required'; end if;
  if p_designation_id is not null and not exists(select 1 from public.designations where id=p_designation_id and active) then raise exception 'Designation is not active'; end if;
  update public.profiles set full_name=a.full_name,mobile=a.mobile,org_unit_id=p_unit_id,designation_id=p_designation_id,state=a.state,account_status='active' where id=p_user_id;
  insert into public.user_roles(user_id,role) values(p_user_id,'member') on conflict do nothing;
  insert into public.members(user_id,unit_id,designation_id,full_name,mobile,email,state,status,approved_at)
    values(p_user_id,p_unit_id,p_designation_id,a.full_name,a.mobile,a.email,a.state,'approved',now()) returning id into new_member_id;
  update public.membership_applications set status='approved',approval_stage='approved',reviewed_by=p_actor_id,reviewed_at=now(),final_reviewed_by=p_actor_id,final_reviewed_at=now() where id=p_application_id;
  insert into public.activity_logs(actor_id,target_user_id,target_application_id,org_unit_id,action,entity_type,entity_id,details)
    values(p_actor_id,p_user_id,p_application_id,p_unit_id,'membership.approved','members',new_member_id,jsonb_build_object('application_id',p_application_id));
  return new_member_id;
end;
$$;
revoke all on function public.approve_membership_application(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_membership_application(uuid,uuid,uuid,uuid,uuid) to service_role;
