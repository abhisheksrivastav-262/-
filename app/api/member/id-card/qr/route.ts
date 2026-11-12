import { NextResponse } from 'next/server';
import { getVerifiedRole } from '../../../../auth/server';
import { createServiceClient } from '../../../../auth/admin';
import { getIdCardQrSvg } from '../../../../id-card-server';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getVerifiedRole();
  if (!session.user || !session.active || session.role !== 'member') {
    return NextResponse.json({ error: 'सक्रिय सदस्य लॉगिन आवश्यक है।' }, { status: 403 });
  }
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: 'ID Card सेवा उपलब्ध नहीं है।' }, { status: 503 });

  const { data: member, error: memberError } = await db.from('members')
    .select('id,status,membership_no,user_id')
    .eq('user_id', session.user.id).maybeSingle();
  if (memberError) return NextResponse.json({ error: 'ID Card उपलब्ध नहीं है।' }, { status: 503 });
  if (!member || member.status !== 'approved' || !member.membership_no?.trim()) {
    return NextResponse.json({ error: 'ID Card उपलब्ध नहीं है।' }, { status: 404 });
  }
  const { data: profile, error: profileError } = await db.from('profiles')
    .select('is_active,account_status').eq('id', member.user_id).maybeSingle();
  if (profileError || !profile?.is_active || profile.account_status !== 'active') {
    return NextResponse.json({ error: 'ID Card उपलब्ध नहीं है।' }, { status: 404 });
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
