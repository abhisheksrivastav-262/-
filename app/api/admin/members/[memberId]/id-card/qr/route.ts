import { NextResponse } from 'next/server';
import { getAdminActor, isUnitInScope } from '../../../../../../auth/admin';
import { getIdCardQrSvg } from '../../../../../../id-card-server';

export const runtime = 'nodejs';
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { actor, db } = await getAdminActor();
  if (!actor || !db || !['super_admin', 'admin'].includes(actor.role)) {
    return NextResponse.json({ error: 'अनुमति नहीं है।' }, { status: 403 });
  }
  const { memberId } = await params;
  if (!UUID_PATTERN.test(memberId)) return NextResponse.json({ error: 'सदस्य संदर्भ मान्य नहीं है।' }, { status: 400 });

  const { data: member, error: memberError } = await db.from('members')
    .select('id,user_id,status,membership_no,unit_id')
    .eq('id', memberId).maybeSingle();
  if (memberError) return NextResponse.json({ error: 'ID Card उपलब्ध नहीं है।' }, { status: 503 });
  if (!member || member.status !== 'approved' || !member.membership_no?.trim()) {
    return NextResponse.json({ error: 'ID Card उपलब्ध नहीं है।' }, { status: 404 });
  }
  if (actor.role !== 'super_admin' && !await isUnitInScope(db, actor, member.unit_id)) {
    return NextResponse.json({ error: 'यह सदस्य आपके संगठन क्षेत्र में नहीं है।' }, { status: 403 });
  }
  if (member.user_id) {
    const { data: profile, error } = await db.from('profiles')
      .select('is_active,account_status').eq('id', member.user_id).maybeSingle();
    if (error || !profile?.is_active || profile.account_status !== 'active') {
      return NextResponse.json({ error: 'ID Card उपलब्ध नहीं है।' }, { status: 404 });
    }
  }
  const { data: card, error: cardError } = await db.from('id_cards')
    .select('id,token_hash').eq('member_id', member.id).maybeSingle();
  if (cardError || !card) return NextResponse.json({ error: 'QR सत्यापन चित्र उपलब्ध नहीं है।' }, { status: 404 });
  const svg = await getIdCardQrSvg(db, card.id, card.token_hash);
  if (!svg) return NextResponse.json({ error: 'QR सत्यापन चित्र उपलब्ध नहीं है।' }, { status: 503 });
  return new NextResponse(svg, { headers: {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  } });
}
