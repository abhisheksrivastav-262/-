import { NextResponse } from 'next/server';
import { getAdminActor, isUnitInScope } from '../../../../../auth/admin';
import { deriveMembershipStatus } from '../../../../../id-card-domain';
import { getMemberPhotoUrl } from '../../../../../id-card-server';

export const runtime = 'nodejs';
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { actor, db, error } = await getAdminActor();
  if (!actor || !db) return NextResponse.json({ error: error || 'अनुमति नहीं है।' }, { status: 403 });
  if (!['super_admin', 'admin'].includes(actor.role)) return NextResponse.json({ error: 'केवल Admin और Super Admin ID Card देख सकते हैं।' }, { status: 403 });
  const { memberId } = await params;
  if (!UUID_PATTERN.test(memberId)) return NextResponse.json({ error: 'सदस्य संदर्भ मान्य नहीं है।' }, { status: 400 });

  const { data: member, error: memberError } = await db
    .from('members')
    .select('id,user_id,full_name,mobile,membership_no,status,unit_id,designation_id,photo_path,public_photo,valid_until')
    .eq('id', memberId)
    .maybeSingle();
  if (memberError) return NextResponse.json({ error: 'सदस्य कार्ड लोड नहीं हुआ।' }, { status: 503 });
  if (!member || member.status !== 'approved' || !member.membership_no?.trim()) return NextResponse.json({ error: 'केवल स्वीकृत और सक्रिय सदस्यता रिकॉर्ड का ID Card उपलब्ध है।' }, { status: 404 });
  if (actor.role !== 'super_admin' && !await isUnitInScope(db, actor, member.unit_id)) {
    return NextResponse.json({ error: 'यह सदस्य आपके संगठन क्षेत्र में नहीं है।' }, { status: 403 });
  }

  const [{ data: card, error: cardError }, profileResult, unitResult, designationResult] = await Promise.all([
    db.from('id_cards').select('id,member_id,valid_until,revoked_at,created_at,reissued_at').eq('member_id', member.id).maybeSingle(),
    member.user_id ? db.from('profiles').select('is_active,account_status').eq('id', member.user_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    member.unit_id ? db.from('organizational_units').select('name,state,district').eq('id', member.unit_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    member.designation_id ? db.from('designations').select('name').eq('id', member.designation_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (cardError || profileResult.error || unitResult.error || designationResult.error) {
    return NextResponse.json({ error: 'ID Card विवरण उपलब्ध नहीं हैं।' }, { status: 503 });
  }
  if (!card) return NextResponse.json({ error: 'ID Card जारी नहीं हुआ है।' }, { status: 404 });
  if (member.user_id && (!profileResult.data?.is_active || profileResult.data.account_status !== 'active')) {
    return NextResponse.json({ error: 'निष्क्रिय सदस्य खाते का ID Card उपलब्ध नहीं है।' }, { status: 404 });
  }
  const status = deriveMembershipStatus({
    hasCard: true,
    revoked: Boolean(card.revoked_at),
    memberStatus: member.status,
    accountStatus: profileResult.data?.account_status ?? (member.user_id ? 'inactive' : 'active'),
    profileActive: profileResult.data?.is_active ?? !member.user_id,
    cardValidUntil: card.valid_until,
    memberValidUntil: member.valid_until,
  });
  const photoUrl = await getMemberPhotoUrl(db, member.photo_path, member.public_photo === true);
  return NextResponse.json({
    card: {
      id: card.id,
      member_id: member.id,
      full_name: member.full_name,
      mobile: member.mobile,
      membership_no: member.membership_no,
      member_status: member.status,
      designation: designationResult.data?.name || null,
      unit: unitResult.data?.name || null,
      unit_location: [unitResult.data?.district, unitResult.data?.state].filter(Boolean).join(', ') || null,
      photo_url: photoUrl,
      issued_at: card.reissued_at || card.created_at,
      valid_until: member.valid_until || card.valid_until || null,
      status,
      qr_image_url: `/api/admin/members/${member.id}/id-card/qr?v=${encodeURIComponent(card.reissued_at || card.created_at)}`,
    },
  }, { headers: { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' } });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { actor, db, error } = await getAdminActor();
  if (!actor || !db) return NextResponse.json({ error: error || 'अनुमति नहीं है।' }, { status: 403 });
  if (!['super_admin', 'admin'].includes(actor.role)) return NextResponse.json({ error: 'केवल Admin और Super Admin ID Card दोबारा जारी कर सकते हैं।' }, { status: 403 });
  const { memberId } = await params;
  if (!UUID_PATTERN.test(memberId)) return NextResponse.json({ error: 'सदस्य संदर्भ मान्य नहीं है।' }, { status: 400 });

  const { data: member, error: memberError } = await db
    .from('members')
    .select('id,user_id,membership_no,status,unit_id')
    .eq('id', memberId)
    .maybeSingle();
  if (memberError) return NextResponse.json({ error: 'सदस्य स्थिति जाँची नहीं जा सकी।' }, { status: 503 });
  if (!member || member.status !== 'approved' || !member.membership_no?.trim()) return NextResponse.json({ error: 'केवल स्वीकृत सदस्य का ID Card दोबारा जारी हो सकता है।' }, { status: 404 });
  if (actor.role !== 'super_admin' && !await isUnitInScope(db, actor, member.unit_id)) {
    return NextResponse.json({ error: 'यह सदस्य आपके संगठन क्षेत्र में नहीं है।' }, { status: 403 });
  }
  if (member.user_id) {
    const { data: profile, error: profileError } = await db.from('profiles')
      .select('is_active,account_status').eq('id', member.user_id).maybeSingle();
    if (profileError || !profile?.is_active || profile.account_status !== 'active') {
      return NextResponse.json({ error: 'निष्क्रिय सदस्य खाते का ID Card दोबारा जारी नहीं हो सकता।' }, { status: 404 });
    }
  }

  // The database RPC locks the member/card and atomically rotates the token
  // generation/hash while preserving the stable card ID. No raw QR token returns.
  const { data: cardId, error: cardError } = await db.rpc('reissue_member_id_card', {
    p_member_id: member.id,
  });
  if (cardError) {
    const status = cardError.code === 'P0002' ? 404 : cardError.code === '42501' ? 403 : 503;
    return NextResponse.json({ error: status === 404 ? 'ID Card रिकॉर्ड उपलब्ध नहीं है।' : 'ID Card दोबारा जारी नहीं हुआ।' }, { status });
  }
  if (typeof cardId !== 'string' || !UUID_PATTERN.test(cardId)) {
    return NextResponse.json({ error: 'ID Card दोबारा जारी नहीं हुआ।' }, { status: 503 });
  }

  await db.from('activity_logs').insert({
    actor_id: actor.user.id,
    org_unit_id: member.unit_id,
    action: 'membership.id_card.reissued',
    entity_type: 'id_cards',
    entity_id: cardId,
    details: { member_id: member.id, token_generation_rotated: true },
  });
  return NextResponse.json({ ok: true, card_id: cardId }, { headers: { 'Cache-Control': 'no-store' } });
}
