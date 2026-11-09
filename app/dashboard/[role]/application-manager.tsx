'use client';

import { useEffect, useState } from 'react';

type Application = {
  id: string;
  application_reference: string;
  full_name: string;
  parent_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  occupation: string | null;
  education: string | null;
  email: string;
  mobile: string;
  state: string | null;
  district: string | null;
  tehsil: string | null;
  block: string | null;
  address_line1: string | null;
  address_line2: string | null;
  pincode: string | null;
  referrer_name: string | null;
  referrer_member_no: string | null;
  declaration_accepted: boolean;
  assigned_unit_id: string | null;
  assigned_unit: { id: string; name: string; state: string | null; district: string | null } | null;
  has_photo: boolean;
  message: string | null;
  approval_stage: string;
  created_at: string;
};

function value(text: string | null | undefined) {
  return text?.trim() || '—';
}

const genderLabels: Record<string, string> = {
  male: 'पुरुष',
  female: 'महिला',
  other: 'अन्य',
  prefer_not_to_say: 'बताना नहीं चाहते',
};

function date(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('hi-IN');
}

export function ApplicationManager() {
  const [items, setItems] = useState<Application[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [role, setRole] = useState('');
  const [unit, setUnit] = useState<Record<string, string>>({});
  const [designation, setDesignation] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoBusy, setPhotoBusy] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    setMessage('');
    try {
      const [applicationResponse, unitResponse, designationResponse] = await Promise.all([
        fetch('/api/admin/applications', { cache: 'no-store' }),
        fetch('/api/admin/units', { cache: 'no-store' }),
        fetch('/api/admin/designations', { cache: 'no-store' }),
      ]);
      const [applicationJson, unitJson, designationJson] = await Promise.all([
        applicationResponse.json(), unitResponse.json(), designationResponse.json(),
      ]);
      if (!applicationResponse.ok) {
        setMessage(applicationJson.error || 'आवेदन लोड नहीं हुए।');
        return;
      }
      setItems(applicationJson.applications || []);
      setRole(applicationJson.actor_role || '');
      if (unitResponse.ok) setUnits(unitJson.units || []);
      if (designationResponse.ok) setDesignations(designationJson.designations || []);
    } catch {
      setMessage('आवेदन सेवा से संपर्क नहीं हो सका। कृपया फिर से प्रयास करें।');
    }
  }

  useEffect(() => { void load(); }, []);

  async function showPhoto(application: Application) {
    setPhotoBusy(application.id);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/applications/${application.id}/photo`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error || 'सुरक्षित फोटो लिंक नहीं मिला।');
        return;
      }
      setPhotoUrls((current) => ({ ...current, [application.id]: result.photo_url }));
    } catch {
      setMessage('फोटो लोड नहीं हुई। कृपया फिर से प्रयास करें।');
    } finally {
      setPhotoBusy('');
    }
  }

  async function act(application: Application, action: 'advance' | 'approve' | 'reject' | 'keep_pending') {
    const id = application.id;
    const approvalUnitId = unit[id] ?? application.assigned_unit_id ?? '';
    if (action === 'reject' && !reason[id]?.trim()) {
      setMessage('अस्वीकृति का कारण लिखें।');
      return;
    }
    if (action === 'approve' && !approvalUnitId) {
      setMessage('सदस्य के लिए संगठन इकाई चुनें।');
      return;
    }
    const prompt = action === 'reject'
      ? 'इस आवेदन को अस्वीकार करें?'
      : action === 'approve'
        ? 'इस सदस्यता आवेदन को अंतिम रूप से स्वीकृत करें?'
        : action === 'advance'
          ? 'आवेदन अगले समीक्षा चरण को भेजें?'
          : 'आवेदन को इसी चरण में लंबित रखें?';
    if (!window.confirm(prompt)) return;

    setBusy(id);
    setMessage('');
    try {
      const response = await fetch('/api/admin/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          application_id: id,
          action,
          unit_id: approvalUnitId,
          designation_id: designation[id] || null,
          reason: reason[id],
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error || 'आवेदन अपडेट नहीं हुआ।');
        return;
      }
      if (action === 'keep_pending') {
        setMessage('आवेदन लंबित रखा गया है।');
        return;
      }
      await load();
      setMessage('आवेदन कार्य पूरा हुआ।');
    } catch {
      setMessage('आवेदन अपडेट नहीं हुआ। कृपया फिर से प्रयास करें।');
    } finally {
      setBusy('');
    }
  }

  return <section className="applicationmanager">
    <div className="eyebrow dark">चरणबद्ध सदस्यता कार्यप्रवाह</div>
    <h2>सदस्यता आवेदन समीक्षा</h2>
    <p>केवल आपके वर्तमान चरण और संगठन क्षेत्र के आवेदन दिखते हैं। निजी फोटो को सीमित समय के सुरक्षित लिंक से खोला जाता है। अंतिम स्वीकृति के बाद ही सदस्यता संख्या जारी होगी।</p>
    {message && <p className="status" role="status">{message}</p>}
    {items.map((application) => <article className="applicationrow application-review-card" key={application.id}>
      <div className="application-record">
        <div className="application-record-heading">
          <div>
            <small className="application-ref-label">संदर्भ: {application.application_reference}</small>
            <h3>{application.full_name}</h3>
            <span className="unitbadge">{application.approval_stage.replace('pending_', '')}</span>
          </div>
          {photoUrls[application.id]
            ? <div className="application-photo-link"><a href={photoUrls[application.id]} target="_blank" rel="noreferrer" referrerPolicy="no-referrer" aria-label={`${application.full_name} की निजी आवेदन फोटो खोलें`}><img className="application-photo" src={photoUrls[application.id]} alt={`${application.full_name} की आवेदन फोटो`}/></a><small>निजी फोटो · 5 मिनट का लिंक</small><button type="button" className="textbutton" disabled={photoBusy === application.id} onClick={() => void showPhoto(application)}>नया सुरक्षित लिंक</button></div>
            : application.has_photo
              ? <button className="application-photo-placeholder photo-view-button" type="button" disabled={photoBusy === application.id} onClick={() => void showPhoto(application)} aria-label={`${application.full_name} की सुरक्षित फोटो देखें`}><span aria-hidden="true">▧</span><small>{photoBusy === application.id ? 'फोटो खुल रही है…' : 'सुरक्षित फोटो देखें'}</small></button>
              : <div className="application-photo-placeholder"><span aria-hidden="true">▧</span><small>फोटो उपलब्ध नहीं</small></div>}
        </div>
        <div className="application-detail-grid">
          <p><b>पिता / माता / जीवनसाथी</b><span>{value(application.parent_name)}</span></p>
          <p><b>जन्म तिथि</b><span>{date(application.date_of_birth)}</span></p>
          <p><b>लिंग</b><span>{application.gender ? genderLabels[application.gender] || '—' : '—'}</span></p>
          <p><b>मोबाइल</b><span>{application.mobile}</span></p>
          <p><b>ईमेल</b><span>{application.email}</span></p>
          <p><b>व्यवसाय</b><span>{value(application.occupation)}</span></p>
          <p><b>शिक्षा</b><span>{value(application.education)}</span></p>
          <p className="detail-wide"><b>पता</b><span>{[application.address_line1, application.address_line2, application.block, application.tehsil, application.district, application.state, application.pincode].filter(Boolean).join(', ') || '—'}</span></p>
          <p className="detail-wide"><b>इच्छित संगठन इकाई</b><span>{application.assigned_unit ? [application.assigned_unit.name, application.assigned_unit.district, application.assigned_unit.state].filter(Boolean).join(', ') : 'केंद्रीय समीक्षा · इकाई निर्धारित नहीं'}</span></p>
          <p><b>संदर्भ देने वाला</b><span>{value(application.referrer_name)}</span></p>
          <p><b>संदर्भ सदस्यता संख्या</b><span>{value(application.referrer_member_no)}</span></p>
          <p><b>जानकारी की घोषणा</b><span>{application.declaration_accepted ? 'स्वीकार की' : 'पुराने आवेदन में दर्ज नहीं'}</span></p>
          <p className="detail-wide"><b>आवेदन तिथि</b><span>{new Date(application.created_at).toLocaleString('hi-IN')}</span></p>
          <p className="detail-wide"><b>परिचय / आवेदन का कारण</b><span className="application-message">{value(application.message)}</span></p>
        </div>
      </div>

      {role === 'admin' || role === 'super_admin' ? <div className="applicationactions">
        <label>सदस्य इकाई<select value={unit[application.id] ?? application.assigned_unit_id ?? ''} onChange={(event) => setUnit({ ...unit, [application.id]: event.target.value })}>
          <option value="">इकाई चुनें</option>
          {units.filter((entry) => entry.active).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
        <label>स्वीकृत पदनाम<select value={designation[application.id] || ''} onChange={(event) => setDesignation({ ...designation, [application.id]: event.target.value })}>
          <option value="">निर्धारित नहीं</option>
          {designations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
        {(role === 'super_admin' || application.approval_stage === 'pending_admin') && <>
          {application.approval_stage === 'pending_admin' && <button className="button gold" disabled={busy === application.id} onClick={() => void act(application, 'approve')}>स्वीकृत करें</button>}
          <label>अस्वीकृति कारण<input value={reason[application.id] || ''} onChange={(event) => setReason({ ...reason, [application.id]: event.target.value })}/></label>
          <button className="textbutton" disabled={busy === application.id} onClick={() => void act(application, 'reject')}>अस्वीकार करें</button>
        </>}
        {role === 'super_admin' && ['pending_coordinator', 'pending_manager'].includes(application.approval_stage) && <button className="button outline darkoutline" disabled={busy === application.id} onClick={() => void act(application, 'advance')}>अगले चरण को भेजें ↗</button>}
        <button className="textbutton keep-pending-button" disabled={busy === application.id} onClick={() => void act(application, 'keep_pending')}>लंबित रखें</button>
      </div> : <div className="applicationactions">
        <button className="button gold" disabled={busy === application.id} onClick={() => void act(application, 'advance')}>अगले चरण को भेजें ↗</button>
        <button className="textbutton keep-pending-button" disabled={busy === application.id} onClick={() => void act(application, 'keep_pending')}>लंबित रखें</button>
      </div>}
    </article>)}
    {!items.length && <p className="emptycms">आपके चरण में कोई लंबित आवेदन नहीं है।</p>}
  </section>;
}
