import { NextResponse } from 'next/server';
import { canReviewStage, getAdminActor } from '../../../../../auth/admin';

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PRIVATE_PHOTO_BUCKET = 'membership-application-photos';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  const { actor, db, error } = await getAdminActor();
  if (!actor || !db) return NextResponse.json({ error: error || 'अनुमति नहीं है।' }, { status: 403 });

  const { applicationId } = await params;
  if (!UUID_PATTERN.test(applicationId)) return NextResponse.json({ error: 'आवेदन संदर्भ मान्य नहीं है।' }, { status: 400 });

  const { data: application, error: queryError } = await db
    .from('membership_applications')
    .select('id,status,approval_stage,assigned_unit_id,photo_path')
    .eq('id', applicationId)
    .maybeSingle();
  if (queryError) return NextResponse.json({ error: 'आवेदन फोटो की जाँच नहीं हो सकी।' }, { status: 503 });
  if (!application || application.status !== 'pending' || !application.photo_path) {
    return NextResponse.json({ error: 'लंबित आवेदन की फोटो उपलब्ध नहीं है।' }, { status: 404 });
  }
  if (!await canReviewStage(db, actor, application)) {
    return NextResponse.json({ error: 'यह फोटो आपके समीक्षा चरण या संगठन क्षेत्र में नहीं है।' }, { status: 403 });
  }

  const { data, error: signedUrlError } = await db.storage
    .from(PRIVATE_PHOTO_BUCKET)
    .createSignedUrl(application.photo_path, 300);
  if (signedUrlError || !data?.signedUrl) {
    console.error('Membership photo signed URL failed:', signedUrlError?.name || 'storage_error');
    return NextResponse.json({ error: 'सुरक्षित फोटो लिंक नहीं बन सका।' }, { status: 503 });
  }

  return NextResponse.json({ photo_url: data.signedUrl }, {
    headers: { 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache' },
  });
}
