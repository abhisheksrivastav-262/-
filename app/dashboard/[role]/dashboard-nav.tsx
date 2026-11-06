'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type DashboardRole = 'super_admin' | 'admin' | 'manager' | 'coordinator' | 'member';
const labels: Record<DashboardRole, string> = { super_admin: 'सुपर एडमिन', admin: 'एडमिन', manager: 'मैनेजर', coordinator: 'कोऑर्डिनेटर', member: 'सदस्य' };
export function DashboardNav({ role, email }: { role: DashboardRole; email: string }) {
  const [active, setActive] = useState('dashboard');
  const items = [
    { id: 'home', label: 'Home', href: '/' },
    { id: 'dashboard', label: 'Dashboard', href: '#dashboard' },
    ...(role !== 'member' ? [{ id: 'users', label: 'उपयोगकर्ता', href: '#users' }, { id: 'applications', label: 'सदस्यता आवेदन', href: '#applications' }] : []),
    ...(['super_admin','admin'].includes(role) ? [{ id: 'organization', label: 'संगठन संरचना', href: '#organization' }] : []),
    ...(role === 'super_admin' ? [{ id: 'website', label: 'वेबसाइट सामग्री', href: '#website' }] : []),
  ];
  useEffect(() => {
    const update = () => setActive(window.location.hash.replace('#','') || 'dashboard');
    update(); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update);
  }, []);
  return <aside className="dashboard-sidebar" aria-label="डैशबोर्ड नेविगेशन">
    <div className="sidebar-brand"><span className="seal" aria-hidden="true">ॐ</span><div><b>समिति</b><small>सुरक्षित कार्यक्षेत्र</small></div></div>
    <nav className="sidebar-links">{items.map(item => <Link key={item.id} href={item.href} className={`${active === item.id ? 'active' : ''} ${item.id === 'home' ? 'sidebar-home' : ''}`} onClick={()=>{if(item.id==='home')setActive('home');else setActive(item.id)}}><span aria-hidden="true">{item.id==='home'?'⌂':item.id==='dashboard'?'▦':item.id==='users'?'♙':item.id==='applications'?'▤':item.id==='organization'?'⌘':'✎'}</span>{item.label}</Link>)}</nav>
    <div className="sidebar-account"><span className="avatar-mark">{(email[0] || 'स').toUpperCase()}</span><div><b>{labels[role]}</b><small title={email}>{email}</small></div></div>
    <form action="/api/auth/logout" method="post" className="sidebar-logout"><button type="submit">↪ <span>लॉगआउट</span></button></form>
  </aside>;
}
