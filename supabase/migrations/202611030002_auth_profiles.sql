-- Profile lifecycle and account suspension. Roles are intentionally not inferred
-- from auth metadata and cannot be changed by a user-facing request.
alter table public.profiles add column is_active boolean not null default true;
revoke update on public.profiles from authenticated;
grant update(full_name,mobile) on public.profiles to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name)
  values(new.id,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)))
  on conflict(id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_auth_user() from public,anon,authenticated;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Privileged role assignment remains service-role-only. Existing self-read
-- policy lets a signed-in user discover only their own assigned role.
