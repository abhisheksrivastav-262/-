import type { Metadata } from 'next';
import { getPublicMembershipVerification } from '../../id-card-server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'सदस्यता सत्यापन · अखिल भारतीय वैदिक धर्म संरक्षक समिति',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const statusLabels = {
  Active: 'सक्रिय',
  Suspended: 'निलंबित',
  Inactive: 'निष्क्रिय',
  Invalid: 'अमान्य',
} as const;

export default async function VerifyMembershipCard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getPublicMembershipVerification(token);
  if (!result.available) {
    return <main className="verification-page"><section className="verification-panel"><span className="seal">ॐ</span><p className="eyebrow dark">सदस्यता सत्यापन</p><h1>सत्यापन सेवा अस्थायी रूप से उपलब्ध नहीं</h1><p>कृपया कुछ समय बाद दोबारा प्रयास करें।</p></section></main>;
  }
  if (!result.member) {
    return <main className="verification-page"><section className="verification-panel"><span className="seal">ॐ</span><p className="eyebrow dark">सदस्यता सत्यापन</p><h1>यह QR Code मान्य नहीं है</h1><span className="verification-status status-invalid">अमान्य · Invalid</span><p>दिए गए पहचान token से कोई जारी सदस्यता कार्ड नहीं मिला।</p></section></main>;
  }

  const { member } = result;
  return <main className="verification-page"><section className="verification-panel">
    <header className="verification-brand"><img src="/icon.svg" alt="समिति का आधिकारिक चिह्न"/><div><b>अखिल भारतीय वैदिक</b><strong>धर्म संरक्षक समिति</strong><small>सत्यं वद। धर्मं चर।</small></div></header>
    <div className={`verification-status status-${member.status.toLowerCase()}`}><span aria-hidden="true">●</span>{statusLabels[member.status]} · {member.status}</div>
    <h1>सदस्यता सत्यापन</h1>
    {member.photo_url && <img className="verification-member-photo" src={member.photo_url} alt="सार्वजनिक सदस्य फोटो" referrerPolicy="no-referrer"/>}
    <dl className="verification-details">
      <div><dt>सदस्य का नाम</dt><dd>{member.full_name}</dd></div>
      <div><dt>सदस्यता संख्या</dt><dd>{member.membership_no}</dd></div>
      <div><dt>पदनाम</dt><dd>{member.designation || '—'}</dd></div>
      <div><dt>संगठन इकाई</dt><dd>{[member.unit, member.district, member.state].filter(Boolean).join(' · ') || '—'}</dd></div>
      <div><dt>स्थिति</dt><dd>{statusLabels[member.status]}</dd></div>
      {member.valid_until && <div><dt>वैधता</dt><dd>{new Date(`${member.valid_until}T00:00:00`).toLocaleDateString('hi-IN')}</dd></div>}
    </dl>
    <p className="verification-note">यह पृष्ठ कार्ड की वर्तमान स्थिति दिखाता है। QR Code में व्यक्तिगत जानकारी शामिल नहीं है।</p>
  </section></main>;
}
