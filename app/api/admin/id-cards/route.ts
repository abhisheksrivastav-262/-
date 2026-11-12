import { NextResponse } from 'next/server';
import { getAdminActor, isUnitInScope } from '../../../auth/admin';
import { deriveMembershipStatus } from '../../../id-card-domain';

export const runtime = 'nodejs';

export async function GET() {
  const { actor, db, error } = await getAdminActor();
  if (!actor || !db) return NextResponse.json({ error: error || 'अनुमति नहीं है।' }, { status: 403 });
  if (!['super_admin', 'admin'].includes(actor.role)) return NextResponse.json({ error: 'केवल Admin और Super Admin ID Card देख सकते हैं।' }, { status: 403 });

  const { data: cards, error: cardError } = await db
    .from('id_cards')
    .select('id,member_id,valid_until,revoked_at,created_at')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (cardError) return NextResponse.json({ error: 'ID Card सूची उपलब्ध नहीं है। Card migration लागू है?' }, { status: 503 });
  const memberIds = [...new Set((cards || []).map((card) => card.member_id).filter(Boolean))];
  if (!memberIds.length) return NextResponse.json({ cards: [] }, { headers: { 'Cache-Control': 'private, no-store' } });

  const { data: members, error: memberError } = await db
    .from('members')
    .select('id,user_id,full_name,membership_no,status,unit_id,designation_id,valid_until')
    .in('id', memberIds);
  if (memberError) return NextResponse.json({ error: 'सदस्य कार्ड सूची लोड नहीं हुई।' }, { status: 503 });

  const memberMap = new Map((members || []).map((member) => [member.id, member]));
  const scoped = [];
  for (const card of cards || []) {
    const member = memberMap.get(card.member_id);
    if (!member) continue;
    if (actor.role !== 'super_admin' && !await isUnitInScope(db, actor, member.unit_id)) continue;
    scoped.push({ card, member });
  }
  if (!scoped.length) return NextResponse.json({ cards: [] }, { headers: { 'Cache-Control': 'private, no-store' } });

  const unitIds = [...new Set(scoped.map(({ member }) => member.unit_id).filter(Boolean))];
  const designationIds = [...new Set(scoped.map(({ member }) => member.designation_id).filter(Boolean))];
  const userIds = [...new Set(scoped.map(({ member }) => member.user_id).filter(Boolean))];
  const [unitResult, designationResult, profileResult] = await Promise.all([
    unitIds.length ? db.from('organizational_units').select('id,name').in('id', unitIds) : Promise.resolve({ data: [], error: null }),
    designationIds.length ? db.from('designations').select('id,name').in('id', designationIds) : Promise.resolve({ data: [], error: null }),
    userIds.length ? db.from('profiles').select('id,is_active,account_status').in('id', userIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (unitResult.error || designationResult.error || profileResult.error) {
    return NextResponse.json({ error: 'ID Card की स्थिति जाँची नहीं जा सकी।' }, { status: 503 });
  }
  const units = new Map((unitResult.data || []).map((unit) => [unit.id, unit.name]));
  const designations = new Map((designationResult.data || []).map((designation) => [designation.id, designation.name]));
  const profiles = new Map((profileResult.data || []).map((profile) => [profile.id, profile]));

  const result = scoped.map(({ card, member }) => {
    const profile = profiles.get(member.user_id);
    return {
      member_id: member.id,
      full_name: member.full_name,
      membership_no: member.membership_no,
      member_status: member.status,
      designation: designations.get(member.designation_id) || null,
      unit: units.get(member.unit_id) || null,
      valid_until: member.valid_until || card.valid_until || null,
      status: deriveMembershipStatus({
        hasCard: true,
        revoked: Boolean(card.revoked_at),
        memberStatus: member.status,
        accountStatus: profile?.account_status ?? (member.user_id ? 'inactive' : 'active'),
        profileActive: profile?.is_active ?? !member.user_id,
        cardValidUntil: card.valid_until,
        memberValidUntil: member.valid_until,
      }),
    };
  });
  return NextResponse.json({ cards: result }, { headers: { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' } });
}
