import { NextResponse } from 'next/server';
import { canReviewStage, getAdminActor, isUnitInScope } from '../../../auth/admin';

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PENDING_STAGES = ['pending_coordinator', 'pending_manager', 'pending_admin'] as const;

export async function GET() {
  const { actor, db, error } = await getAdminActor();
  if (!actor || !db) return NextResponse.json({ error: error || 'अनुमति नहीं है।' }, { status: 403 });

  const { data, error: queryError } = await db
    .from('membership_applications')
    .select('id,full_name,mobile,email,state,message,status,approval_stage,assigned_unit_id,created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (queryError) return NextResponse.json({ error: 'आवेदन लोड नहीं हुए। migration लागू है?' }, { status: 503 });

  const applications = [];
  for (const app of data || []) {
    if (await canReviewStage(db, actor, app)) applications.push(app);
  }
  return NextResponse.json({ applications, actor_role: actor.role }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const { actor, db, error } = await getAdminActor();
  if (!actor || !db) return NextResponse.json({ error: error || 'अनुमति नहीं है।' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
  } catch {
    return NextResponse.json({ error: 'अमान्य अनुरोध।' }, { status: 400 });
  }

  // Actor identity and role always come from the verified server session.
  const id = typeof body.application_id === 'string' ? body.application_id : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!UUID_PATTERN.test(id) || !['advance', 'approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'अमान्य आवेदन कार्य।' }, { status: 400 });
  }

  const { data: app, error: appError } = await db
    .from('membership_applications')
    .select('id,status,approval_stage,assigned_unit_id,email,full_name')
    .eq('id', id)
    .maybeSingle();
  if (appError) return NextResponse.json({ error: 'आवेदन की जाँच नहीं हो सकी।' }, { status: 503 });
  if (!app || app.status !== 'pending') return NextResponse.json({ error: 'लंबित आवेदन नहीं मिला।' }, { status: 404 });
  if (!await canReviewStage(db, actor, app)) {
    return NextResponse.json({ error: 'यह आवेदन आपके चरण या संगठन क्षेत्र में नहीं है।' }, { status: 403 });
  }
  if (!PENDING_STAGES.includes(app.approval_stage as (typeof PENDING_STAGES)[number])) {
    return NextResponse.json({ error: 'आवेदन का समीक्षा चरण मान्य नहीं है।' }, { status: 409 });
  }

  if (action === 'advance') {
    if (!['coordinator', 'manager', 'super_admin'].includes(actor.role)) {
      return NextResponse.json({ error: 'इस समीक्षा चरण की अनुमति नहीं है।' }, { status: 403 });
    }
    const nextStage = app.approval_stage === 'pending_coordinator'
      ? 'pending_manager'
      : app.approval_stage === 'pending_manager'
        ? 'pending_admin'
        : null;
    if (!nextStage) return NextResponse.json({ error: 'यह आवेदन अगले समीक्षा चरण में नहीं जा सकता।' }, { status: 409 });

    const reviewFields = app.approval_stage === 'pending_coordinator'
      ? { coordinator_reviewed_by: actor.user.id, coordinator_reviewed_at: new Date().toISOString() }
      : { manager_reviewed_by: actor.user.id, manager_reviewed_at: new Date().toISOString() };
    const { data: updatedRows, error: updateError } = await db
      .from('membership_applications')
      .update({ ...reviewFields, approval_stage: nextStage })
      .eq('id', id)
      .eq('status', 'pending')
      .eq('approval_stage', app.approval_stage)
      .select('id');
    if (updateError) return NextResponse.json({ error: 'समीक्षा चरण अपडेट नहीं हुआ।' }, { status: 503 });
    if (updatedRows?.length !== 1) {
      return NextResponse.json({ error: 'आवेदन किसी अन्य अनुरोध से बदल चुका है; इसे फिर से लोड करें।' }, { status: 409 });
    }

    const { error: logError } = await db.from('activity_logs').insert({
      actor_id: actor.user.id,
      target_application_id: id,
      org_unit_id: app.assigned_unit_id,
      action: `membership.review.${app.approval_stage}`,
      entity_type: 'membership_applications',
      entity_id: id,
      details: { next_stage: nextStage },
    });
    if (logError) return NextResponse.json({ error: 'चरण अपडेट हुआ, लेकिन audit entry नहीं लिखी जा सकी।' }, { status: 500 });
    return NextResponse.json({ ok: true, approval_stage: nextStage });
  }

  if (!['admin', 'super_admin'].includes(actor.role)) {
    return NextResponse.json({ error: 'अंतिम निर्णय केवल Admin या Super Admin कर सकता है।' }, { status: 403 });
  }
  if (actor.role === 'admin' && app.approval_stage !== 'pending_admin') {
    return NextResponse.json({ error: 'अंतिम निर्णय केवल Admin समीक्षा चरण में किया जा सकता है।' }, { status: 403 });
  }

  if (action === 'reject') {
    const reason = String(body.reason || '').trim().slice(0, 1000);
    if (reason.length < 3) return NextResponse.json({ error: 'अस्वीकृति का संक्षिप्त कारण लिखें।' }, { status: 400 });

    const { data: updatedRows, error: updateError } = await db
      .from('membership_applications')
      .update({
        status: 'rejected',
        approval_stage: 'rejected',
        reviewed_by: actor.user.id,
        reviewed_at: new Date().toISOString(),
        final_reviewed_by: actor.user.id,
        final_reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .eq('approval_stage', app.approval_stage)
      .select('id');
    if (updateError) return NextResponse.json({ error: 'आवेदन अस्वीकार नहीं हुआ।' }, { status: 503 });
    if (updatedRows?.length !== 1) {
      return NextResponse.json({ error: 'आवेदन किसी अन्य अनुरोध से बदल चुका है; इसे फिर से लोड करें।' }, { status: 409 });
    }

    const { error: logError } = await db.from('activity_logs').insert({
      actor_id: actor.user.id,
      target_application_id: id,
      org_unit_id: app.assigned_unit_id,
      action: 'membership.rejected',
      entity_type: 'membership_applications',
      entity_id: id,
      details: { reason },
    });
    if (logError) return NextResponse.json({ error: 'आवेदन अस्वीकार हुआ, लेकिन audit entry नहीं लिखी जा सकी।' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const requestedUnitId = typeof body.unit_id === 'string' ? body.unit_id : '';
  const unitId = requestedUnitId || app.assigned_unit_id || '';
  if (!UUID_PATTERN.test(unitId) || !await isUnitInScope(db, actor, unitId)) {
    return NextResponse.json({ error: 'स्वीकृति के लिए अपने क्षेत्र की संगठन इकाई चुनें।' }, { status: 403 });
  }

  const designationId = typeof body.designation_id === 'string' && body.designation_id
    ? body.designation_id
    : null;
  if (designationId) {
    if (!UUID_PATTERN.test(designationId)) return NextResponse.json({ error: 'पदनाम मान्य नहीं है।' }, { status: 400 });
    const { data: designation, error: designationError } = await db
      .from('designations')
      .select('id,active')
      .eq('id', designationId)
      .maybeSingle();
    if (designationError) return NextResponse.json({ error: 'पदनाम की जाँच नहीं हो सकी।' }, { status: 503 });
    if (!designation?.active) return NextResponse.json({ error: 'संगठन द्वारा स्वीकृत पदनाम चुनें।' }, { status: 400 });
  }

  const { data: authList, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) return NextResponse.json({ error: 'मौजूदा Auth खाते की जाँच नहीं हो सकी।' }, { status: 503 });
  let targetUser = (authList.users || []).find(
    (user) => user.email?.toLowerCase() === String(app.email || '').toLowerCase(),
  );
  let createdByThisRequest = false;

  if (targetUser) {
    const [{ data: roleRows, error: roleError }, { data: member, error: memberError }] = await Promise.all([
      db.from('user_roles').select('role').eq('user_id', targetUser.id),
      db.from('members').select('id').eq('user_id', targetUser.id).maybeSingle(),
    ]);
    if (roleError || memberError) return NextResponse.json({ error: 'मौजूदा खाते की सुरक्षा जाँच नहीं हो सकी।' }, { status: 503 });
    const existingRoles = (roleRows || []).map((row) => row.role);
    if (member || existingRoles.some((role) => role !== 'member') || targetUser.banned_until) {
      return NextResponse.json({ error: 'इस ईमेल का दूसरा सक्रिय/विशेषाधिकार वाला खाता है। Admin से जाँच कराएँ; भूमिका नहीं बदली गई।' }, { status: 409 });
    }
  } else {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const { data: invite, error: inviteError } = await db.auth.admin.inviteUserByEmail(app.email, {
      data: { full_name: app.full_name },
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/dashboard/member')}`,
    });
    if (inviteError || !invite.user) return NextResponse.json({ error: 'सदस्य निमंत्रण ईमेल भेजा नहीं जा सका।' }, { status: 503 });
    targetUser = invite.user;
    createdByThisRequest = true;
  }

  const { data: memberId, error: rpcError } = await db.rpc('approve_membership_application', {
    p_application_id: id,
    p_user_id: targetUser.id,
    p_actor_id: actor.user.id,
    p_unit_id: unitId,
    p_designation_id: designationId,
  });
  if (rpcError || !memberId) {
    let invitationCleanupFailed = false;
    if (createdByThisRequest) {
      const { error: cleanupError } = await db.auth.admin.deleteUser(targetUser.id);
      invitationCleanupFailed = Boolean(cleanupError);
    }
    return NextResponse.json({
      error: invitationCleanupFailed
        ? 'स्वीकृति पूरी नहीं हुई और नया invitation account हटाया नहीं जा सका; Admin को जाँच करनी होगी।'
        : 'सदस्य रिकॉर्ड और स्वीकृति पूरी नहीं हुई। आवेदन लंबित है; RPC status जाँचें।',
    }, { status: 503 });
  }

  const { error: notificationError } = await db.from('notifications').insert({
    user_id: targetUser.id,
    title: 'सदस्यता स्वीकृत',
    body: 'आपका सदस्यता आवेदन स्वीकृत हो गया है। अपना ईमेल invitation खोलकर password सेट करें।',
    channel: 'in_app',
    delivery_status: 'queued',
  });
  return NextResponse.json({ ok: true, member_id: memberId, notification_logged: !notificationError }, { status: 200 });
}
