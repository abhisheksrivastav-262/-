import {NextResponse} from 'next/server';
import {canCreateRole,canReviewStage,getAdminActor,isUnitInScope,roleRank} from '../../../auth/admin';
import {roles,type AppRole} from '../../../auth/server';

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern=/^[0-9a-f-]{36}$/i;
const clean=(x:unknown,max=160)=>typeof x==='string'?x.trim().slice(0,max):'';
const publicOrigin=(request:Request)=>process.env.NEXT_PUBLIC_SITE_URL||new URL(request.url).origin;

async function scopedUserRows(db:any,actor:any){
  const [{data:profiles,error:pe},{data:rolesRows,error:re},{data:units}]=await Promise.all([
    db.from('profiles').select('id,full_name,mobile,is_active,account_status,org_unit_id,designation_id,reporting_officer_id,state,district,tehsil,block,area,created_at').order('created_at',{ascending:false}).limit(2000),
    db.from('user_roles').select('user_id,role,created_at').limit(4000),
    actor.role==='super_admin'?Promise.resolve({data:[]}):db.from('organizational_units').select('id,parent_id,active').limit(2000)
  ]);
  if(pe||re)throw new Error('users-read-failed');
  const rolesByUser=new Map<string,AppRole[]>();for(const row of rolesRows||[]){const arr=rolesByUser.get(row.user_id)||[];if(roles.includes(row.role))arr.push(row.role);rolesByUser.set(row.user_id,arr)}
  const visibleUnits=new Set<string>();
  if(actor.role!=='super_admin'){
    const children=new Map<string,string[]>();for(const unit of units||[]){if(!unit.active||!unit.parent_id)continue;const arr=children.get(unit.parent_id)||[];arr.push(unit.id);children.set(unit.parent_id,arr)}
    const queue=actor.profile.org_unit_id?[actor.profile.org_unit_id]:[];while(queue.length){const id=queue.shift()!;if(visibleUnits.has(id))continue;visibleUnits.add(id);queue.push(...(children.get(id)||[]));}
  }
  const visible=(profiles||[]).filter((p:any)=>actor.role==='super_admin'||(p.org_unit_id&&visibleUnits.has(p.org_unit_id)));
  const {data:authData,error:authError}=await db.auth.admin.listUsers({page:1,perPage:1000});if(authError)throw new Error('users-auth-read-failed');
  const authById=new Map((authData.users||[]).map((u:any)=>[u.id,u]));
  const users=visible.map((profile:any)=>{const auth:any=authById.get(profile.id);const assigned=rolesByUser.get(profile.id)||[];const role=roles.find(r=>assigned.includes(r))||null;return {user_id:profile.id,email:auth?.email||null,role,roles:assigned,invitation_pending:Boolean(auth?.invited_at&&!auth?.email_confirmed_at),email_confirmed:Boolean(auth?.email_confirmed_at),profile};});
  return users;
}

async function logActivity(db:any,actor:any,action:string,targetUser:string,unitId:string|null,details:Record<string,unknown>={}){
  const {error}=await db.from('activity_logs').insert({actor_id:actor.user.id,target_user_id:targetUser,org_unit_id:unitId,action,entity_type:'profiles',entity_id:targetUser,details});
  return !error;
}

export async function GET(){
  const {actor,db,error}=await getAdminActor();if(!actor||!db)return NextResponse.json({error:error||'अनुमति नहीं है।'},{status:403});
  try{
    const users=await scopedUserRows(db,actor);
    const {data:pendingRows,error:appError}=await db.from('membership_applications').select('approval_stage,assigned_unit_id').eq('status','pending').limit(2000);
    if(appError)throw new Error('application-count-failed');let pendingApps=0;for(const row of pendingRows||[])if(await canReviewStage(db,actor,row))pendingApps++;
    const stats={total_users:users.length,active_users:users.filter((u:any)=>u.profile.account_status==='active').length,admins:users.filter((u:any)=>u.role==='admin').length,managers:users.filter((u:any)=>u.role==='manager').length,coordinators:users.filter((u:any)=>u.role==='coordinator').length,members:users.filter((u:any)=>u.role==='member').length,pending_invitations:users.filter((u:any)=>u.invitation_pending).length,pending_applications:pendingApps,suspended_accounts:users.filter((u:any)=>u.profile.account_status==='suspended').length};
    return NextResponse.json({users,stats,actor_role:actor.role},{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'उपयोगकर्ता सूची उपलब्ध नहीं हुई। आवश्यक migration लागू है?'},{status:503});}
}

export async function POST(request:Request){
  const {actor,db,error}=await getAdminActor();if(!actor||!db)return NextResponse.json({error:error||'अनुमति नहीं है।'},{status:403});
  let body:any;try{body=await request.json()}catch{return NextResponse.json({error:'अमान्य अनुरोध।'},{status:400});}
  const fullName=clean(body.full_name,120),email=clean(body.email,254).toLowerCase(),role=body.role as AppRole;
  const orgUnitId=clean(body.org_unit_id,36)||null,designationId=clean(body.designation_id,36)||null;
  if(fullName.length<2||!emailPattern.test(email)||!roles.includes(role)||role==='super_admin'||!canCreateRole(actor,role))return NextResponse.json({error:'आपके अधिकार के लिए नाम, ईमेल या भूमिका मान्य नहीं है।'},{status:403});
  if(role!=='member'&&!orgUnitId)return NextResponse.json({error:'इस भूमिका के लिए संगठन इकाई चुनें।'},{status:400});
  if(orgUnitId&&!await isUnitInScope(db,actor,orgUnitId))return NextResponse.json({error:'यह संगठन इकाई आपके निर्धारित क्षेत्र से बाहर है।'},{status:403});
  if(designationId){const {data:designation}=await db.from('designations').select('id,active').eq('id',designationId).maybeSingle();if(!designation?.active)return NextResponse.json({error:'चुना गया पदनाम उपलब्ध नहीं है।'},{status:400});}
  const reportingOfficerId=clean(body.reporting_officer_id,36)||actor.user.id;
  if(!uuidPattern.test(reportingOfficerId))return NextResponse.json({error:'रिपोर्टिंग अधिकारी चुनें।'},{status:400});
  const [{data:officerProfile},{data:officerRoles}]=await Promise.all([db.from('profiles').select('org_unit_id,is_active,account_status').eq('id',reportingOfficerId).maybeSingle(),db.from('user_roles').select('role').eq('user_id',reportingOfficerId)]);
  const officerRole=roles.find((r)=>officerRoles?.some((x:any)=>x.role===r));
  if(!officerProfile?.is_active||officerProfile.account_status!=='active'||!officerRole||roleRank(officerRole)<=roleRank(role)|| (reportingOfficerId!==actor.user.id&&!await isUnitInScope(db,actor,officerProfile.org_unit_id)))return NextResponse.json({error:'रिपोर्टिंग अधिकारी की भूमिका या संगठन क्षेत्र मान्य नहीं है।'},{status:400});
  const authOrigin=publicOrigin(request),redirectTo=`${authOrigin}/auth/callback?next=${encodeURIComponent(`/dashboard/${role}`)}`;
  const {data:invite,error:inviteError}=await db.auth.admin.inviteUserByEmail(email,{data:{full_name:fullName},redirectTo});
  if(inviteError||!invite.user)return NextResponse.json({error:'आमंत्रण नहीं भेजा जा सका। ईमेल पहले से registered हो सकता है।'},{status:400});
  const userId=invite.user.id;
  const loc={state:clean(body.state,80)||null,district:clean(body.district,100)||null,tehsil:clean(body.tehsil,100)||null,block:clean(body.block,100)||null,area:clean(body.area,160)||null};
  const {error:profileError}=await db.from('profiles').upsert({id:userId,full_name:fullName,mobile:clean(body.mobile,20)||null,is_active:true,account_status:'active',org_unit_id:orgUnitId,designation_id:designationId,reporting_officer_id:reportingOfficerId,created_by:actor.user.id,...loc});
  let failure=profileError;
  if(!failure){const {error:roleError}=await db.from('user_roles').insert({user_id:userId,role});failure=roleError;}
  if(!failure&&role==='manager'&&orgUnitId){const {error:e}=await db.from('managers').insert({user_id:userId,unit_id:orgUnitId});failure=e;}
  if(!failure&&role==='coordinator'&&orgUnitId){const {error:e}=await db.from('coordinators').insert({user_id:userId,unit_id:orgUnitId});failure=e;}
  if(!failure&&role==='member'){const {error:e}=await db.from('members').insert({user_id:userId,unit_id:orgUnitId,designation_id:designationId,full_name:fullName,mobile:clean(body.mobile,20)||'',email,status:'pending',state:loc.state,district:loc.district});failure=e;}
  if(failure){await db.auth.admin.deleteUser(userId);return NextResponse.json({error:'खाता पूरा नहीं बन सका; अधूरा आमंत्रण रद्द किया गया।'},{status:500});}
  if(!await logActivity(db,actor,'user.invited',userId,orgUnitId,{role,email})) {await db.auth.admin.deleteUser(userId);return NextResponse.json({error:'Audit log सुरक्षित नहीं हुआ; आमंत्रण रद्द किया गया।'},{status:500});}
  return NextResponse.json({ok:true,user_id:userId},{status:201});
}

export async function PATCH(request:Request){
  const {actor,db,error}=await getAdminActor();if(!actor||!db)return NextResponse.json({error:error||'अनुमति नहीं है।'},{status:403});
  let body:any;try{body=await request.json()}catch{return NextResponse.json({error:'अमान्य अनुरोध।'},{status:400});}
  const targetId=clean(body.user_id,36);const target=await import('../../../auth/admin').then(m=>m.getManagedUser(db,actor,targetId));
  if(!target)return NextResponse.json({error:'यह उपयोगकर्ता आपके निर्धारित अधिकार क्षेत्र में नहीं है।'},{status:403});
  const nextRole=body.role===undefined?target.role:body.role as AppRole;
  if(!roles.includes(nextRole)||nextRole==='super_admin'||(nextRole!==target.role&&!canCreateRole(actor,nextRole)))return NextResponse.json({error:'यह भूमिका परिवर्तन अनुमत नहीं है।'},{status:403});
  const {data:existingRoleRows,error:existingRoleError}=await db.from('user_roles').select('role').eq('user_id',targetId);
  if(existingRoleError||(existingRoleRows||[]).length!==1)return NextResponse.json({error:'एकाधिक भूमिका वाले खाते का परिवर्तन रोक दिया गया।'},{status:409});
  const unitId=body.org_unit_id===undefined?target.profile.org_unit_id:(clean(body.org_unit_id,36)||null);
  if(nextRole!=='member'&&!unitId)return NextResponse.json({error:'संगठन इकाई आवश्यक है।'},{status:400});
  if(unitId&&!await isUnitInScope(db,actor,unitId))return NextResponse.json({error:'यह संगठन इकाई आपके क्षेत्र से बाहर है।'},{status:403});
  const designationId=body.designation_id===undefined?target.profile.designation_id:(clean(body.designation_id,36)||null);
  if(designationId){const {data}=await db.from('designations').select('id,active').eq('id',designationId).maybeSingle();if(!data?.active)return NextResponse.json({error:'पदनाम उपलब्ध नहीं है।'},{status:400});}
  const status=body.account_status===undefined?target.profile.account_status:body.account_status;
  if(!['active','inactive','suspended'].includes(status))return NextResponse.json({error:'खाते की स्थिति मान्य नहीं है।'},{status:400});
  const fullName=body.full_name===undefined?target.profile.full_name:clean(body.full_name,120);
  const mobile=body.mobile===undefined?target.profile.mobile:clean(body.mobile,20)||null;
  if(fullName.length<2)return NextResponse.json({error:'पूरा नाम भरें।'},{status:400});
  const reportingOfficerId=body.reporting_officer_id===undefined?target.profile.reporting_officer_id:clean(body.reporting_officer_id,36)||null;
  if(!reportingOfficerId)return NextResponse.json({error:'रिपोर्टिंग अधिकारी आवश्यक है।'},{status:400});
  if(reportingOfficerId){const officer=await db.from('profiles').select('org_unit_id,is_active,account_status').eq('id',reportingOfficerId).maybeSingle(), officerRoles=await db.from('user_roles').select('role').eq('user_id',reportingOfficerId);const officerRole=roles.find(r=>officerRoles.data?.some((x:any)=>x.role===r));if(!officer.data?.is_active||officer.data.account_status!=='active'||!officerRole||roleRank(officerRole)<=roleRank(nextRole)||(reportingOfficerId!==actor.user.id&&!await isUnitInScope(db,actor,officer.data.org_unit_id)))return NextResponse.json({error:'रिपोर्टिंग अधिकारी मान्य नहीं है।'},{status:400});}
  const profilePatch={full_name:fullName,mobile,account_status:status,is_active:status==='active',org_unit_id:unitId,designation_id:designationId,reporting_officer_id:reportingOfficerId,state:body.state===undefined?target.profile.state:clean(body.state,80)||null,district:body.district===undefined?target.profile.district:clean(body.district,100)||null,tehsil:body.tehsil===undefined?target.profile.tehsil:clean(body.tehsil,100)||null,block:body.block===undefined?target.profile.block:clean(body.block,100)||null,area:body.area===undefined?target.profile.area:clean(body.area,160)||null};
  const {error:updateError}=await db.from('profiles').update(profilePatch).eq('id',targetId);if(updateError)return NextResponse.json({error:'उपयोगकर्ता विवरण अपडेट नहीं हुए।'},{status:400});
  if(nextRole!==target.role){const {error:deleteRoleError}=await db.from('user_roles').delete().eq('user_id',targetId);if(deleteRoleError)return NextResponse.json({error:'पुरानी भूमिका बदली नहीं जा सकी।'},{status:500});const {error:roleError}=await db.from('user_roles').insert({user_id:targetId,role:nextRole});if(roleError)return NextResponse.json({error:'भूमिका अपडेट नहीं हुई। कृपया Super Admin से संपर्क करें।'},{status:500});}
  if(target.role==='manager'&&nextRole!=='manager')await db.from('managers').delete().eq('user_id',targetId);
  if(target.role==='coordinator'&&nextRole!=='coordinator')await db.from('coordinators').delete().eq('user_id',targetId);
  if(nextRole==='manager'&&unitId)await db.from('managers').upsert({user_id:targetId,unit_id:unitId},{onConflict:'user_id'});
  if(nextRole==='coordinator'&&unitId)await db.from('coordinators').upsert({user_id:targetId,unit_id:unitId},{onConflict:'user_id'});
  if(target.role==='member'||nextRole==='member')await db.from('members').update({unit_id:unitId,designation_id:designationId,full_name:fullName,mobile:mobile||'',state:profilePatch.state,district:profilePatch.district}).eq('user_id',targetId);
  const action=body.account_status!==undefined?`user.${status}`:nextRole!==target.role?'user.role_changed':'user.profile_updated';
  if(!await logActivity(db,actor,action,targetId,unitId,{role:nextRole,previous_role:target.role}))return NextResponse.json({error:'बदलाव हुआ, लेकिन audit entry नहीं बन सकी। कृपया audit log जाँचें।'},{status:500});
  return NextResponse.json({ok:true});
}
