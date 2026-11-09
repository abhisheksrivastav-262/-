import { NextResponse } from 'next/server';
import { createServiceClient } from '../../auth/admin';
import { createClient } from '../../supabase';

export const runtime = 'nodejs';

const PHOTO_BUCKET = 'membership-application-photos';
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value
    && value <= new Date().toISOString().slice(0, 10);
}

function identifyPhoto(file: File) {
  // MIME is a preliminary check; the signature is verified from the file bytes.
  return file.type === 'image/jpeg' || file.type === 'image/png' ? file.type : null;
}

function detectPhotoType(bytes: Uint8Array) {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  return jpeg ? 'image/jpeg' : png ? 'image/png' : null;
}

async function submitMembership(form: FormData) {
  const fullName = text(form, 'full_name');
  const parentName = text(form, 'parent_name');
  const dateOfBirth = text(form, 'date_of_birth');
  const gender = text(form, 'gender');
  const occupation = text(form, 'occupation');
  const education = text(form, 'education');
  const mobile = text(form, 'mobile');
  const email = text(form, 'email');
  const addressLine1 = text(form, 'address_line1');
  const addressLine2 = text(form, 'address_line2');
  const state = text(form, 'state');
  const district = text(form, 'district');
  const tehsil = text(form, 'tehsil');
  const block = text(form, 'block');
  const pincode = text(form, 'pincode');
  const referrerName = text(form, 'referrer_name');
  const referrerMemberNo = text(form, 'referrer_member_no');
  const message = text(form, 'message');
  const assignedUnitId = text(form, 'assigned_unit_id') || null;
  const declarationAccepted = form.get('declaration_accepted') === 'true';
  const fileValue = form.get('photo');

  const digits = mobile.replace(/\D/g, '');
  if (fullName.length < 2 || fullName.length > 120 || parentName.length < 2 || parentName.length > 120 || !validDate(dateOfBirth)) {
    return NextResponse.json({ error: 'नाम, अभिभावक का नाम और सही जन्म तिथि भरें।' }, { status: 400 });
  }
  if (gender && !['male', 'female', 'other', 'prefer_not_to_say'].includes(gender)) {
    return NextResponse.json({ error: 'लिंग का विकल्प मान्य नहीं है।' }, { status: 400 });
  }
  if (occupation.length > 120 || education.length > 120 || !/^[0-9+ ()-]{8,20}$/.test(mobile) || digits.length < 10 || digits.length > 15) {
    return NextResponse.json({ error: 'सही मोबाइल नंबर भरें।' }, { status: 400 });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'सही ईमेल पता भरें।' }, { status: 400 });
  }
  if (addressLine1.length < 4 || addressLine1.length > 200 || addressLine2.length > 200
      || state.length < 2 || state.length > 80 || district.length < 2 || district.length > 100
      || tehsil.length > 100 || block.length > 100 || !/^\d{6}$/.test(pincode)
      || referrerName.length > 120 || referrerMemberNo.length > 40 || message.length > 3000) {
    return NextResponse.json({ error: 'पूरा पता, राज्य, जिला और 6 अंकों का पिन कोड भरें।' }, { status: 400 });
  }
  if (!declarationAccepted) return NextResponse.json({ error: 'आवेदन जमा करने से पहले घोषणा स्वीकार करें।' }, { status: 400 });
  if (assignedUnitId && !UUID_PATTERN.test(assignedUnitId)) {
    return NextResponse.json({ error: 'संगठन इकाई मान्य नहीं है।' }, { status: 400 });
  }
  if (!(fileValue instanceof File) || fileValue.size < 1 || fileValue.size > MAX_PHOTO_BYTES || !identifyPhoto(fileValue)) {
    return NextResponse.json({ error: '4 MB से छोटी JPG या PNG पासपोर्ट आकार की फोटो चुनें।' }, { status: 400 });
  }

  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: 'आवेदन सेवा सर्वर पर कॉन्फ़िगर नहीं है।' }, { status: 503 });

  if (assignedUnitId) {
    const { data: unit, error } = await db.from('organizational_units').select('id,active').eq('id', assignedUnitId).maybeSingle();
    if (error) return NextResponse.json({ error: 'संगठन इकाई की जाँच नहीं हो सकी।' }, { status: 503 });
    if (!unit?.active) return NextResponse.json({ error: 'यह संगठन इकाई उपलब्ध नहीं है।' }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase();
  const normalizedMobile = digits;
  const [emailDuplicate, mobileDuplicate] = await Promise.all([
    db.from('membership_applications').select('id').eq('status', 'pending').eq('email_normalized', normalizedEmail).maybeSingle(),
    db.from('membership_applications').select('id').eq('status', 'pending').eq('mobile_normalized', normalizedMobile).limit(1).maybeSingle(),
  ]);
  if (emailDuplicate.error || mobileDuplicate.error) {
    return NextResponse.json({ error: 'आवेदन की duplicate जाँच नहीं हो सकी। कृपया बाद में प्रयास करें।' }, { status: 503 });
  }
  if (emailDuplicate.data || mobileDuplicate.data) {
    return NextResponse.json({ error: 'इस ईमेल या मोबाइल नंबर से एक आवेदन पहले से समीक्षा में है।' }, { status: 409 });
  }

  const bytes = new Uint8Array(await fileValue.arrayBuffer());
  const photoMimeType = detectPhotoType(bytes);
  if (!photoMimeType) return NextResponse.json({ error: 'फोटो फ़ाइल सही JPG या PNG नहीं है।' }, { status: 400 });
  const extension = photoMimeType === 'image/jpeg' ? 'jpg' : 'png';
  const photoPath = `applications/${crypto.randomUUID()}.${extension}`;
  let uploadError: { name?: string } | null = null;
  try {
    const upload = await db.storage.from(PHOTO_BUCKET).upload(photoPath, bytes, {
      contentType: photoMimeType,
      cacheControl: '0',
      upsert: false,
    });
    uploadError = upload.error;
  } catch {
    const { error: cleanupError } = await db.storage.from(PHOTO_BUCKET).remove([photoPath]);
    if (cleanupError) console.error('Private membership photo cleanup failed:', cleanupError.name || 'storage_error');
    return NextResponse.json({ error: 'फोटो सुरक्षित रूप से upload नहीं हुई। कृपया बाद में प्रयास करें।' }, { status: 503 });
  }
  if (uploadError) {
    console.error('Private membership photo upload failed:', uploadError.name || 'storage_error');
    return NextResponse.json({ error: 'फोटो सुरक्षित रूप से upload नहीं हुई। कृपया बाद में प्रयास करें।' }, { status: 503 });
  }

  let inserted: { data: string | null; error: { code?: string; name?: string } | null };
  try {
    inserted = await db.rpc('submit_membership_application', {
      p_full_name: fullName,
      p_parent_name: parentName,
      p_date_of_birth: dateOfBirth,
      p_gender: gender || null,
      p_occupation: occupation || null,
      p_education: education || null,
      p_mobile: mobile,
      p_email: email,
      p_state: state,
      p_district: district,
      p_tehsil: tehsil || null,
      p_block: block || null,
      p_address_line1: addressLine1,
      p_address_line2: addressLine2 || null,
      p_pincode: pincode,
      p_referrer_name: referrerName || null,
      p_referrer_member_no: referrerMemberNo || null,
      p_photo_path: photoPath,
      p_photo_mime_type: photoMimeType,
      p_declaration_accepted: true,
      p_message: message || null,
      p_assigned_unit_id: assignedUnitId,
    });
  } catch {
    const { error: cleanupError } = await db.storage.from(PHOTO_BUCKET).remove([photoPath]);
    if (cleanupError) console.error('Private membership photo cleanup failed:', cleanupError.name || 'storage_error');
    return NextResponse.json({ error: 'आवेदन दर्ज नहीं हो सका। कृपया बाद में प्रयास करें।' }, { status: 503 });
  }

  const { data, error: insertError } = inserted;

  if (insertError || typeof data !== 'string') {
    const { error: cleanupError } = await db.storage.from(PHOTO_BUCKET).remove([photoPath]);
    if (cleanupError) console.error('Private membership photo cleanup failed:', cleanupError.name || 'storage_error');
    if (insertError?.code === '23505') {
      return NextResponse.json({ error: 'इस ईमेल या मोबाइल नंबर से एक आवेदन पहले से समीक्षा में है।' }, { status: 409 });
    }
    console.error('Membership application insert failed:', insertError?.code || 'database_error');
    return NextResponse.json({ error: 'आवेदन दर्ज नहीं हो सका। कृपया बाद में प्रयास करें।' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, application_id: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_PHOTO_BYTES + 64 * 1024) {
      return NextResponse.json({ error: 'आवेदन फ़ाइल का कुल आकार अनुमत सीमा से अधिक है।' }, { status: 413 });
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'आवेदन का फ़ॉर्म पढ़ा नहीं जा सका।' }, { status: 400 });
    }
    if (form.get('kind') !== 'join') return NextResponse.json({ error: 'अमान्य अनुरोध।' }, { status: 400 });
    try {
      return await submitMembership(form);
    } catch (error) {
      console.error('Membership submission handler failed:', error instanceof Error ? error.name : 'request_error');
      return NextResponse.json({ error: 'आवेदन सेवा उपलब्ध नहीं है। कृपया बाद में प्रयास करें।' }, { status: 503 });
    }
  }

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'अमान्य अनुरोध। कृपया विवरण जाँचें।' }, { status: 400 }); }
  if (body?.kind !== 'contact') return NextResponse.json({ error: 'अमान्य अनुरोध।' }, { status: 400 });
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const subject = String(body.subject || '').trim();
  const message = String(body.message || '').trim();
  if (name.length < 2 || name.length > 120 || !/^[0-9+ ()-]{8,20}$/.test(phone) || email.length > 254 || subject.length < 2 || subject.length > 160 || message.length > 3000) {
    return NextResponse.json({ error: 'कृपया सही विवरण भरें।' }, { status: 400 });
  }
  try {
    const db = createClient();
    if (!db) return NextResponse.json({ error: 'संपर्क सेवा कॉन्फ़िगर नहीं है। कृपया प्रशासक से संपर्क करें।' }, { status: 503 });
    const result = await db.from('contact_enquiries').insert({ name, mobile: phone, email: email || null, subject, message, status: 'new' });
    if (result.error) {
      console.error('Contact submission failed:', result.error.code);
      return NextResponse.json({ error: 'संदेश जमा नहीं हो सका। कृपया बाद में प्रयास करें।' }, { status: 503 });
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error('Contact submission handler failed:', error instanceof Error ? error.name : 'request_error');
    return NextResponse.json({ error: 'संदेश जमा नहीं हो सका। कृपया बाद में प्रयास करें।' }, { status: 503 });
  }
}
