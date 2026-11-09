'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

type PublicUnit = { id: string; name: string; level: number; state?: string | null; district?: string | null };
const PHOTO_LIMIT = 4 * 1024 * 1024;

function makeReference(id: string) {
  return `ABVDS-APP-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

export function PublicForm({ kind }: { kind: 'contact' | 'join' }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState<PublicUnit[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [reference, setReference] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (kind !== 'join') return;
    let active = true;
    fetch('/api/public/units', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { units: [] })
      .then((result) => { if (active) setUnits(result.units || []); })
      .catch(() => { if (active) setUnits([]); });
    return () => { active = false; };
  }, [kind]);

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0] || null;
    if (!next) return;
    if (!['image/jpeg', 'image/png'].includes(next.type)) {
      setMessage('फोटो JPG या PNG फ़ॉर्मेट में चुनें।');
      event.currentTarget.value = '';
      return;
    }
    if (next.size > PHOTO_LIMIT) {
      setMessage('फोटो का आकार 4 MB से कम होना चाहिए।');
      event.currentTarget.value = '';
      return;
    }
    setMessage('');
    setPhoto(next);
    setPhotoPreview(URL.createObjectURL(next));
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoPreview('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage('');
    setReference('');

    try {
      let response: Response;
      if (kind === 'join') {
        if (!photo) throw new Error('आवेदन के साथ पासपोर्ट आकार की फोटो लगाना आवश्यक है।');
        const payload = new FormData(form);
        payload.set('kind', 'join');
        payload.set('photo', photo);
        response = await fetch('/api/public-submission', { method: 'POST', body: payload });
      } else {
        const payload = Object.fromEntries(new FormData(form).entries());
        response = await fetch('/api/public-submission', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, kind }),
        });
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'आवेदन जमा नहीं हो सका।');
      if (kind === 'join') {
        setReference(makeReference(result.application_id));
        form.reset();
        setPhoto(null);
        setPhotoPreview('');
      } else {
        setMessage('आपका संदेश समिति को भेज दिया गया है।');
        form.reset();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'सेवा उपलब्ध नहीं है। कृपया बाद में प्रयास करें।');
    } finally {
      setBusy(false);
    }
  }

  if (kind === 'contact') {
    return <form className="form" onSubmit={submit}>
      <label>पूरा नाम *<input name="name" required maxLength={120}/></label>
      <label>मोबाइल नंबर *<input name="phone" required inputMode="tel" pattern="[0-9+ ()-]{8,20}" maxLength={20}/></label>
      <label>ईमेल<input name="email" type="email" maxLength={254}/></label>
      <label>विषय *<input name="subject" required maxLength={160}/></label>
      <label className="wide">संदेश<textarea name="message" rows={5} maxLength={3000}/></label>
      <button className="button gold" disabled={busy}>{busy ? 'भेजा जा रहा है…' : 'संदेश भेजें'} ↗</button>
      {message && <p className="status wide" role="status">{message}</p>}
    </form>;
  }

  return <div className="membership-application">
    {reference ? <section className="application-success" role="status" aria-live="polite">
      <span className="success-mark" aria-hidden="true">✓</span>
      <p className="eyebrow dark">आवेदन सुरक्षित रूप से जमा हुआ</p>
      <h2>धन्यवाद। आपका आवेदन <i>समीक्षा के लिए लंबित</i> है।</h2>
      <p>समिति की अधिकृत टीम आवेदन की जाँच करेगी। स्वीकृति से पहले कोई सदस्यता संख्या, सदस्य ID या QR ID जारी नहीं होगी।</p>
      <div className="application-reference"><small>आवेदन संदर्भ संख्या</small><strong>{reference}</strong></div>
      <button className="button outline darkoutline" type="button" onClick={() => setReference('')}>नया आवेदन भरें</button>
    </section> : <form id="membership-application-form" className="form membership-form" onSubmit={submit}>
      <div className="form-introduction">
        <span className="eyebrow dark">सदस्यता आवेदन</span>
        <h2>समिति से जुड़ने के लिए <i>आवेदन करें</i></h2>
        <p>कृपया सही जानकारी दें। आवेदन पहले लंबित स्थिति में दर्ज होगा और समिति द्वारा समीक्षा के बाद ही सदस्यता का निर्णय होगा।</p>
      </div>

      <fieldset className="application-section">
        <legend><span>01</span> व्यक्तिगत जानकारी</legend>
        <div className="membership-grid">
          <label>पूरा नाम *<input name="full_name" autoComplete="name" required minLength={2} maxLength={120} placeholder="आवेदक का पूरा नाम"/></label>
          <label>पिता / माता / जीवनसाथी का नाम *<input name="parent_name" required minLength={2} maxLength={120}/></label>
          <label>जन्म तिथि *<input name="date_of_birth" type="date" required max={new Date().toISOString().slice(0, 10)}/></label>
          <label>लिंग (वैकल्पिक)<select name="gender" defaultValue=""><option value="">चुनें</option><option value="male">पुरुष</option><option value="female">महिला</option><option value="other">अन्य</option><option value="prefer_not_to_say">बताना नहीं चाहते</option></select></label>
          <label>व्यवसाय<input name="occupation" maxLength={120} placeholder="वैकल्पिक"/></label>
          <label className="fieldwide">शिक्षा<input name="education" maxLength={120} placeholder="वैकल्पिक"/></label>
        </div>
      </fieldset>

      <fieldset className="application-section">
        <legend><span>02</span> संपर्क और पता</legend>
        <div className="membership-grid">
          <label>मोबाइल नंबर *<input name="mobile" required autoComplete="tel" inputMode="tel" pattern="[0-9+ ()-]{8,20}" minLength={8} maxLength={20} placeholder="10 अंकों का मोबाइल नंबर"/></label>
          <label>ईमेल पता *<input name="email" type="email" required autoComplete="email" maxLength={254} placeholder="name@example.com"/></label>
          <label className="fieldwide">पता पंक्ति 1 *<input name="address_line1" required autoComplete="address-line1" minLength={4} maxLength={200} placeholder="मकान / सड़क / गाँव"/></label>
          <label className="fieldwide">पता पंक्ति 2<input name="address_line2" autoComplete="address-line2" maxLength={200} placeholder="मोहल्ला या अतिरिक्त पता (वैकल्पिक)"/></label>
          <label>राज्य *<input name="state" required autoComplete="address-level1" minLength={2} maxLength={80}/></label>
          <label>जिला *<input name="district" required autoComplete="address-level2" minLength={2} maxLength={100}/></label>
          <label>तहसील<input name="tehsil" maxLength={100}/></label>
          <label>ब्लॉक / स्थानीय क्षेत्र<input name="block" maxLength={100}/></label>
          <label>पिन कोड *<input name="pincode" required inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="postal-code" placeholder="6 अंकों का पिन कोड"/></label>
        </div>
      </fieldset>

      <fieldset className="application-section">
        <legend><span>03</span> संगठन संबंधी जानकारी</legend>
        <div className="membership-grid">
          <label className="fieldwide">इच्छित संगठन इकाई
            <select name="assigned_unit_id" defaultValue="">
              <option value="">समिति द्वारा निर्धारित हो</option>
              {units.map((unit) => <option value={unit.id} key={unit.id}>
                {'— '.repeat(Math.max(0, unit.level - 1))}{unit.name}{unit.district ? ` · ${unit.district}` : ''}{unit.state ? ` · ${unit.state}` : ''}
              </option>)}
            </select>
            {!units.length && <small>इकाई न चुनने पर आवेदन केंद्रीय समीक्षा के लिए जाएगा।</small>}
          </label>
          <label>संदर्भ देने वाले व्यक्ति का नाम<input name="referrer_name" maxLength={120}/></label>
          <label>संदर्भ देने वाले की सदस्यता संख्या<input name="referrer_member_no" maxLength={40}/></label>
          <label className="fieldwide">आप समिति से क्यों जुड़ना चाहते हैं?<textarea name="message" rows={4} maxLength={3000} placeholder="अपना संक्षिप्त परिचय या उद्देश्य लिखें"/></label>
        </div>
      </fieldset>

      <fieldset className="application-section photo-section">
        <legend><span>04</span> पासपोर्ट आकार की फोटो <b>आवश्यक</b></legend>
        <div className="photo-upload-row">
          <div className="photo-preview" aria-live="polite">
            {photoPreview ? <img src={photoPreview} alt="आवेदन में लगाई गई फोटो का पूर्वावलोकन"/> : <div><span aria-hidden="true">▧</span><small>फोटो का preview यहाँ दिखेगा</small></div>}
          </div>
          <div className="photo-upload-copy">
            <p>साफ़, हाल की पासपोर्ट आकार की फोटो चुनें। केवल JPG या PNG, अधिकतम 4 MB। फोटो निजी storage में सुरक्षित रहेगी।</p>
            <input ref={fileInput} className="photo-file-input" type="file" name="photo" accept="image/jpeg,image/png,.jpg,.jpeg,.png" required={!photo} onChange={choosePhoto}/>
            <div className="photo-actions">
              <button className="button outline darkoutline" type="button" onClick={() => fileInput.current?.click()}>{photo ? 'फोटो बदलें' : 'फोटो चुनें'}</button>
              {photo && <button className="textbutton" type="button" onClick={removePhoto}>फोटो हटाएँ</button>}
            </div>
            {photo && <small className="photo-filename">{photo.name} · {(photo.size / 1024 / 1024).toFixed(2)} MB</small>}
          </div>
        </div>
      </fieldset>

      <label className="declaration-check"><input name="declaration_accepted" type="checkbox" value="true" required/><span>मैं पुष्टि करता/करती हूँ कि आवेदन में दी गई जानकारी मेरी जानकारी के अनुसार सही है और समिति इसे सदस्यता समीक्षा के लिए उपयोग कर सकती है। *</span></label>
      <p className="formhint privacy-note">आवेदन और फोटो सार्वजनिक रूप से प्रकाशित नहीं होंगे। अधिकृत समीक्षक ही इन्हें देख सकेंगे। आवेदन लंबित रहने पर कोई सदस्यता संख्या या QR ID नहीं बनेगी।</p>
      {message && <p className="status wide" role="alert">{message}</p>}
      <button className="button gold submit-application" disabled={busy}>{busy ? 'आवेदन सुरक्षित रूप से जमा हो रहा है…' : 'सदस्यता आवेदन करें'} <span aria-hidden="true">↗</span></button>
    </form>}
  </div>;
}
