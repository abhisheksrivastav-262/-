import { NextResponse } from 'next/server';
import { getVerifiedRole } from '../../../auth/server';
import { createServiceClient } from '../../../auth/admin';
import { canIssueMembershipCard, deriveMembershipStatus } from '../../../id-card-domain';
import { getMemberPhotoUrl } from '../../../id-card-server';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getVerifiedRole();
  if (!session.user || !session.active) return NextResponse.json({ error: 'सक्रिय सदस्य लॉगिन आवश्यक है।' }, { status: 401 });
  if (session.role !== 'member') return NextResponse.json({ error: 'यह सदस्य कार्ड केवल सदस्य खाते के लिए है।' }, { status: 403 });

  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: 'सदस्य कार्ड सेवा कॉन्फ़िगर नहीं है।' }, { status: 503 });

  const { data: member, error: memberError } = await db
    .from('members')
    .select('id,user_id,full_name,mobile,membership_no,status,unit_id,designation_id,photo_path,public_photo,valid_until,approved_at')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (memberError) return NextResponse.json({ error: 'सदस्य कार्ड लोड नहीं हो सका।' }, { status: 503 });
  if (!member || member.status !== 'approved' || !canIssueMembershipCard(member.status, member.membership_no)) {
    return NextResponse.json({ error: 'अंतिम स्वीकृति और मौजूदा सदस्यता संख्या के बाद ही ID Card उपलब्ध होगा।' }, { status: 404 });
  }

  const { data: card, error: cardError } = await db
    .from('id_cards')
    .select('id,member_id,valid_until,revoked_at,created_at,reissued_at')
    .eq('member_id', member.id)
    .maybeSingle();
  if (cardError) return NextResponse.json({ error: 'ID Card उपलब्ध नहीं है। Card migration लागू होने की जाँच करें।' }, { status: 503 });
  if (!card) return NextResponse.json({ error: 'ID Card अभी जारी नहीं हुआ है।' }, { status: 404 });

  const [unitResult, designationResult, photoUrl] = await Promise.all([
    member.unit_id
      ? db.from('organizational_units').select('name,state,district').eq('id', member.unit_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    member.designation_id
      ? db.from('designations').select('name').eq('id', member.designation_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getMemberPhotoUrl(db, member.photo_path, member.public_photo === true),
  ]);
  if (unitResult.error || designationResult.error) return NextResponse.json({ error: 'ID Card विवरण लोड नहीं हुए।' }, { status: 503 });

  const status = deriveMembershipStatus({
    hasCard: true,
    revoked: Boolean(card.revoked_at),
    memberStatus: member.status,
    accountStatus: 'active',
    profileActive: true,
    cardValidUntil: card.valid_until,
    memberValidUntil: member.valid_until,
  });

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
      qr_image_url: `/api/member/id-card/qr?v=${encodeURIComponent(card.reissued_at || card.created_at)}`,
    },
  }, { headers: { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' } });
}
