import 'server-only';

import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll: ((cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; middleware refreshes them.
        }
      }) as SetAllCookies,
    },
  });
}

export const roles = ['super_admin', 'admin', 'manager', 'coordinator', 'member'] as const;
export type AppRole = (typeof roles)[number];
export const roleLabels: Record<AppRole, string> = {
  super_admin: 'सुपर एडमिन',
  admin: 'एडमिन',
  manager: 'मैनेजर',
  coordinator: 'कोऑर्डिनेटर',
  member: 'सदस्य',
};

export async function getVerifiedRole() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { supabase: null, user: null, role: null as AppRole | null, roles: [] as AppRole[], active: false };

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { supabase, user: null, role: null as AppRole | null, roles: [] as AppRole[], active: false };
  }

  const [{ data: profile, error: profileError }, { data: rolesData, error: rolesError }] = await Promise.all([
    supabase.from('profiles').select('is_active,account_status').eq('id', user.id).maybeSingle(),
    // This query runs through the cookie-backed user session, never service role.
    supabase.from('user_roles').select('role').eq('user_id', user.id),
  ]);

  if (profileError || rolesError || !profile) {
    return { supabase, user, role: null as AppRole | null, roles: [] as AppRole[], active: false };
  }

  const assignedRoles = (rolesData || [])
    .map((row) => row.role as AppRole)
    .filter((role) => roles.includes(role));
  const role = roles.find((candidate) => assignedRoles.includes(candidate)) || null;
  const active = profile.is_active === true && profile.account_status === 'active';

  return { supabase, user, role, roles: assignedRoles, active };
}
