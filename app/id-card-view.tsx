'use client';

import { useEffect, useState } from 'react';
import type { PublicMembershipStatus } from './id-card-domain';

export type MembershipCard = {
  id: string;
  member_id: string;
  full_name: string;
  mobile: string;
  membership_no: string;
  member_status: string;
  designation: string | null;
  unit: string | null;
  unit_location: string | null;
  photo_url: string | null;
  issued_at: string;
  valid_until: string | null;
  status: PublicMembershipStatus;
  qr_image_url: string;
};

function displayDate(value: string | null) {
  if (!value) return 'सदस्यता सक्रिय रहने तक';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('hi-IN');
}

function statusClass(status: PublicMembershipStatus) {
  return `member-card-status status-${status.toLowerCase()}`;
}

export function MembershipIDCard({ card, canReissue = false, onClose, onReissued }: {
  card: MembershipCard;
  canReissue?: boolean;
  onClose?: () => void;
  onReissued?: () => void;
}) {
  const [message, setMessage] = useState('');

  function printCard() {
    const oldTitle = document.title;
    const safeNumber = card.membership_no.replace(/[^a-z0-9-]/gi, '-');
    document.title = `ABVDS-ID-${safeNumber}`;
    const restore = () => { document.title = oldTitle; };
    window.addEventListener('afterprint', restore, { once: true });
    window.print();
  }

  async function reissueCard() {
    const button = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    if (button) button.disabled = true;
    setMessage('ID Card दोबारा जारी हो रहा है…');
    try {
      const response = await fetch(`/api/admin/members/${card.member_id}/id-card`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ID Card दोबारा जारी नहीं हुआ।');
      setMessage('ID Card फिर से जारी हुआ। पुराना QR बंद कर दिया गया है; सदस्यता संख्या वही है।');
      onReissued?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ID Card दोबारा जारी नहीं हुआ।');
    } finally {
      if (button) button.disabled = false;
    }
  }

  return <section className="member-id-card-printable" aria-label={`सदस्य ID Card ${card.membership_no}`}>
    <div className="member-id-card-toolbar">
      <div><span className={statusClass(card.status)}><i aria-hidden="true"/> {card.status}</span><span className="member-card-toolbar-number">{card.membership_no}</span></div>
      <div className="member-id-card-controls">
        {canReissue && <button className="button outline darkoutline" type="button" onClick={() => void reissueCard()}>ID Card दोबारा जारी करें</button>}
        <button className="button gold" type="button" onClick={printCard}>PDF डाउनलोड करें</button>
        <button className="button outline darkoutline" type="button" onClick={printCard}>प्रिंट करें</button>
        {onClose && <button className="member-card-close" type="button" onClick={onClose} aria-label="बंद करें">×</button>}
      </div>
      <small className="member-card-print-hint">PDF के लिए print dialog में “Save as PDF” चुनें। Front और back अलग पृष्ठों पर हैं।</small>
      {message && <small className="member-card-action-message" role="status">{message}</small>}
    </div>

    <div className="member-id-card-pair">
      <article className="member-id-card-side member-id-card-front">
        <header className="member-card-header">
          <img src="/icon.svg" alt="समिति का आधिकारिक चिह्न"/>
          <div><b>अखिल भारतीय वैदिक</b><strong>धर्म संरक्षक समिति</strong><small>सत्यं वद। धर्मं चर।</small></div>
          <span className="member-card-front-label">सदस्य परिचय पत्र</span>
        </header>
        <div className="member-card-front-body">
          <div className="member-card-photo">
            {card.photo_url ? <img src={card.photo_url} alt={`${card.full_name} की पासपोर्ट फोटो`} referrerPolicy="no-referrer"/> : <div className="member-card-photo-fallback"><span aria-hidden="true">ॐ</span><small>सदस्य फोटो</small></div>}
          </div>
          <div className="member-card-person">
            <span className={statusClass(card.status)}><i aria-hidden="true"/> {card.status}</span>
            <h2>{card.full_name}</h2>
            <p className="member-card-number-label">सदस्यता संख्या</p>
            <strong className="member-card-number">{card.membership_no}</strong>
            <div className="member-card-fields">
              <p><small>पदनाम / Designation</small><b>{card.designation || 'सदस्य'}</b></p>
              <p><small>संगठन इकाई / Unit</small><b>{card.unit || '—'}</b></p>
              <p><small>मोबाइल / Mobile</small><b>{card.mobile || '—'}</b></p>
            </div>
          </div>
        </div>
        <footer className="member-card-front-footer"><span>अखिल भारतीय वैदिक धर्म संरक्षक समिति</span><span>आधिकारिक डिजिटल पहचान पत्र</span></footer>
      </article>

      <article className="member-id-card-side member-id-card-back">
        <header className="member-card-back-header"><div><b>सदस्यता सत्यापन</b><small>QR Code scan करके वर्तमान स्थिति देखें</small></div><span>ABVDS</span></header>
        <div className="member-card-back-body">
          <div className="member-card-qr"><img src={card.qr_image_url} width="118" height="118" alt={`सदस्यता सत्यापन QR ${card.membership_no}`} referrerPolicy="same-origin"/></div>
          <div className="member-card-back-details">
            <p><small>Issue Date</small><b>{displayDate(card.issued_at)}</b></p>
            <p><small>Validity</small><b>{displayDate(card.valid_until)}</b></p>
            <p><small>Current Status</small><b className={statusClass(card.status)}><i aria-hidden="true"/> {card.status}</b></p>
            <p className="member-card-verify-url">www.vdssamiti.com/verify</p>
          </div>
        </div>
        <div className="member-card-back-note">यह कार्ड समिति की संपत्ति है। QR Code में व्यक्तिगत विवरण नहीं है। सत्यापन के लिए आधिकारिक वेबसाइट का उपयोग करें।</div>
        <footer className="member-card-back-footer"><span>सत्यं वद। धर्मं चर।</span><span>www.vdssamiti.com</span></footer>
      </article>
    </div>
  </section>;
}

export function MemberIDCardDashboard() {
  const [card, setCard] = useState<MembershipCard | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/member/id-card', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'ID Card उपलब्ध नहीं है।');
        if (active) setCard(result.card);
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'ID Card लोड नहीं हुआ।'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <section className="member-card-dashboard">
    <div className="eyebrow dark">डिजिटल सदस्य पहचान</div>
    <h2>आपका Membership ID Card</h2>
    <p>यह कार्ड अंतिम स्वीकृत सदस्यता और पहले से जारी सदस्यता संख्या से जुड़ा है। QR scan पर वर्तमान स्थिति दिखाई देगी।</p>
    {loading ? <p className="status">ID Card लोड हो रहा है…</p>
      : card ? <MembershipIDCard card={card}/>
        : <div className="member-card-unavailable" role="status"><span aria-hidden="true">▣</span><div><b>ID Card अभी उपलब्ध नहीं है</b><p>{message || 'अंतिम स्वीकृति के बाद कार्ड जारी होगा।'}</p></div></div>}
  </section>;
}

type AdminCardRow = {
  member_id: string;
  full_name: string;
  membership_no: string | null;
  member_status: string;
  designation: string | null;
  unit: string | null;
  valid_until: string | null;
  status: PublicMembershipStatus;
};

export function AdminIDCardManager() {
  const [cards, setCards] = useState<AdminCardRow[]>([]);
  const [selected, setSelected] = useState<MembershipCard | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setMessage('');
    try {
      const response = await fetch('/api/admin/id-cards', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ID Card सूची लोड नहीं हुई।');
      setCards(result.cards || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ID Card सूची उपलब्ध नहीं है।');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function openCard(memberId: string) {
    setMessage('');
    try {
      const response = await fetch(`/api/admin/members/${memberId}/id-card`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ID Card नहीं खुला।');
      setSelected(result.card);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ID Card नहीं खुला।');
    }
  }

  const filtered = cards.filter((card) => {
    const matchQuery = `${card.full_name} ${card.membership_no || ''} ${card.unit || ''}`.toLowerCase().includes(query.toLowerCase());
    return matchQuery && (filter === 'all' || card.status === filter);
  });

  return <section className="admin-id-card-manager">
    <div className="id-card-manager-heading"><div><span className="eyebrow dark">सीमित संगठन क्षेत्र</span><h2>Digital Membership ID Cards</h2><p>सूची server-side organizational scope से filter होती है। Super Admin सभी जारी कार्ड देख सकते हैं।</p></div><button className="button outline darkoutline" type="button" onClick={() => void load()}>↻ Refresh</button></div>
    <div className="id-card-manager-filters"><input aria-label="सदस्य कार्ड खोजें" placeholder="नाम, सदस्यता संख्या या इकाई खोजें" value={query} onChange={(event) => setQuery(event.target.value)}/><select aria-label="कार्ड स्थिति" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">सभी स्थितियाँ</option><option value="Active">सक्रिय</option><option value="Suspended">निलंबित</option><option value="Inactive">निष्क्रिय / समाप्त</option><option value="Invalid">अमान्य</option></select></div>
    {message && <p className="status" role="status">{message}</p>}
    {loading ? <p className="status">ID Card सूची लोड हो रही है…</p> : <div className="id-card-table"><div className="id-card-list-row id-card-list-head"><span>सदस्य</span><span>पदनाम / इकाई</span><span>स्थिति</span><span>कार्य</span></div>
      {filtered.map((item) => <div className="id-card-list-row" key={item.member_id}><span><b>{item.full_name}</b><small>{item.membership_no || 'सदस्यता संख्या उपलब्ध नहीं'}</small></span><span>{item.designation || '—'}<small>{item.unit || '—'}</small></span><span><i className={`id-card-status-dot status-${item.status.toLowerCase()}`}/>{item.status === 'Inactive' && item.member_status === 'expired' ? 'Expired' : item.status}</span><button className="button outline darkoutline" type="button" onClick={() => void openCard(item.member_id)}>देखें / Reissue ↗</button></div>)}
      {!filtered.length && <p className="emptycms">इस सूची में कोई जारी कार्ड नहीं है।</p>}
    </div>}
    {selected && <div className="id-card-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><div role="dialog" aria-modal="true" aria-label={`${selected.full_name} का ID Card`}><MembershipIDCard card={selected} canReissue onClose={() => setSelected(null)} onReissued={() => { void load(); void openCard(selected.member_id); }}/></div></div>}
  </section>;
}
