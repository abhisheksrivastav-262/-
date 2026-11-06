import {notFound} from 'next/navigation';
import {roles,roleLabels,type AppRole} from '../../auth/server';
import {RoleLogin} from './role-login';
export function generateStaticParams(){return roles.map(role=>({role}));}
export default async function RoleLoginPage({params}:{params:Promise<{role:string}>}){const {role}=await params;if(!roles.includes(role as AppRole))notFound();return <><section className="simplehero"><div className="wrap"><div className="eyebrow">सुरक्षित सदस्य क्षेत्र</div><h1>{roleLabels[role as AppRole]} लॉगिन</h1></div></section><section className="simplecontent"><div className="wrap"><RoleLogin expectedRole={role as AppRole}/></div></section></>}
