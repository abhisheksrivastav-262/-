-- Run once in Supabase SQL Editor after migrations 001 and 002 have succeeded.
-- First create/invite your own user in Supabase Dashboard > Authentication > Users.
-- Replace the UUID below with that user's Auth user ID. Never use the publishable key here.
insert into public.user_roles(user_id, role)
values ('REPLACE_WITH_YOUR_AUTH_USER_UUID'::uuid, 'super_admin'::public.app_role)
on conflict (user_id, role) do nothing;

-- Verify the bootstrap account is active and has the expected role.
select u.id, u.email, p.full_name, p.is_active, r.role
from auth.users u
join public.profiles p on p.id = u.id
join public.user_roles r on r.user_id = u.id
where u.id = 'REPLACE_WITH_YOUR_AUTH_USER_UUID'::uuid
  and r.role = 'super_admin'::public.app_role;
