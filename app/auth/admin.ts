import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { getVerifiedRole, type AppRole } from './server';

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
}

export type AdminActor = {
  user: { id: string; email?: string };
  role: AppRole;
  profile: {
    full_name: string;
    is_active: boolean;
    account_status: string;
    org_unit_id: string | null;
    designation_id: string | null;
    reporting_officer_id: string | null;
    state: string | null;
    district: string | null;
    tehsil: string | null;
    block: string | null;
    area: string | null;
  };
};

const ranks: Record<AppRole, number> = { super_admin: 5, admin: 4, manager: 3, coordinator: 2, member: 1 };
const creates: Record<AppRole, AppRole[]> = {
  super_admin: ['admin', 'manager', 'coordinator', 'member'],
  admin: ['manager', 'coordinator', 'member'],
  manager: ['coordinator', 'member'],
  coordinator: ['member'],
  member: [],
};
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function getAdminActor() {
  // Identity and role are derived from the authenticated user's cookie session.
  const session = await getVerifiedRole();
  if (!session.user || !session.active || !session.role) {
    return { actor: null, db: null, error: 'सक्रिय लॉगिन आवश्यक है।' };
  }
  if (!['super_admin', 'admin', 'manager', 'coordinator'].includes(session.role)) {
    return { actor: null, db: null, error: 'इस प्रबंधन क्षेत्र के लिए अनुमति नहीं है।' };
  }

  const db = createServiceClient();
  if (!db) return { actor: null, db: null, error: 'सर्वर database configuration उपलब्ध नहीं है।' };

  const { data: profile, error } = await db
    .from('profiles')
    .select('full_name,is_active,account_status,org_unit_id,designation_id,reporting_officer_id,state,district,tehsil,block,area')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error || !profile || !profile.is_active || profile.account_status !== 'active') {
    return { actor: null, db: null, error: 'खाता सक्रिय नहीं है या उपयोगकर्ता scope उपलब्ध नहीं है।' };
  }

  return { actor: { user: session.user, role: session.role, profile } as AdminActor, db, error: null };
}

export function canCreateRole(actor: AdminActor, role: AppRole) {
  return creates[actor.role].includes(role);
}

export function roleRank(role: AppRole) {
  return ranks[role];
}

export async function isUnitInScope(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  actor: AdminActor,
  targetUnitId: string | null | undefined,
) {
  if (!targetUnitId || !UUID_PATTERN.test(targetUnitId)) return false;
  if (actor.role === 'super_admin') {
    const { data: unit, error } = await db
      .from('organizational_units')
      .select('active')
      .eq('id', targetUnitId)
      .maybeSingle();
    return !error && unit?.active === true;
  }
  if (!actor.profile.org_unit_id || !UUID_PATTERN.test(actor.profile.org_unit_id)) return false;

  let current: string | null = targetUnitId;
  for (let hops = 0; current && hops < 12; hops++) {
    const { data, error }: { data: { parent_id: string | null; active: boolean } | null; error: unknown } = await db
      .from('organizational_units')
      .select('parent_id,active')
      .eq('id', current)
      .maybeSingle();
    if (error || !data || !data.active) return false;
    if (current === actor.profile.org_unit_id) return true;
    if (data.parent_id !== null && !UUID_PATTERN.test(data.parent_id)) return false;
    current = data.parent_id;
  }

  // Reaching the hop limit, a broken chain, or a cycle always fails closed.
  return false;
}

export async function getManagedUser(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  actor: AdminActor,
  targetId: string,
) {
  if (!UUID_PATTERN.test(targetId) || targetId === actor.user.id) return null;
  const [{ data: profile, error: profileError }, { data: roleRows, error: roleError }] = await Promise.all([
    db.from('profiles').select('id,full_name,mobile,is_active,account_status,org_unit_id,designation_id,reporting_officer_id,state,district,tehsil,block,area,created_at').eq('id', targetId).maybeSingle(),
    db.from('user_roles').select('role').eq('user_id', targetId),
  ]);
  if (profileError || roleError || !profile || (roleRows || []).length !== 1) return null;

  const assignedRole = (roleRows || [])[0].role as AppRole;
  if (!(assignedRole in ranks) || assignedRole === 'super_admin' || ranks[actor.role] <= ranks[assignedRole]) return null;
  if (actor.role !== 'super_admin' && !await isUnitInScope(db, actor, profile.org_unit_id)) return null;
  return { profile, role: assignedRole };
}

type ReviewableApplication = {
  approval_stage: string | null;
  assigned_unit_id: string | null;
};

export async function canReviewStage(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  actor: AdminActor,
  app: ReviewableApplication,
) {
  if (actor.role === 'super_admin') return true;
  // Admins must never review an unassigned application.
  if (!app.assigned_unit_id || !await isUnitInScope(db, actor, app.assigned_unit_id)) return false;
  if (actor.role === 'admin' && app.approval_stage === 'pending_admin') return true;
  if (actor.role === 'manager' && app.approval_stage === 'pending_manager') return true;
  if (actor.role === 'coordinator' && app.approval_stage === 'pending_coordinator') return true;
  return false;
}
