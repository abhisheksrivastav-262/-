import 'server-only';

import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createServiceClient } from './auth/admin';
import { deriveMembershipStatus, getVerificationUrl } from './id-card-domain';

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_APPLICATION_PHOTO = /^applications\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png)$/i;

export function hashMembershipCardToken(token: string) {
  return createHash('sha256').update(token.toLowerCase(), 'utf8').digest('hex');
}

export function isMembershipCardToken(token: string) {
  return TOKEN_PATTERN.test(token);
}

/** Resolve the QR token only on the server through the service-role-only RPC. */
export async function getIdCardVerificationUrl(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  cardId: string,
  expectedHash: string,
) {
  const { data: token, error } = await db.rpc('get_id_card_qr_token', { p_card_id: cardId });
  if (error || typeof token !== 'string' || !isMembershipCardToken(token)) return null;
  if (hashMembershipCardToken(token) !== expectedHash) return null;
  return getVerificationUrl(token);
}

/** Build QR artwork server-side; the literal token URL is never placed in JSON. */
export async function getIdCardQrSvg(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  cardId: string,
  expectedHash: string,
) {
  const verificationUrl = await getIdCardVerificationUrl(db, cardId, expectedHash);
  if (!verificationUrl) return null;
  const { renderToStaticMarkup } = await import('react-dom/server');
  return renderToStaticMarkup(createElement(QRCodeSVG, {
    value: verificationUrl,
    size: 256,
    level: 'Q',
    includeMargin: true,
    title: 'ABVDS membership verification',
  }));
}

export async function getMemberPhotoUrl(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  path: string | null,
  publicPhoto: boolean,
) {
  if (!path || path.startsWith('/') || path.split('/').includes('..')) return null;
  if (publicPhoto) return db.storage.from('public-media').getPublicUrl(path).data.publicUrl;
  if (!PRIVATE_APPLICATION_PHOTO.test(path)) return null;
  const { data, error } = await db.storage.from('membership-application-photos').createSignedUrl(path, 300);
  return error ? null : data?.signedUrl || null;
}

export async function getPublicMembershipVerification(token: string) {
  if (!isMembershipCardToken(token)) return { available: true as const, member: null };

  const db = createServiceClient();
  if (!db) return { available: false as const, member: null };

  const { data: verifiedRows, error: verifyError } = await db.rpc('verify_id_card_token', {
    p_token_hash: hashMembershipCardToken(token),
  });
  if (verifyError) return { available: false as const, member: null };
  const card = Array.isArray(verifiedRows) ? verifiedRows[0] : null;
  if (!card || typeof card.member_id !== 'string') return { available: true as const, member: null };

  const { data: member, error: memberError } = await db
    .from('members')
    .select('id,user_id,full_name,membership_no,status,unit_id,designation_id,photo_path,public_photo,valid_until')
    .eq('id', card.member_id)
    .maybeSingle();
  if (memberError) return { available: false as const, member: null };
  if (!member || !member.membership_no?.trim()) {
    return { available: true as const, member: null };
  }

  const [profileResult, unitResult, designationResult] = await Promise.all([
    member.user_id
      ? db.from('profiles').select('is_active,account_status').eq('id', member.user_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    member.unit_id
      ? db.from('organizational_units').select('name,state,district').eq('id', member.unit_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    member.designation_id
      ? db.from('designations').select('name').eq('id', member.designation_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (profileResult.error || unitResult.error || designationResult.error) {
    return { available: false as const, member: null };
  }

  const status = card.verification_status as ReturnType<typeof deriveMembershipStatus>;
  const publicPhotoPath = typeof member.photo_path === 'string'
    && member.public_photo === true
    && !member.photo_path.startsWith('/')
    && !member.photo_path.split('/').includes('..')
    ? member.photo_path
    : null;
  const photoUrl = publicPhotoPath
    ? db.storage.from('public-media').getPublicUrl(publicPhotoPath).data.publicUrl
    : null;

  return {
    available: true as const,
    member: {
      full_name: member.full_name,
      membership_no: member.membership_no,
      designation: designationResult.data?.name || null,
      unit: unitResult.data?.name || null,
      district: unitResult.data?.district || null,
      state: unitResult.data?.state || null,
      photo_url: photoUrl,
      status,
      valid_until: member.valid_until || card.valid_until || null,
    },
  };
}
