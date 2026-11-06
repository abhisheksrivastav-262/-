import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getVerifiedRole, roles, roleLabels, type AppRole } from '../../auth/server';
import { UserManagement } from './user-management';
import { ContentManager } from './content-manager';
import { OrganizationManager } from './organization-manager';
import { ApplicationManager } from './application-manager';
import { DashboardNav } from './dashboard-nav';

export default async function Dashboard({ params }: { params: Promise<{ role: string }> }) {
  const { role: requested } = await params;
  if (!roles.includes(requested as AppRole)) notFound();
  const { user, role, active } = await getVerifiedRole();
  if (!user) redirect(`/login/${requested}`);
  if (!active) redirect('/account-inactive');
  if (!role) redirect('/login');
  if (role !== requested) redirect(`/dashboard/${role}`);
  return <section className="dashboard-page"><div className="dashboard-shell">
    <DashboardNav role={role} email={user.email || ''}/>
    <div className="dashboard-main">
      <header id="dashboard" className="dashboard-top"><div><span className="eyebrow dark">सुरक्षित कार्यक्षेत्र</span><h1>{roleLabels[role]} डैशबोर्ड</h1><p>भूमिका और सत्र सत्यापन पूरा हुआ। उपलब्ध विकल्प आपकी assigned role के अनुसार हैं।</p></div><Link className="button outline darkoutline" href="/">वेबसाइट देखें ↗</Link></header>
      {role !== 'member' && <div id="users" className="dashboard-module"><UserManagement/></div>}
      {role !== 'member' && <div id="applications" className="dashboard-module"><ApplicationManager/></div>}
      {['super_admin','admin'].includes(role) && <div id="organization" className="dashboard-module"><OrganizationManager/></div>}
      {role === 'super_admin' && <div id="website" className="dashboard-module"><ContentManager/></div>}
      {role === 'member' && <div className="member-placeholder"><span>◎</span><div><h2>सदस्य क्षेत्र</h2><p>सदस्य प्रोफ़ाइल, डिजिटल पहचान पत्र, भुगतान और शिकायत सेवाएँ अभी उपलब्ध नहीं हैं।</p></div></div>}
      <footer className="dashboard-footnote">समिति प्रबंधन पोर्टल · सुरक्षित सत्र</footer>
    </div>
  </div></section>;
}
