// जर्नलिस्ट सेवा परिषद — Admin Panel Backend (zero-dependency, Node builtins only)
// Run: node admin/server.js  →  site: http://localhost:8010  admin: http://localhost:8010/admin
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8010;
const ROOT = path.resolve(__dirname, "..");
const ADMIN_DIR = __dirname;
const DB_FILE = path.join(ADMIN_DIR, "data.json");
const BACKUP_DIR = path.join(ADMIN_DIR, "backups");
const HTML_FILES = ["index.html","about.html","journalist-welfare.html","membership.html","activities.html","news.html","gallery.html","contact.html","privacy-policy.html","terms.html"];
const MAIN_JS = "js/main.js";

/* ============ SUPABASE INTEGRATION (add-only; local JSON stays canonical fallback) ============ */
function loadEnv(){
  const env={};
  try{
    for(const line of fs.readFileSync(path.join(ADMIN_DIR,".env"),"utf8").split("\n")){
      const t=line.trim(); if(!t||t.startsWith("#")||!t.includes("=")) continue;
      const i=t.indexOf("="); env[t.slice(0,i).trim()]=t.slice(i+1).trim();
    }
  }catch(e){}
  return env;
}
const ENV=loadEnv();
for(const k of ["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY"]){
  if(process.env[k]) ENV[k]=process.env[k]; // production host env overrides local .env file
}
const SB_URL=ENV.SUPABASE_URL||"";
const SB_ANON=ENV.SUPABASE_PUBLISHABLE_KEY||"";
const SB_SECRET=ENV.SUPABASE_SECRET_KEY||"";
function sbLog(m,x){ try{ console.log("[supabase]",m,(x===undefined||x===null)?"":String(x).slice(0,160)); }catch(e){} }
async function sbReq(method,p,body,useSecret,timeoutMs,prefer){
  const key=useSecret?SB_SECRET:SB_ANON;
  if(!SB_URL||!key) return {ok:false,skipped:true};
  try{
    const ctl=new AbortController(); const to=setTimeout(()=>{try{ctl.abort();}catch(e){}},timeoutMs||8000);
    const r=await fetch(SB_URL+p,{method,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:prefer||"return=representation"},body:body===undefined?undefined:JSON.stringify(body),signal:ctl.signal});
    clearTimeout(to);
    const txt=await r.text(); let j=null; try{j=JSON.parse(txt);}catch(e){}
    return {ok:r.ok,status:r.status,json:j};
  }catch(e){ return {ok:false,error:String((e&&e.message)||e).slice(0,120)}; }
}
function splitCap(cap){
  const ms=["जर्नलिस्ट सेवा परिषद्","जर्नलिस्ट सेवा परिषद","जनरल सेवा परिषद"];
  cap=String(cap||"");
  for(const m of ms){ const i=cap.indexOf(m); if(i!==-1) return {designation:cap.slice(0,i).trim(),name:cap.slice(i+m.length).trim()}; }
  return {designation:"",name:cap};
}
function catLabel(cats,val){ const c=(cats||[]).find(x=>x.value===val); return c?c.label:(val||""); }
function stripTags(s){ return String(s||"").replace(/<[^>]*>/g,"").trim(); }
function slugify(s,i){
  const t=String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);
  return "news-"+(i+1)+(t?"-"+t:"");
}
function staticADS(){
  try{
    const js=fs.readFileSync(path.join(ROOT,MAIN_JS),"utf8");
    const m=js.match(/const ADS = (\[[\s\S]*?\n  \]);/);
    return (new Function("return "+m[1]))();
  }catch(e){ return null; }
}
function bg(p){ try{ const r=p(); if(r&&typeof r.catch==="function") r.catch(e=>sbLog("bg mirror failed")); }catch(e){ sbLog("bg mirror error"); } }
const PUB_CACHE={at:0,data:null}; const PUB_TTL=60*1000;
function pubInvalidate(){ PUB_CACHE.at=0; PUB_CACHE.data=null; }
async function sbTable(table,order){
  const r=await sbReq("GET","/rest/v1/"+table+"?select=*"+(order?("&order="+order):""),undefined,false);
  if(r.ok&&Array.isArray(r.json)) return {ok:true,rows:r.json};
  return {ok:false,rows:null,status:r.status,error:r.error,skipped:r.skipped};
}
async function buildPublicBundle(){
  const now=Date.now();
  if(PUB_CACHE.data&&(now-PUB_CACHE.at)<PUB_TTL) return PUB_CACHE.data;
  const L=DB.lists, out={source:"supabase",res:{}}, R={};
  const setR=(n,v)=>{R[n]=v;};
  const jstr=o=>{try{return JSON.stringify(o);}catch(e){return "";}};
  // — leaders —
  try{
    const r=await sbTable("leaders","sort_order");
    const loc=(L.leaders||[]).filter(l=>l.active!==false);
    if(r.ok&&r.rows.length){
      const items=r.rows.filter(l=>l.status==="live").map(l=>{
        const locOne=(loc||[]).find(x=>{const s=splitCap(x.cap);return (s.name||x.alt||"")===l.name;});
        return {img:l.photo_url||"",alt:(locOne&&(locOne.alt||locOne.cap))||l.name||"",cap:(locOne&&locOne.cap)||((l.designation?l.designation+" ":"")+(l.name||"")).trim(),full:!!(locOne&&locOne.full),w:(locOne&&locOne.w)||"480",h:(locOne&&locOne.h)||"544",active:true};
      });
      const sS=items.map(x=>x.img+"|"+x.cap).join(";;");
      const sL=loc.map(l=>{const s=splitCap(l.cap);return l.img+"|"+((s.designation?s.designation+" ":"")+(s.name||l.alt||"")).trim();}).join(";;");
      out.leaders={changed:sS!==sL,items}; setR("leaders","supabase");
    } else { out.leaders={changed:false,items:[]}; setR("leaders","local"); }
  }catch(e){ out.leaders={changed:false,items:[]}; setR("leaders","local"); }
  // — welfare —
  try{
    const r=await sbTable("welfare_cards","slot");
    const eff=i=>{const F=FIELDS.find(f=>f.id==="home_wt"+i),D=FIELDS.find(f=>f.id==="home_wd"+i);
      const tv=DB.fields["home_wt"+i],dv=DB.fields["home_wd"+i];
      return {t:stripTags((tv!==undefined&&tv!=="")?tv:(F?F.old:"")),d:stripTags((dv!==undefined&&dv!=="")?dv:(D?D.old:""))};};
    if(r.ok&&r.rows.length){
      const items=r.rows.filter(w=>w.active!==false).map(w=>({slot:w.slot,title:stripTags(w.title||""),body:stripTags(w.body||"")}));
      const sS=items.map(x=>x.slot+":"+x.title+":"+x.body).join(";;");
      const loc=[]; for(let i=1;i<=6;i++){const e=eff(i); loc.push(i+":"+e.t+":"+e.d);}
      out.welfare={changed:sS!==loc.join(";;"),items}; setR("welfare","supabase");
    } else { out.welfare={changed:false,items:[]}; setR("welfare","local"); }
  }catch(e){ out.welfare={changed:false,items:[]}; setR("welfare","local"); }
  // — news —
  try{
    const r=await sbTable("news","sort_order");
    const loc=(L.news||[]).filter(n=>n.active!==false);
    if(r.ok&&r.rows.length){
      const items=r.rows.filter(n=>n.published!==false).map(n=>({cat:n.category||"",img:n.featured_image||"",alt:n.title||"",tag:catLabel(L.newsCats,n.category),date:n.date_text||"",title:n.title||"",share:n.title||"",desc:n.description||"",active:true}));
      const sS=items.map(x=>[x.title,x.desc,x.img,x.cat,x.date].join("|")).join(";;");
      const sL=loc.map(n=>[n.title,n.desc,n.img,n.cat,n.date].join("|")).join(";;");
      out.news={changed:sS!==sL,items,cats:L.newsCats||[]}; setR("news","supabase");
    } else { out.news={changed:false,items:[],cats:L.newsCats||[]}; setR("news","local"); }
  }catch(e){ out.news={changed:false,items:[],cats:L.newsCats||[]}; setR("news","local"); }
  // — activities —
  try{
    const r=await sbTable("activities","sort_order");
    const loc=(L.activities||[]).filter(a=>a.active!==false);
    if(r.ok&&r.rows.length){
      const items=r.rows.filter(a=>a.published!==false).map(a=>({cat:a.category||"",date:a.date_text||"",place:"",tag:catLabel(L.actCats,a.category),title:a.title||"",meta:"",desc:a.description||"",img:a.image_url||"",active:true}));
      const sS=items.map(x=>[x.title,x.desc,x.img,x.cat,x.date].join("|")).join(";;");
      const sL=loc.map(a=>[a.title,a.desc,a.img||"",a.cat,a.date].join("|")).join(";;");
      out.activities={changed:sS!==sL,items,cats:L.actCats||[]}; setR("activities","supabase");
    } else { out.activities={changed:false,items:[],cats:L.actCats||[]}; setR("activities","local"); }
  }catch(e){ out.activities={changed:false,items:[],cats:L.actCats||[]}; setR("activities","local"); }
  // — gallery (empty table → always local fallback) —
  try{
    const r=await sbTable("gallery","sort_order");
    if(r.ok&&r.rows.length){
      const items=r.rows.filter(g=>g.active!==false).map(g=>({cat:g.category||"",img:g.image_url||"",cap:g.caption||g.title||"",title:g.title||"",tall:false,active:true}));
      out.gallery={changed:true,items,cats:L.galCats||[]}; setR("gallery","supabase");
    } else { out.gallery={changed:false,items:[],cats:L.galCats||[]}; setR("gallery","local"); }
  }catch(e){ out.gallery={changed:false,items:[],cats:L.galCats||[]}; setR("gallery","local"); }
  // — objectives —
  try{
    const r=await sbTable("objectives","sort_order");
    const loc=(L.objectives||[]).filter(t=>t.active!==false).map(t=>t.text||t.title||"");
    if(r.ok&&r.rows.length){
      const items=r.rows.filter(t=>t.active!==false).map(t=>({text:t.title||t.text||""}));
      out.objectives={changed:jstr(items.map(x=>x.text))!==jstr(loc),items}; setR("objectives","supabase");
    } else { out.objectives={changed:false,items:[]}; setR("objectives","local"); }
  }catch(e){ out.objectives={changed:false,items:[]}; setR("objectives","local"); }
  // — notices —
  try{
    const r=await sbTable("notices","created_at");
    if(r.ok&&r.rows.length){
      const items=r.rows.filter(n=>n.published!==false).map(n=>({title:n.title||"",desc:n.description||"",date:n.date_text||"",place:"",kind:""}));
      out.notices={changed:true,items}; setR("notices","supabase");
    } else { out.notices={changed:false,items:[]}; setR("notices","local"); }
  }catch(e){ out.notices={changed:false,items:[]}; setR("notices","local"); }
  // — consumer (awareness_pages) —
  try{
    const r=await sbTable("awareness_pages","created_at");
    if(r.ok&&r.rows.length){
      const items=r.rows.filter(c=>c.published!==false).map(c=>({title:c.page_title||c.title||"",date:"",desc:c.content||""}));
      out.consumer={changed:true,items}; setR("consumer","supabase");
    } else { out.consumer={changed:false,items:[]}; setR("consumer","local"); }
  }catch(e){ out.consumer={changed:false,items:[]}; setR("consumer","local"); }
  // — donors —
  try{
    const r=await sbTable("donors","created_at");
    if(r.ok&&r.rows.length){
      const items=r.rows.map(d=>({name:d.name||"",amount:d.amount||"",note:d.message||d.purpose||"",date:""}));
      out.donors={changed:true,items}; setR("donors","supabase");
    } else { out.donors={changed:false,items:[]}; setR("donors","local"); }
  }catch(e){ out.donors={changed:false,items:[]}; setR("donors","local"); }
  // — ads (merge over static file array) —
  try{
    const st=staticADS();
    const r=await sbTable("ads","sort_order");
    if(r.ok&&r.rows.length&&st){
      const merged=r.rows.filter(a=>a.active!==false).map((a,i)=>{const b=st[i]||{label:"विज्ञापन",title:"",text:"",cta:"",href:"#",theme:"house"};
        return {label:b.label,title:(a.title||b.title),text:b.text,cta:b.cta,href:(a.link_url||b.href),theme:b.theme,img:(a.image_url||b.img)};});
      out.ads={changed:jstr(merged)!==jstr(st),items:merged}; setR("ads","supabase");
    } else { out.ads={changed:false,items:[]}; setR("ads","local"); }
  }catch(e){ out.ads={changed:false,items:[]}; setR("ads","local"); }
  // — donation —
  try{
    const r=await sbTable("donation_settings",null);
    const f=DB.fields.mem_qr;
    const locQR=f?((f.match(/src="([^"]+)"/)||[])[1]||""):"assets/donate-qr-placeholder.svg";
    const locBank=DB.settings.bank||{};
    if(r.ok&&r.rows.length){
      const d=r.rows[0];
      const bank={bankName:d.bank_name||"",accNo:d.account_number||"",ifsc:d.ifsc||"",holder:d.account_holder||"",upiId:d.upi_id||""};
      const locSig=locQR+"|"+[locBank.bankName,locBank.accNo,locBank.ifsc,locBank.holder,locBank.upiId].map(x=>x||"").join("|");
      const supSig=(d.qr_image_url||"")+"|"+[d.bank_name,d.account_number,d.ifsc,d.account_holder,d.upi_id].map(x=>x||"").join("|");
      out.donation={changed:supSig!==locSig,qr:d.qr_image_url||"",bank}; setR("donation","supabase");
    } else { out.donation={changed:false,qr:"",bank:{}}; setR("donation","local"); }
  }catch(e){ out.donation={changed:false,qr:"",bank:{}}; setR("donation","local"); }
  // — social —
  try{
    const r=await sbTable("social_links",null);
    if(r.ok&&r.rows.length){
      const links={};
      for(const s of r.rows){
        const p=String(s.platform||"").toLowerCase();
        const k=p.includes("face")?"fb":p.includes("insta")?"ig":(/^(x\b|twitter)/.test(p))?"x":p.includes("youtu")?"yt":(p.includes("whatsapp")?"wa":null);
        if(k&&s.url) links[k]=s.url;
      }
      const locS=DB.settings.social||{};
      out.social={changed:jstr(links)!==jstr({fb:locS.fb||"",ig:locS.ig||"",x:locS.x||"",yt:locS.yt||""})&&(links.fb||links.ig||links.x||links.yt?true:false)||Object.keys(links).length>0&&jstr(links)!==jstr(locS),links}; setR("social","supabase");
    } else { out.social={changed:false,links:{}}; setR("social","local"); }
  }catch(e){ out.social={changed:false,links:{}}; setR("social","local"); }
  // — texts (only differing keys) —
  try{
    const r=await sbTable("site_content",null);
    const texts=[];
    if(r.ok&&r.rows.length){
      const m={}; r.rows.forEach(x=>{m[x.key]=x.value;});
      for(const f of FIELDS){
        if(!(f.id in m)) continue;
        const cur=DB.fields[f.id];
        const localEff=(cur!==undefined&&cur!=="")?cur:f.old;
        if(m[f.id]!==localEff&&texts.length<300) texts.push({old:localEff,new:m[f.id]});
      }
      for(const g of GLOBALS){
        const cur=(DB.settings.globals||{})[g.key];
        const localEff=(cur!==undefined)?cur:g.value;
        if(("global:"+g.key) in m && m["global:"+g.key]!==localEff&&texts.length<300) texts.push({old:localEff,new:m["global:"+g.key]});
      }
      setR("texts","supabase");
    } else setR("texts","local");
    out.texts=texts;
  }catch(e){ setR("texts","local"); out.texts=[]; }
  const vals=Object.values(R);
  out.source=vals.length&&vals.every(v=>v==="supabase")?"supabase":(vals.some(v=>v==="supabase")?"mixed":"local");
  out.res=R;
  PUB_CACHE.at=Date.now(); PUB_CACHE.data=out;
  return out;
}
/* ---- dual-write mirrors (best-effort; local always wins on failure) ---- */
async function mirrorSiteContent(pairs){
  if(!pairs||!pairs.length) return {ok:true};
  try{
    const r=await sbReq("POST","/rest/v1/site_content",pairs.map(([key,value])=>({key,value:String(value??"")})),true,8000,"resolution=merge-duplicates,return=minimal");
    if(!r.ok) sbLog("site_content mirror failed",r.status);
    return r;
  }catch(e){ sbLog("site_content mirror error"); return {ok:false}; }
}
function mapListToRows(key,arr){
  arr=arr||[];
  if(key==="leaders") return arr.map((l,i)=>{const s=splitCap(l.cap||l.alt||"");return {name:s.name||l.alt||"",designation:s.designation,photo_url:l.img||"",status:l.active===false?"draft":"live",sort_order:i};});
  if(key==="news") return arr.map((n,i)=>({slug:slugify(n.title||n.share,i),title:n.title||"",category:n.cat||"",description:n.desc||"",content:n.desc||"",featured_image:n.img||null,date_text:n.date||"",published:n.active!==false,sort_order:i}));
  if(key==="activities") return arr.map((a,i)=>({title:a.title||"",description:a.desc||"",image_url:a.img||null,date_text:a.date||"",location:a.place||"",category:a.cat||"",published:a.active!==false,sort_order:i}));
  if(key==="gallery") return arr.map((g,i)=>({title:g.cap||g.title||"",image_url:g.img||"",category:g.cat||"",caption:g.cap||"",active:g.active!==false,sort_order:i}));
  if(key==="members") return arr.map(m=>({name:m.name||"",mobile:m.phone||m.mobile||"",email:m.email||"",organization:m.newspaper||m.organization||"",designation:m.role||m.designation||"",city:m.city||"",district:m.district||"",state:m.state||"",membership_id:m.memberId||m.membership_id||"",photo_url:m.img||m.photo||"",status:m.active===false?"draft":"active",join_date:m.joinDate||m.join_date||null,notes:m.address||m.notes||""}));
  if(key==="notices") return arr.map(n=>({title:n.title||"",description:n.desc||n.description||"",date_text:n.date||"",published:n.active!==false}));
  if(key==="donors") return arr.map(d=>({name:d.name||"",amount:d.amount||"",message:d.note||d.message||"",purpose:d.purpose||""}));
  if(key==="objectives") return arr.map((t,i)=>({title:t.text||t.title||"",description:t.desc||t.description||"",active:t.active!==false,sort_order:i}));
  if(key==="consumer") return arr.map((c,i)=>({page_title:c.title||"",slug:slugify(c.title,i).replace(/^news-/,"awareness-"),content:c.desc||"",featured_image:c.img||null,published:c.active!==false,seo_title:c.title||"",seo_description:String(c.desc||"").slice(0,160)}));
  if(key==="ads") return arr.map((a,i)=>({title:a.title||"",image_url:a.img||null,link_url:a.href||null,active:true,sort_order:i}));
  return null;
}
const LIST_TABLE={leaders:"leaders",news:"news",activities:"activities",gallery:"gallery",members:"members",notices:"notices",donors:"donors",objectives:"objectives",consumer:"awareness_pages",ads:"ads"};
async function mirrorList(key){
  try{
    const table=LIST_TABLE[key]; if(!table) return {ok:true,skipped:true};
    const rows=mapListToRows(key,DB.lists[key]||[]);
    if(rows===null) return {ok:true,skipped:true};
    const ex=await sbReq("GET","/rest/v1/"+table+"?select=id",undefined,true);
    if(!ex.ok){ sbLog("mirror list-read failed",table+" "+ex.status); return {ok:false}; }
    const ids=(Array.isArray(ex.json)?ex.json:[]).map(r=>r.id).filter(Boolean);
    if(ids.length){
      const del=await sbReq("DELETE","/rest/v1/"+table+"?id=in.("+ids.join(",")+")",undefined,true);
      if(!del.ok){ sbLog("mirror delete failed",table+" "+del.status); return {ok:false}; }
    }
    if(rows.length){
      const ins=await sbReq("POST","/rest/v1/"+table,rows,true);
      if(!ins.ok){ sbLog("mirror insert failed",table+" "+ins.status); return {ok:false}; }
    }
    pubInvalidate();
    return {ok:true,count:rows.length};
  }catch(e){ sbLog("mirror list error",key); return {ok:false}; }
}
async function mirrorBankSocial(){
  try{
    const b=DB.settings.bank||{};
    const f=DB.fields.mem_qr;
    const qr=f?(((f.match(/src="([^"]+)"/)||[])[1])||""):"";
    const row={bank_name:b.bankName||"",account_holder:b.holder||"",account_number:b.accNo||"",ifsc:b.ifsc||"",branch:b.branch||"",upi_id:b.upiId||"",qr_image_url:qr};
    const ex=await sbReq("GET","/rest/v1/donation_settings?select=id&limit=1",undefined,true);
    if(ex.ok&&Array.isArray(ex.json)&&ex.json.length&&ex.json[0].id){
      await sbReq("PATCH","/rest/v1/donation_settings?id=eq."+ex.json[0].id,row,true);
    } else {
      await sbReq("POST","/rest/v1/donation_settings",row,true);
    }
    const s=DB.settings.social||{};
    const sex=await sbReq("GET","/rest/v1/social_links?select=platform",undefined,true);
    const splats=(sex.ok&&Array.isArray(sex.json)?sex.json:[]).map(r=>r.platform).filter(Boolean);
    if(splats.length) await sbReq("DELETE","/rest/v1/social_links?platform=in.("+splats.join(",")+")",undefined,true);
    const srows=[["facebook",s.fb],["instagram",s.ig],["x",s.x],["youtube",s.yt]].filter(([,u])=>u).map(([platform,url])=>({platform,url,active:true}));
    if(srows.length) await sbReq("POST","/rest/v1/social_links",srows,true);
    pubInvalidate();
    return {ok:true};
  }catch(e){ sbLog("mirror bank/social error"); return {ok:false}; }
}
function sbStatus(s){ const m={new:"unread",contacted:"replied",done:"archived",read:"read",replied:"replied",archived:"archived",unread:"unread"}; return m[String(s||"new")]||"unread"; }
async function mirrorInboxEntry(entry){
  try{
    const d=entry.data||{};
    let table,row;
    if(entry.type==="contact"){ table="contact_messages"; row={name:d.name||"",mobile:d.mobile||"",email:d.email||"",subject:d.subject||"",message:d.message||"",status:sbStatus(entry.status)}; }
    else { table="membership_applications"; row={name:d.name||"",mobile:d.mobile||"",email:d.email||"",city:d.city||"",district:d.district||"",state:d.state||"",media_organization:d.org||"",designation:d.role||"",journalism_experience:d.exp||"",message:d.message||"",status:sbStatus(entry.status)}; }
    const r=await sbReq("POST","/rest/v1/"+table,row,true);
    if(r.ok&&r.json&&r.json[0]&&r.json[0].id){ entry.sbid=r.json[0].id; entry.sbtable=table; try{saveDB();}catch(e){} }
    else sbLog("inbox mirror failed",table+" "+(r.status||""));
  }catch(e){ sbLog("inbox mirror error"); }
}
async function mirrorInboxWrite(entry,del){
  try{
    if(!entry||!entry.sbid||!entry.sbtable) return;
    if(del) await sbReq("DELETE","/rest/v1/"+entry.sbtable+"?id=eq."+entry.sbid,undefined,true);
    else await sbReq("PATCH","/rest/v1/"+entry.sbtable+"?id=eq."+entry.sbid,{status:sbStatus(entry.status)},true);
  }catch(e){ sbLog("inbox status mirror error"); }
}
async function mirrorUpload(localRel,user){
  try{
    const fp=path.join(ROOT,localRel);
    if(!fs.existsSync(fp)) return;
    const buf=fs.readFileSync(fp);
    const ext=path.extname(fp).toLowerCase();
    const ct=MIME[ext]||"application/octet-stream";
    const key=localRel.replace(/^assets\//,"");
    const url=SB_URL+"/storage/v1/object/website-media/"+key.split("/").map(encodeURIComponent).join("/");
    const ctl=new AbortController(); const to=setTimeout(()=>{try{ctl.abort();}catch(e){}},20000);
    const r=await fetch(url,{method:"POST",headers:{apikey:SB_SECRET,Authorization:"Bearer "+SB_SECRET,"Content-Type":ct,"x-upsert":"true"},body:buf,signal:ctl.signal});
    clearTimeout(to);
    if(!r.ok){ sbLog("storage upload failed",r.status); return; }
    const pub=SB_URL+"/storage/v1/object/public/website-media/"+key.split("/").map(encodeURIComponent).join("/");
    await sbReq("POST","/rest/v1/media",{file_url:pub,file_name:path.basename(fp),mime_type:ct,size_bytes:buf.length,folder:path.dirname(localRel).split("/").pop()||"",uploaded_by:user||""},true);
    pubInvalidate();
    sbLog("storage mirror ok");
  }catch(e){ sbLog("storage mirror error"); }
}
async function mirrorDeleteMedia(localRel){
  try{
    const key=localRel.replace(/^assets\//,"");
    await fetch(SB_URL+"/storage/v1/object/website-media/"+key.split("/").map(encodeURIComponent).join("/"),{method:"DELETE",headers:{apikey:SB_SECRET,Authorization:"Bearer "+SB_SECRET}});
    const base=path.basename(localRel);
    const rows=await sbReq("GET","/rest/v1/media?select=id,file_url,file_name",undefined,true);
    if(rows.ok&&Array.isArray(rows.json)){
      for(const m of rows.json){
        if(m.file_url===localRel||String(m.file_url||"").endsWith("/"+base)||m.file_name===base){
          await sbReq("DELETE","/rest/v1/media?id=eq."+m.id,undefined,true);
        }
      }
    }
    pubInvalidate();
  }catch(e){ sbLog("storage delete mirror error"); }
}

/* ================= DB ================= */
function defaultDB(){ return {users:[], sessions:{}, fields:{}, published:{}, gpub:{}, seo:{}, lists:{leaders:[],news:[],activities:[],gallery:[],newsCats:[],actCats:[],galCats:[],ads:[],members:[],donors:[],objectives:[],notices:[],consumer:[]}, settings:{slideSecs:5,bank:{},social:{}}, inbox:[], activity:[], seq:1}; }
let DB;
function loadDB(){
  try{ DB = JSON.parse(fs.readFileSync(DB_FILE,"utf8")); }
  catch(e){ DB = defaultDB(); seedDB(); saveDB(); }
  if(!DB.users.length){ DB.users.push({user:"admin", role:"admin", mustChange:true, ...hashPw("admin123")}); saveDB(); }
  if(!DB.mig2){
    for(const k of ["members","donors","objectives","notices","consumer"]) if(!DB.lists[k]) DB.lists[k]=[];
    if(!DB.lists.objectives.length) DB.lists.objectives=["पत्रकारों के हितों की रक्षा के लिए प्रयास","पत्रकार समुदाय में एकता और सहयोग","पत्रकारों की समस्याओं को उचित मंच तक पहुंचाने का प्रयास","पत्रकारिता के सम्मान और गरिमा को बढ़ावा देना","पत्रकारों के कल्याण से जुड़े प्रयास"].map(t=>({text:t,active:true}));
    DB.settings.bank=DB.settings.bank||{};
    DB.settings.social=DB.settings.social||{};
    DB.mig2=true; saveDB();
  }
}
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(DB)); }
function hashPw(pw){ const salt=crypto.randomBytes(16).toString("hex"); const hash=crypto.scryptSync(pw,salt,64).toString("hex"); return {salt,hash}; }
function checkPw(pw,u){ return crypto.timingSafeEqual(Buffer.from(crypto.scryptSync(pw,u.salt,64).toString("hex")), Buffer.from(u.hash)); }
function logAct(user,action){ DB.activity.unshift({t:Date.now(),user,action}); DB.activity=DB.activity.slice(0,300); }

/* ================= FIELD CONFIG (page → section → fields) =================
   old = exact original string in file. Publish replaces old (or last published) with edited value. */
const FIELDS = [
 // ---- HOME ----
 {id:"home_hero_badge", page:"Home", section:"Hero", file:"index.html", label:"Hero badge", old:"पत्रकारों का राष्ट्रीय संगठन • कानपुर, उत्तर प्रदेश"},
 {id:"home_hero_h1", page:"Home", section:"Hero", file:"index.html", label:"Hero headline ([शब्द] = golden highlight)", type:"textarea", old:"<h1>पत्रकारों की <em>एकता, सम्मान</em> और अधिकारों के लिए समर्पित</h1>"},
 {id:"home_hero_sub", page:"Home", section:"Hero", file:"index.html", label:"Hero sub-text", type:"textarea", old:'<p class="sub">जर्नलिस्ट सेवा परिषद पत्रकारों के हितों, अधिकारों, सम्मान और कल्याण के लिए कार्य करने वाला राष्ट्रीय संगठन है।</p>'},
 {id:"home_vid_h2", page:"Home", section:"Video", file:"index.html", label:"Video heading", old:"<h2>संगठन वीडियो</h2>"},
 {id:"home_trust1t", page:"Home", section:"Trust strip", file:"index.html", label:"Box 1 — title", old:"<b>राष्ट्रीय संगठन</b>"},
 {id:"home_trust1d", page:"Home", section:"Trust strip", file:"index.html", label:"Box 1 — text", old:"<p>पत्रकारों के हित में कार्यरत</p>"},
 {id:"home_trust2t", page:"Home", section:"Trust strip", file:"index.html", label:"Box 2 — title", old:"<b>पत्रकार हित</b>"},
 {id:"home_trust2d", page:"Home", section:"Trust strip", file:"index.html", label:"Box 2 — text", old:"<p>अधिकार एवं कल्याण के लिए प्रयास</p>"},
 {id:"home_trust3t", page:"Home", section:"Trust strip", file:"index.html", label:"Box 3 — title", old:"<b>संगठनात्मक एकता</b>"},
 {id:"home_trust3d", page:"Home", section:"Trust strip", file:"index.html", label:"Box 3 — text", old:"<p>पत्रकारों को एक मंच से जोड़ने का प्रयास</p>"},
 {id:"home_trust4t", page:"Home", section:"Trust strip", file:"index.html", label:"Box 4 — title", old:"<b>सशक्त आवाज़</b>"},
 {id:"home_trust4d", page:"Home", section:"Trust strip", file:"index.html", label:"Box 4 — text", old:"<p>पत्रकारों के मुद्दों को प्रमुखता देने का प्रयास</p>"},
 {id:"home_about_h2", page:"Home", section:"About", file:"index.html", label:"About heading", old:"<h2>जर्नलिस्ट सेवा परिषद के बारे में</h2>"},
 {id:"home_about_lead", page:"Home", section:"About", file:"index.html", label:"About paragraph", type:"textarea", old:'<p class="lead">जर्नलिस्ट सेवा परिषद पत्रकारों का राष्ट्रीय संगठन है, जो पत्रकारों के हितों, अधिकारों, सम्मान और कल्याण के लिए कार्य करने के उद्देश्य से समर्पित है। संगठन पत्रकार समुदाय को एकजुट करने, उनकी समस्याओं को सामने लाने और पत्रकारिता के क्षेत्र में सकारात्मक सहयोग का वातावरण बनाने पर केंद्रित है।</p>'},
 {id:"home_chk1", page:"Home", section:"About checklist", file:"index.html", label:"Point 1", old:"<li>पत्रकारों के हितों की रक्षा के लिए प्रयास</li>"},
 {id:"home_chk2", page:"Home", section:"About checklist", file:"index.html", label:"Point 2", old:"<li>पत्रकार समुदाय में एकता और सहयोग</li>"},
 {id:"home_chk3", page:"Home", section:"About checklist", file:"index.html", label:"Point 3", old:"<li>पत्रकारों की समस्याओं को उचित मंच तक पहुंचाने का प्रयास</li>"},
 {id:"home_chk4", page:"Home", section:"About checklist", file:"index.html", label:"Point 4", old:"<li>पत्रकारिता के सम्मान और गरिमा को बढ़ावा देना</li>"},
 {id:"home_chk5", page:"Home", section:"About checklist", file:"index.html", label:"Point 5", old:"<li>पत्रकारों के कल्याण से जुड़े प्रयास</li>"},
 {id:"home_lead_h2", page:"Home", section:"Leadership", file:"index.html", label:"Leadership heading", old:"<h2>मुख्य पदाधिकारी</h2>"},
 {id:"home_welf_h2", page:"Home", section:"Welfare cards", file:"index.html", label:"Welfare heading", old:"<h2>पत्रकार हित एवं कल्याण</h2>"},
 {id:"home_wt1", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 1 title", old:"<h3>पत्रकार अधिकार</h3>"},
 {id:"home_wd1", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 1 text", old:"<p>पत्रकारों से जुड़े अधिकारों और महत्वपूर्ण मुद्दों के प्रति जागरूकता।</p>"},
 {id:"home_wt2", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 2 title", old:"<h3>पत्रकार सुरक्षा</h3>"},
 {id:"home_wd2", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 2 text", old:"<p>पत्रकारों की सुरक्षा और कार्यस्थल से जुड़े मुद्दों को प्राथमिकता।</p>"},
 {id:"home_wt3", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 3 title", old:"<h3>सम्मान एवं गरिमा</h3>"},
 {id:"home_wd3", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 3 text", old:"<p>पत्रकारिता की गरिमा और पत्रकारों के सम्मान को बढ़ावा देना।</p>"},
 {id:"home_wt4", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 4 title", old:"<h3>समस्या समाधान</h3>"},
 {id:"home_wd4", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 4 text", old:"<p>पत्रकार समुदाय की समस्याओं को उचित मंच तक पहुंचाने का प्रयास।</p>"},
 {id:"home_wt5", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 5 title", old:"<h3>संगठनात्मक सहयोग</h3>"},
 {id:"home_wd5", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 5 text", old:"<p>पत्रकारों के बीच सहयोग और नेटवर्क को मजबूत करना।</p>"},
 {id:"home_wt6", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 6 title", old:"<h3>जनहित पत्रकारिता</h3>"},
 {id:"home_wd6", page:"Home", section:"Welfare cards", file:"index.html", label:"Card 6 text", old:"<p>जिम्मेदार एवं जनहित आधारित पत्रकारिता को प्रोत्साहित करना।</p>"},
 {id:"home_ev_h2", page:"Home", section:"Event highlight", file:"index.html", label:"Event title", old:"<h2>चेयरमैन जनरल सेवा परिषद संजय कुमार मिश्र गूगल मीट को संबोधित करते हुए</h2>"},
 {id:"home_ev_lead", page:"Home", section:"Event highlight", file:"index.html", label:"Event text", old:'<p class="lead">संगठन के कार्यक्रमों और गतिविधियों की झलकियां — अधिक तस्वीरों के लिए मीडिया गैलरी देखें।</p>'},
 {id:"home_cta_h2", page:"Home", section:"CTA band", file:"index.html", label:"CTA heading", old:"<h2>पत्रकार समुदाय से जुड़ें</h2>"},
 {id:"home_cta_p", page:"Home", section:"CTA band", file:"index.html", label:"CTA text", old:"<p>सदस्यता प्रक्रिया सरल और डिजिटल है — फॉर्म भरें, जानकारी सीधे WhatsApp पर भेजी जाएगी।</p>"},
 {id:"foot_about", page:"Global", section:"Footer", file:"*", label:"Footer about text (all pages)", old:"<p>पत्रकारों का राष्ट्रीय संगठन जो पत्रकारों के हितों के लिए कार्य कर रहा है।</p>"},
 // ---- ABOUT ----
 {id:"about_hero_h1", page:"About", section:"Hero", file:"about.html", label:"Page title", old:"<h1>हमारे बारे में</h1>"},
 {id:"about_hero_p", page:"About", section:"Hero", file:"about.html", label:"Hero subtitle", old:"<p>पत्रकारों की एकता, सम्मान और अधिकारों के लिए समर्पित राष्ट्रीय संगठन।</p>"},
 {id:"about_h2", page:"About", section:"Intro", file:"about.html", label:"Intro heading", old:"<h2>जर्नलिस्ट सेवा परिषद</h2>"},
 {id:"about_lead", page:"About", section:"Intro", file:"about.html", label:"Intro paragraph", type:"textarea", old:'<p class="lead">जर्नलिस्ट सेवा परिषद पत्रकारों का राष्ट्रीय संगठन है, जो पत्रकारों के हितों, अधिकारों, सम्मान और कल्याण के लिए कार्य करने के उद्देश्य से समर्पित है। संगठन पत्रकार समुदाय को एकजुट करने, उनकी समस्याओं को सामने लाने और पत्रकारिता के क्षेत्र में सकारात्मक सहयोग का वातावरण बनाने पर केंद्रित है।</p>'},
 {id:"about_v1t", page:"About", section:"Values", file:"about.html", label:"Value 1 title", old:"<h3>एकता</h3>"},
 {id:"about_v1d", page:"About", section:"Values", file:"about.html", label:"Value 1 text", old:"<p>पत्रकारों को एक मंच से जोड़ने और आपसी सहयोग को बढ़ावा देने का प्रयास।</p>"},
 {id:"about_v2t", page:"About", section:"Values", file:"about.html", label:"Value 2 title", old:"<h3>विश्वसनीयता</h3>"},
 {id:"about_v2d", page:"About", section:"Values", file:"about.html", label:"Value 2 text", old:"<p>पारदर्शी कार्यशैली और संस्थागत गरिमा के साथ पत्रकार हित में कार्य।</p>"},
 {id:"about_v3t", page:"About", section:"Values", file:"about.html", label:"Value 3 title", old:"<h3>जिम्मेदार पत्रकारिता</h3>"},
 {id:"about_v3d", page:"About", section:"Values", file:"about.html", label:"Value 3 text", old:"<p>जनहित आधारित, संतुलित और जिम्मेदार पत्रकारिता को प्रोत्साहित करना।</p>"},
 {id:"about_cta_h2", page:"About", section:"CTA band", file:"about.html", label:"CTA heading", old:"<h2>हमसे जुड़कर सशक्त बनें</h2>"},
 // ---- WELFARE ----
 {id:"welf_hero_h1", page:"Welfare", section:"Hero", file:"journalist-welfare.html", label:"Page title", old:"<h1>पत्रकार हित एवं कल्याण</h1>"},
 {id:"welf_d1", page:"Welfare", section:"Cards", file:"journalist-welfare.html", label:"अधिकार — text", type:"textarea", old:"<p>पत्रकारों से जुड़े अधिकारों और महत्वपूर्ण मुद्दों के प्रति जागरूकता। अधिकारों की जानकारी, संवाद और उचित मंच तक आवाज़ पहुंचाने का प्रयास।</p>"},
 {id:"welf_d2", page:"Welfare", section:"Cards", file:"journalist-welfare.html", label:"सुरक्षा — text", type:"textarea", old:"<p>पत्रकारों की सुरक्षा और कार्यस्थल से जुड़े मुद्दों को प्राथमिकता। फील्ड रिपोर्टिंग और कार्य के दौरान आने वाली चुनौतियों पर सहयोग का प्रयास।</p>"},
 {id:"welf_d3", page:"Welfare", section:"Cards", file:"journalist-welfare.html", label:"सम्मान — text", type:"textarea", old:"<p>पत्रकारिता की गरिमा और पत्रकारों के सम्मान को बढ़ावा देना। सकारात्मक पत्रकारिता को प्रोत्साहन और सम्मान कार्यक्रमों का प्रयास।</p>"},
 {id:"welf_d4", page:"Welfare", section:"Cards", file:"journalist-welfare.html", label:"समस्या समाधान — text", type:"textarea", old:"<p>पत्रकार समुदाय की समस्याओं को उचित मंच तक पहुंचाने का प्रयास। संगठनात्मक स्तर पर संवाद और सहयोग का वातावरण।</p>"},
 {id:"welf_d5", page:"Welfare", section:"Cards", file:"journalist-welfare.html", label:"सहयोग — text", type:"textarea", old:"<p>पत्रकारों के बीच सहयोग और नेटवर्क को मजबूत करना। बैठकों, संवाद और सामूहिक मंच के माध्यम से एकता का प्रयास।</p>"},
 {id:"welf_d6", page:"Welfare", section:"Cards", file:"journalist-welfare.html", label:"जनहित — text", type:"textarea", old:"<p>जिम्मेदार एवं जनहित आधारित पत्रकारिता को प्रोत्साहित करना। समाज और राष्ट्रहित में सकारात्मक पत्रकारिता का समर्थन।</p>"},
 // ---- MEMBERSHIP ----
 {id:"mem_hero_h1", page:"Membership", section:"Hero", file:"membership.html", label:"Page title", old:"<h1>जर्नलिस्ट सेवा परिषद से जुड़ें</h1>"},
 {id:"mem_hero_p", page:"Membership", section:"Hero", file:"membership.html", label:"Hero text", type:"textarea", old:"<p>पत्रकार समुदाय को एक मजबूत और संगठित मंच से जोड़ने के उद्देश्य से सदस्यता प्रक्रिया को सरल और डिजिटल बनाया गया है।</p>"},
 {id:"mem_form_h2", page:"Membership", section:"Form", file:"membership.html", label:"Form heading", old:"<h2 style=\"margin-top:0\">सदस्यता आवेदन फॉर्म</h2>"},
 {id:"mem_amt_lbl", page:"Membership", section:"Donate box", file:"membership.html", label:"Amount label", old:'<label for="m-amount">दान राशि (₹) *</label>'},
 {id:"mem_utr_lbl", page:"Membership", section:"Donate box", file:"membership.html", label:"UTR label", old:'<label for="m-utr">UTR / रेफरेंस नंबर</label>'},
 {id:"mem_qr", page:"Membership", section:"Donate box", file:"membership.html", label:"Donate QR image path", old:'src="assets/donate-qr-placeholder.svg"'},
 // ---- CONTACT ----
 {id:"con_hero_h1", page:"Contact", section:"Hero", file:"contact.html", label:"Page title", old:"<h1>संपर्क करें</h1>"},
 {id:"con_hero_p", page:"Contact", section:"Hero", file:"contact.html", label:"Hero text", old:"<p>सदस्यता, कार्यक्रम या पत्रकार हित से जुड़े विषयों पर हमसे जुड़ें।</p>"},
 {id:"con_form_h2", page:"Contact", section:"Form", file:"contact.html", label:"Form heading", old:"<h2 style=\"margin-top:0\">संदेश भेजें</h2>"},
 {id:"con_map_note", page:"Contact", section:"Maps", file:"contact.html", label:"Map note", type:"textarea", old:'नोट: सटीक GPS निर्देशांक सत्यापित न होने के कारण पते पर आधारित Google Maps खोज/एम्बेड दिखाया गया है।'},
 // ---- GALLERY video placeholders ----
 {id:"gal_vid1", page:"Gallery", section:"Video placeholders", file:"gallery.html", label:"Video card 1 title", old:"<h3>इवेंट हाइलाइट — placeholder</h3>"},
 {id:"gal_vid2", page:"Gallery", section:"Video placeholders", file:"gallery.html", label:"Video card 2 title", old:"<h3>इंटरव्यू — placeholder</h3>"},
];
// Global find-replace values (applied in order!). wa FIRST (contains phone as substring).
const GLOBALS = [
 {key:"wa", label:"WhatsApp number (with country code)", value:"918318168274"},
 {key:"phone", label:"Phone / Call number", value:"8318168274"},
 {key:"email", label:"Email ID", value:"jsp.bharatvarsh@gmail.com"},
 {key:"addrKanpur", label:"Kanpur address (footer single-line)", value:"100A शताब्दी रोड, रतनपुर विस्तार, पनकी, कानपुर, उत्तर प्रदेश 208020"},
 {key:"addrMumbai", label:"Mumbai National Office (footer)", value:"28, 404, 4th Floor, Green Park, Mira Road (E), Mumbai"},
 {key:"tagline", label:"Tagline (footer)", value:"पत्रकारों का राष्ट्रीय संगठन जो पत्रकारों के हितों के लिए कार्य कर रहा है"},
];

function bareTag(s){
  const m=/^<(h1|h2|h3|p|b|strong|li|span|div|label)(\s[^>]*)?>([\s\S]*)<\/\1>$/.exec((s||"").trim());
  if(!m) return null;
  const inner=m[3];
  if(/</.test(inner.replace(/<em>.*?<\/em>/g,""))) return null; // other tags → raw HTML mode
  return {tag:m[1],attrs:m[2]||"",em:/<em>/.test(inner)};
}

/* ================= SEED (parse current HTML → DB lists) ================= */
function readF(f){ return fs.readFileSync(path.join(ROOT,f),"utf8"); }
function escQ(s){ return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;"); }
function seedDB(){
  const L = DB.lists;
  // leaders (from index)
  const idx = readF("index.html");
  const figs = idx.match(/<figure class="leader-card[\s\S]*?<\/figure>/g)||[];
  L.leaders = figs.map(f=>{
    const src=(f.match(/src="([^"]+)"/)||[])[1]||"";
    const alt=(f.match(/alt="([^"]*)"/)||[])[1]||"";
    const cap=(f.match(/<figcaption>([^<]*)<\/figcaption>/)||[])[1]||"";
    const full=/leader-card--full/.test(f);
    const w=(f.match(/width="(\d+)"/)||[])[1]||"480";
    const h=(f.match(/height="(\d+)"/)||[])[1]||"544";
    return {img:src,alt:alt||cap,cap,full,w,h,active:true};
  });
  // news
  const nw = readF("news.html");
  const arts = nw.match(/<article class="news-card[\s\S]*?<\/article>/g)||[];
  L.news = arts.map(a=>{
    const g=n=>(a.match(n)||[])[1]||"";
    const ps=[...a.matchAll(/<p>([^<]*)<\/p>/g)].map(m=>m[1]);
    return {cat:g(/data-category="([^"]+)"/), img:g(/src="([^"]+)"/), alt:g(/alt="([^"]*)"/), tag:g(/<span class="tag">([^<]*)<\/span>/), date:g(/<p class="meta">([^<]*)<\/p>/), title:g(/<h3>([^<]*)<\/h3>/), share:g(/data-share="wa" data-title="([^"]*)"/), desc:ps[ps.length-1]||"", active:true};
  });
  // activities
  const ac = readF("activities.html");
  const tis = ac.match(/<article class="t-item[\s\S]*?<\/article>/g)||[];
  L.activities = tis.map(a=>{
    const g=n=>(a.match(n)||[])[1]||"";
    const ps=[...a.matchAll(/<p class="meta">([^<]*)<\/p>|<p>([^<]*)<\/p>/g)].map(m=>m[1]||m[2]);
    return {cat:g(/data-category="([^"]+)"/), date:g(/<div class="t-date"><b>([^<]*)<\/b>/), place:g(/<span>([^<]*)<\/span>/), tag:g(/<span class="tag">([^<]*)<\/span>/), title:g(/<h3[^>]*>([^<]*)<\/h3>/), meta:ps[0]||"", desc:ps[ps.length-1]||"", active:true};
  });
  // gallery
  const gl = readF("gallery.html");
  const gis = gl.match(/<figure class="g-item[\s\S]*?<\/figure>/g)||[];
  L.gallery = gis.map(a=>{
    const g=n=>(a.match(n)||[])[1]||"";
    return {cat:g(/data-gcat="([^"]+)"/), img:g(/src="([^"]+)"/), alt:g(/alt="([^"]*)"/), cap:g(/<figcaption>([^<]*)<\/figcaption>/), tall:/g-item--tall/.test(a), active:true};
  });
  // categories from chips
  const chipVals=(html,attr)=>{ const s=new Set(); const re=new RegExp("data-"+attr+"=\"([^\"]+)\"","g"); let m; while((m=re.exec(html))){ if(m[1]!=="all") s.add(m[1]); } return [...s]; };
  const chipLabel=(html,attr,v)=>{ const m=html.match(new RegExp('<button class="chip" data-'+attr+'="'+v+'">([^<]*)<')); return m?m[1]:v; };
  L.actCats = chipVals(ac,"filter").map(v=>({value:v,label:chipLabel(ac,"filter",v)}));
  L.newsCats = chipVals(nw,"filter").map(v=>({value:v,label:chipLabel(nw,"filter",v)}));
  L.galCats = chipVals(gl,"gfilter").map(v=>({value:v,label:chipLabel(gl,"gfilter",v)}));
  // objectives seed (5 sankalp)
  L.objectives = ["पत्रकारों के हितों की रक्षा के लिए प्रयास","पत्रकार समुदाय में एकता और सहयोग","पत्रकारों की समस्याओं को उचित मंच तक पहुंचाने का प्रयास","पत्रकारिता के सम्मान और गरिमा को बढ़ावा देना","पत्रकारों के कल्याण से जुड़े प्रयास"].map(t=>({text:t,active:true}));
  // ads from main.js
  const js = readF(MAIN_JS);
  const mAds = js.match(/const ADS = (\[[\s\S]*?\n  \]);/);
  try{ L.ads = (new Function("return "+mAds[1]))(); }catch(e){ L.ads=[]; }
  // seo seed
  DB.seo = {};
  for(const f of [...HTML_FILES,"consumer.html"]){
    const h=readF(f);
    DB.seo[f]={title:(h.match(/<title>([^<]*)<\/title>/)||[])[1]||"", desc:(h.match(/<meta name="description" content="([^"]*)"/)||[])[1]||""};
  }
}

/* ================= PUBLISH ENGINE ================= */
function leaderCard(l){
  const cls = l.full ? "leader-card leader-card--full reveal" : "leader-card reveal";
  return `<figure class="${cls}">\n  <img loading="lazy" width="${l.w||480}" height="${l.h||544}" src="${l.img}" alt="${escQ(l.alt||l.cap)}">\n  <figcaption>${l.cap}</figcaption>\n</figure>`;
}
const indent6 = s=>s.split("\n").map(l=>"      "+l).join("\n");
function newsCard(n){
  const t=escQ(n.share||n.title);
  return `<article class="news-card reveal" data-category="${n.cat}"><img loading="lazy" width="600" height="400" src="${n.img}" alt="${escQ(n.alt||n.title)}"><div class="news-body"><span class="tag">${n.tag}</span><p class="meta">${n.date}</p><h3>${n.title}</h3><p>${n.desc}</p><div class="share-row"><a href="#" data-share="wa" data-title="${t}">WhatsApp</a><a href="#" data-share="x" data-title="${t}">X</a><a href="#" data-share="fb" data-title="${t}">Facebook</a></div></div></article>`;
}
function actCard(a){
  const im=a.img?`<img class="t-thumb" loading="lazy" src="${a.img}" alt="${escQ(a.title||"गतिविधि")}">`:"";
  return `<article class="t-item reveal" data-category="${a.cat}">${im}<div class="t-date"><b>${a.date}</b><span>${a.place}</span></div><div><span class="tag">${a.tag}</span><h3 style="color:var(--navy)">${a.title}</h3><p class="meta">${a.meta}</p><p>${a.desc}</p></div></article>`;
}
function galCard(g){
  return `<figure class="g-item${g.tall?" g-item--tall":""} reveal" data-gcat="${g.cat}"><img loading="lazy" width="600" height="420" src="${g.img}" alt="${escQ(g.alt||g.cap)}"><figcaption>${g.cap}</figcaption></figure>`;
}
/* Marker blocks: <!--NAME-->...<!--/NAME--> with indent preserved */
function repMarker(content, name, genHTML, warnings, ctx){
  const re = new RegExp("([ \\t]*)<!--"+name+"-->([\\s\\S]*?)[ \\t]*<!--\\/"+name+"-->");
  let n=0;
  const out = content.replace(re, (m, ind)=>{
    n++;
    const inner = genHTML ? "\n"+genHTML.split("\n").map(l=>l?ind+l:l).join("\n")+"\n"+ind : "";
    return ind+"<!--"+name+"-->"+inner+"<!--/"+name+"-->";
  });
  if(!n) warnings.push(ctx+": marker "+name+" not found");
  return {content:out, changed:n>0&&out!==content};
}
function objectivesHTML(items){
  return `<ul class="check-list">\n` + items.filter(t=>t.active!==false).map(t=>`  <li>${t.text}</li>`).join("\n") + `\n</ul>`;
}
function donorsHTML(donors){
  const live=donors.filter(d=>d.active!==false);
  if(!live.length) return `<p class="hint" style="text-align:center">दानदाताओं की सूची जल्द प्रकाशित होगी।</p>`;
  return `<div class="grid-3" style="margin-top:26px">\n` + live.map(d=>`<div class="card reveal visible"><div class="icon">❤️</div><h3>${d.name}</h3><p>${d.amount?("₹"+d.amount):""}${d.amount&&d.note?" • ":""}${d.note||""}</p>${d.date?`<p class="meta">${d.date}</p>`:""}</div>`).join("\n") + `\n</div>`;
}
function consumerHTML(items){
  const live=items.filter(c=>c.active!==false);
  if(!live.length) return `<p class="hint" style="text-align:center">उपभोक्ता जागरूकता कार्यक्रमों की सूची जल्द प्रकाशित होगी।</p>`;
  return `<div class="grid-3" style="margin-top:26px">\n` + live.map(c=>`<div class="card reveal visible"><div class="icon">📢</div><h3>${c.title}</h3>${c.date?`<p class="meta">${c.date}</p>`:""}<p>${c.desc||""}</p></div>`).join("\n") + `\n</div>`;
}
function noticesHTML(items){
  const live=items.filter(n=>n.active!==false);
  if(!live.length) return "";
  const kindName={event:"📅 आगामी कार्यक्रम",achieve:"🏆 उपलब्धि",convention:"🎪 अधिवेशन"};
  return live.map(n=>`<article class="t-item reveal"><div class="t-date"><b>${n.date||""}</b><span>${n.place||""}</span></div><div><span class="tag">${kindName[n.kind]||n.kind||""}</span><h3 style="color:var(--navy)">${n.title}</h3><p>${n.desc||""}</p></div></article>`).join("\n");
}
function bankHTML(b){
  b=b||{};
  const rows=[];
  if(b.bankName||b.accNo||b.ifsc||b.holder) rows.push(`<div class="info-row" style="background:#fff">🏦 <b>बैंक खाता:</b><br>${[b.bankName&&("बैंक: "+b.bankName),b.accNo&&("खाता नं: "+b.accNo),b.ifsc&&("IFSC: "+b.ifsc),b.holder&&("धारक: "+b.holder)].filter(Boolean).join("<br>")}</div>`);
  if(b.upiId) rows.push(`<div class="info-row" style="background:#fff">📱 <b>UPI ID:</b> ${b.upiId}</div>`);
  if(!rows.length) return `<p class="hint">बैंक विवरण जल्द जोड़ा जाएगा।</p>`;
  return rows.join("\n");
}
function socialHTML(s){
  s=s||{};
  const links=[["fb","Facebook","f"],["ig","Instagram","ig"],["x","X (Twitter)","x"],["yt","YouTube","▶"]];
  const live=links.filter(([k])=>s[k]);
  if(!live.length) return "";
  return `<div class="social-row">\n` + live.map(([k,label,icon])=>`<a href="${s[k]}" target="_blank" rel="noopener" aria-label="${label}">${icon}</a>`).join("\n") + `\n</div>`;
}
function chipsHTML(cats, attr){
  return `<button class="chip active" data-${attr}="all">सभी</button>` + cats.map(c=>`\n<button class="chip" data-${attr}="${c.value}">${c.label}</button>`).join("");
}
const qjs = s=>'"'+String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"';
function adsJS(ads){
  return "const ADS = [\n" + ads.map(a=>{
    const p=[`label:${qjs(a.label)}`, `title:${qjs(a.title)}`, `text:${qjs(a.text)}`, `cta:${qjs(a.cta)}`, `href:${qjs(a.href)}`, `theme:${qjs(a.theme)}`];
    if(a.img) p.push(`img:${qjs(a.img)}`);
    return "    {"+p.join(", ")+"}";
  }).join(",\n") + "\n  ];";
}
function replaceAll(s,from,to){ return s.split(from).join(to); }
// apply one text replacement honoring previously-published value (idempotent re-publish)
function applyRep(content, orig, prev, val, warnings, ctx){
  if(!val || val===orig && !prev) return {content, changed:false};
  if(content.includes(orig)){ return {content: replaceAll(content,orig,val), changed:true}; }
  if(prev && content.includes(prev)){ return {content: replaceAll(content,prev,val), changed:true}; }
  warnings.push(ctx+": original text not found (page edited manually?)");
  return {content, changed:false};
}
function transformFile(file, content, warnings){
  let changed = false;
  const mark = c=>{ if(c) changed=true; };
  // 1. globals (ordered)
  const gcur = DB.settings.globals || {};
  for(const g of GLOBALS){
    const val = gcur[g.key]!==undefined ? gcur[g.key] : g.value;
    const prev = (DB.gpub||{})[g.key];
    const r = applyRep(content, g.value, prev, val, warnings, "Global:"+g.key);
    content=r.content; mark(r.changed); if(r.changed){ DB.gpub=DB.gpub||{}; DB.gpub[g.key]=val; }
  }
  // 2. fields
  for(const f of FIELDS){
    const val = DB.fields[f.id];
    if(val===undefined || val==="") continue;
    const prev = (DB.published||{})[f.id];
    const files = f.file==="*" ? HTML_FILES : [f.file];
    if(!files.includes(file)) continue;
    const r = applyRep(content, f.old, prev, val, warnings, "Field:"+f.id);
    content=r.content; mark(r.changed); if(r.changed){ DB.published=DB.published||{}; DB.published[f.id]=val; }
  }
  // 3. lists
  const L = DB.lists;
  const repBlock=(re,gen,label)=>{ if(re.test(content)){ const nc=content.replace(re,gen); if(nc!==content){content=nc;mark(true);} } else warnings.push(label+": block not found"); };
  if(file==="index.html"||file==="about.html"){
    const cards=L.leaders.filter(l=>l.active!==false).map(l=>"\n"+indent6(leaderCard(l))).join("");
    repBlock(/(?:\n[ \t]*<figure class="leader-card[\s\S]*?<\/figure>)+/, cards, file+":leaders");
  }
  if(file==="news.html"){
    const cards=L.news.filter(n=>n.active!==false).map(n=>"\n"+newsCard(n)).join("");
    repBlock(/(?:\n<article class="news-card[\s\S]*?<\/article>)+/, cards, "news:cards");
    repBlock(/<button class="chip(?: active)?" data-filter="[^"]*">[^<]*<\/button>(\n<button class="chip(?: active)?" data-filter="[^"]*">[^<]*<\/button>)*/, chipsHTML(L.newsCats,"filter"), "news:chips");
  }
  if(file==="activities.html"){
    const cards=L.activities.filter(a=>a.active!==false).map(a=>"\n"+actCard(a)).join("");
    repBlock(/(?:\n<article class="t-item[\s\S]*?<\/article>)+/, cards, "activities:cards");
    repBlock(/<button class="chip(?: active)?" data-filter="[^"]*">[^<]*<\/button>(\n<button class="chip(?: active)?" data-filter="[^"]*">[^<]*<\/button>)*/, chipsHTML(L.actCats,"filter"), "activities:chips");
  }
  if(file==="gallery.html"){
    const cards=L.gallery.filter(g=>g.active!==false).map(g=>"\n"+galCard(g)).join("");
    repBlock(/(?:\n<figure class="g-item[\s\S]*?<\/figure>)+/, cards, "gallery:cards");
    repBlock(/<button class="chip(?: active)?" data-gfilter="[^"]*">[^<]*<\/button>(\n<button class="chip(?: active)?" data-gfilter="[^"]*">[^<]*<\/button>)*/, chipsHTML(L.galCats,"gfilter"), "gallery:chips");
  }
  // 3b. marker blocks (objectives / donors / bank / consumer / social / notices)
  const doMarker=(name,gen)=>{
    const r=repMarker(content,name,gen,warnings,file);
    if(r.content!==content){ content=r.content; mark(true); }
  };
  if(file==="index.html"||file==="about.html") doMarker("OBJECTIVES",objectivesHTML(L.objectives));
  if(file==="membership.html"){ doMarker("DONORS-WALL",donorsHTML(L.donors)); doMarker("BANK-BLOCK",bankHTML(DB.settings.bank)); }
  if(file==="consumer.html") doMarker("CONSUMER-LIST",consumerHTML(L.consumer));
  if(file==="activities.html"&&L.notices.some(n=>n.active!==false)){
    // notices render above timeline (after toolbar placeholder)
    const r=repMarker(content,"NOTICES",'<div class="timeline">\n'+noticesHTML(L.notices)+'\n</div>',warnings,file);
    if(r.content!==content){ content=r.content; mark(true); }
  }
  const SOCIAL_FILES=["index.html","about.html","journalist-welfare.html","membership.html","activities.html","news.html","gallery.html","contact.html","consumer.html"];
  if(SOCIAL_FILES.includes(file)) doMarker("SOCIAL",socialHTML(DB.settings.social));
  if(file===MAIN_JS){
    repBlock(/const ADS = \[[\s\S]*?\n  \];/, adsJS(L.ads), "ads:array");
  }
  // 4. SEO
  const seo = (DB.seo||{})[file];
  if(seo){
    if(seo.title){ const nc=content.replace(/<title>[^<]*<\/title>/,`<title>${seo.title}</title>`); if(nc!==content){content=nc;mark(true);} }
    if(seo.desc){ const nc=content.replace(/<meta name="description" content="[^"]*"/,`<meta name="description" content="${escQ(seo.desc)}"`); if(nc!==content){content=nc;mark(true);} }
  }
  return {content, changed};
}
function doPublish(){
  const warnings=[];
  if(!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR,{recursive:true});
  const ts=new Date().toISOString().replace(/[:.]/g,"-");
  const bdir=path.join(BACKUP_DIR,ts); fs.mkdirSync(bdir);
  const changedFiles=[];
  for(const f of [...HTML_FILES,"consumer.html",MAIN_JS]){
    const fp=path.join(ROOT,f);
    const orig=fs.readFileSync(fp,"utf8");
    fs.writeFileSync(path.join(bdir,f.replace(/\//g,"_")+".bak"),orig);
    const {content,changed}=transformFile(f,orig,warnings);
    if(changed){ fs.writeFileSync(fp,content); changedFiles.push(f); }
  }
  // prune backups (keep 10)
  const all=fs.readdirSync(BACKUP_DIR).sort();
  while(all.length>10){ fs.rmSync(path.join(BACKUP_DIR,all.shift()),{recursive:true,force:true}); }
  saveDB();
  return {backup:ts, changed:changedFiles, warnings};
}

/* ================= HTTP helpers ================= */
function send(res,code,obj,ct="application/json"){ const b=typeof obj==="string"?obj:JSON.stringify(obj); res.writeHead(code,{"Content-Type":ct+"; charset=utf-8","Content-Length":Buffer.byteLength(b),"Cache-Control":"no-store"}); res.end(b); }
function parseBody(req,limit=64*1024*1024){ return new Promise((res,rej)=>{ let n=0; const ch=[]; req.on("data",c=>{ n+=c.length; if(n>limit){rej(new Error("too large")); req.destroy();} else ch.push(c); }); req.on("end",()=>res(Buffer.concat(ch).toString("utf8"))); req.on("error",rej); }); }
function cookies(req){ const o={}; (req.headers.cookie||"").split(";").forEach(p=>{ const i=p.indexOf("="); if(i>0) o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim()); }); return o; }
function sessionUser(req){
  const sid=cookies(req).sid; if(!sid) return null;
  const s=DB.sessions[sid]; if(!s||s.exp<Date.now()) return null;
  if(s.exp-Date.now()<15*864e5) s.exp=Date.now()+30*864e5; // sliding: active rehne par kabhi expire nahi
  return DB.users.find(u=>u.user===s.user)||null;
}
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".json":"application/json",".xml":"application/xml",".txt":"text/plain",".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp",".svg":"image/svg+xml",".mp4":"video/mp4",".ico":"image/x-icon"};
function serveStatic(req,res,pathname){
  try{
    let rel=decodeURIComponent(pathname);
    if(rel==="/") rel="/index.html";
    rel=path.normalize(rel).replace(/^(\.\.[\/\\])+/,"");
    if(rel.includes("admin"+path.sep+"data.json")||rel.includes("admin/backups")||rel.includes(".git")){ send(res,403,"Forbidden","text/plain"); return; }
    const fp=path.join(ROOT,rel);
    if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){ res.writeHead(404,{"Content-Type":"text/html"}); res.end(fs.readFileSync(path.join(ROOT,"404.html"))); return; }
    const stat=fs.statSync(fp);
    const ct=MIME[path.extname(fp).toLowerCase()]||"application/octet-stream";
    const range=req.headers.range;
    if(range){
      const m=range.match(/bytes=(\d*)-(\d*)/);
      if(m){ let s=m[1]?+m[1]:0, e=m[2]?+m[2]:stat.size-1; e=Math.min(e,stat.size-1);
        res.writeHead(206,{"Content-Type":ct,"Content-Length":e-s+1,"Content-Range":`bytes ${s}-${e}/${stat.size}`,"Accept-Ranges":"bytes"});
        fs.createReadStream(fp,{start:s,end:e}).pipe(res); return; }
    }
    res.writeHead(200,{"Content-Type":ct,"Content-Length":stat.size,"Accept-Ranges":"bytes"});
    fs.createReadStream(fp).pipe(res);
  }catch(e){ send(res,500,"Server error","text/plain"); }
}
function listMedia(){
  const out=[];
  const walk=(dir,rel)=>{ for(const n of fs.readdirSync(dir)){ const p=path.join(dir,n); const r=rel?rel+"/"+n:n;
    if(fs.statSync(p).isDirectory()){ if(n.startsWith(".")) continue; walk(p,r); }
    else if(/\.(jpe?g|png|webp|svg|mp4)$/i.test(n)) out.push({path:"assets/"+r.replace(/^assets\//,""), size:fs.statSync(p).size}); } };
  const a=path.join(ROOT,"assets"); if(fs.existsSync(a)) walk(a,"");
  return out.sort((x,y)=>x.path.localeCompare(y.path));
}
function mediaUsage(rel){
  const uses=[];
  for(const f of [...HTML_FILES,MAIN_JS,"css/style.css"]){
    try{ const h=fs.readFileSync(path.join(ROOT,f),"utf8"); if(h.includes(rel)) uses.push(f); }catch(e){}
  }
  return uses;
}

/* ================= API ================= */
async function api(req,res,url){
  const method=req.method;
  const need=(role)=>{ const u=sessionUser(req); if(!u){send(res,401,{error:"login required"});return null;}
    const rank={viewer:0,editor:1,admin:2}; if(rank[u.role]<rank[role]){send(res,403,{error:"permission denied"});return null;} return u; };
  // public
  if(url==="/api/login"&&method==="POST"){
    const b=JSON.parse(await parseBody(req,1024*100)||"{}");
    const u=DB.users.find(x=>x.user===b.user);
    if(!u||!checkPw(String(b.pass||""),u)){ await new Promise(r=>setTimeout(r,600)); send(res,401,{error:"गलत username/password"}); return; }
    const sid=crypto.randomBytes(24).toString("hex");
    DB.sessions[sid]={user:u.user,exp:Date.now()+30*864e5}; logAct(u.user,"login"); saveDB();
    res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":`sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`});
    res.end(JSON.stringify({ok:true,user:u.user,role:u.role,mustChange:!!u.mustChange})); return;
  }
  if(url==="/api/inbox"&&method==="POST"){ // public form submissions
    try{ const b=JSON.parse(await parseBody(req,1024*200)||"{}");
      DB.inbox.unshift({id:DB.seq++,t:Date.now(),type:b.type||"form",status:"new",data:b.data||{}}); saveDB(); pubInvalidate();
      try{ const _e=DB.inbox[0]; bg(()=>mirrorInboxEntry(_e)); }catch(e){ sbLog("inbox mirror trigger failed"); }
      send(res,200,{ok:true});
    }catch(e){ send(res,400,{error:"bad request"}); } return;
  }
  if(url==="/api/logout"&&method==="POST"){ const sid=cookies(req).sid; if(sid) delete DB.sessions[sid]; saveDB();
    res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":"sid=; HttpOnly; Path=/; Max-Age=0"}); res.end('{"ok":true}'); return; }
  if(url==="/api/me"){ const u=sessionUser(req); send(res,200,u?{user:u.user,role:u.role,mustChange:!!u.mustChange}:{user:null}); return; }

  if(url==="/api/public/content"){
    try{
      const b=await buildPublicBundle();
      const body=JSON.stringify(b);
      res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Content-Length":Buffer.byteLength(body),"Cache-Control":"public, max-age=60"});
      res.end(body);
    }catch(e){ try{ const fb=JSON.stringify({source:"local"}); res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Content-Length":Buffer.byteLength(fb),"Cache-Control":"no-store"}); res.end(fb); }catch(_){} }
    return;
  }

  const me=need("viewer"); if(!me) return;
  // ---- data ----
  if(url==="/api/data"){ send(res,200,{fields:DB.fields, globals:DB.settings.globals||{}, seo:DB.seo, lists:DB.lists, settings:{slideSecs:DB.settings.slideSecs,bank:DB.settings.bank||{},social:DB.settings.social||{}}, fieldDefs:FIELDS.map(f=>({id:f.id,page:f.page,section:f.section,file:f.file,label:f.label,type:f.type||"input",bare:bareTag(f.old),current:(DB.fields[f.id]!==undefined&&DB.fields[f.id]!=="")?DB.fields[f.id]:f.old})), globalDefs:GLOBALS}); return; }
  if(url==="/api/save"&&method==="POST"){ const ed=need("editor"); if(!ed) return;
    const b=JSON.parse(await parseBody(req,8*1024*1024)||"{}");
    if(b.kind==="field"){ DB.fields[b.id]=b.value; }
    else if(b.kind==="globals"){ DB.settings.globals=DB.settings.globals||{}; DB.settings.globals[b.id]=b.value; }
    else if(b.kind==="seo"){ DB.seo[b.id]=b.value; }
    else if(b.kind==="list"){ DB.lists[b.id]=b.value; }
    else if(b.kind==="bank"){ DB.settings.bank=b.value; }
    else if(b.kind==="social"){ DB.settings.social=b.value; }
    else if(b.kind==="slideSecs"){ DB.settings.slideSecs=+b.value||5; }
    logAct(me.user,"save "+b.kind+":"+(b.id||"")); saveDB(); pubInvalidate();
    try{
      if(b.kind==="field"){ bg(()=>mirrorSiteContent([[b.id,b.value]])); if(b.id==="mem_qr") bg(()=>mirrorBankSocial()); }
      else if(b.kind==="globals"){ bg(()=>mirrorSiteContent([["global:"+b.id,b.value]])); }
      else if(b.kind==="slideSecs"){ bg(()=>mirrorSiteContent([["global:slideSecs",String(DB.settings.slideSecs||5)]])); }
      else if(b.kind==="seo"&&b.value){ bg(()=>mirrorSiteContent([["seo:"+b.id+":title",b.value.title||""],["seo:"+b.id+":desc",b.value.desc||""]])); }
      else if(b.kind==="list"){ bg(()=>mirrorList(b.id)); }
      else if(b.kind==="bank"||b.kind==="social"){ bg(()=>mirrorBankSocial()); }
    }catch(e){ sbLog("mirror trigger failed"); }
    send(res,200,{ok:true}); return; }
  // ---- media ----
  if(url==="/api/media"){ send(res,200,{files:listMedia()}); return; }
  if(url==="/api/media-usage"){ const p=new URL(req.url,"http://x").searchParams.get("path"); send(res,200,{uses:mediaUsage(p)}); return; }
  if(url==="/api/upload"&&method==="POST"){ const ed=need("editor"); if(!ed) return;
    const b=JSON.parse(await parseBody(req));
    const m=String(b.data||"").match(/^data:(image\/(?:jpeg|png|webp|svg\+xml)|video\/mp4);base64,(.+)$/);
    if(!m){ send(res,400,{error:"sirf jpg/png/webp/svg/mp4"}); return; }
    const ext=m[1].includes("jpeg")?".jpg":m[1].includes("png")?".png":m[1].includes("webp")?".webp":m[1].includes("svg")?".svg":".mp4";
    if(m[1].startsWith("video")&&(b.folder||"")!=="video"){ send(res,400,{error:"video sirf video folder me"}); return; }
    let base=String(b.name||"file").replace(/\.[^.]+$/,"").normalize("NFKD").replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"-").toLowerCase().slice(0,60)||"file";
    const folder=String(b.folder||"misc").replace(/[^a-z]/g,"")||"misc";
    const dir=path.join(ROOT,"assets",folder); fs.mkdirSync(dir,{recursive:true});
    let name=base+ext,i=1; while(fs.existsSync(path.join(dir,name))) name=base+"-"+(i++)+ext;
    fs.writeFileSync(path.join(dir,name),Buffer.from(m[2],"base64"));
    logAct(me.user,"upload assets/"+folder+"/"+name); saveDB(); pubInvalidate();
    try{ bg(()=>mirrorUpload("assets/"+folder+"/"+name, me.user)); }catch(e){ sbLog("upload mirror trigger failed"); }
    send(res,200,{ok:true,path:"assets/"+folder+"/"+name}); return; }
  if(url==="/api/media-delete"&&method==="POST"){ const ed=need("editor"); if(!ed) return;
    const b=JSON.parse(await parseBody(req,1024*10)||"{}");
    const rel=String(b.path||"").replace(/\.\./g,"");
    if(!rel.startsWith("assets/")){ send(res,400,{error:"invalid"}); return; }
    const fp=path.join(ROOT,rel); if(fs.existsSync(fp)) fs.unlinkSync(fp);
    logAct(me.user,"delete "+rel); saveDB(); pubInvalidate();
    try{ bg(()=>mirrorDeleteMedia(rel)); }catch(e){ sbLog("delete mirror trigger failed"); }
    send(res,200,{ok:true}); return; }
  // ---- inbox ----
  if(url==="/api/inbox"){ send(res,200,{inbox:DB.inbox}); return; }
  if(url==="/api/inbox.csv"){ const rows=[["id","date","type","status","data"]];
    for(const i of DB.inbox) rows.push([i.id,new Date(i.t).toLocaleString("en-IN"),i.type,i.status,JSON.stringify(i.data)]);
    const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(",")).join("\n");
    res.writeHead(200,{"Content-Type":"text/csv","Content-Disposition":"attachment; filename=inbox.csv"}); res.end(csv); return; }
  if(url.startsWith("/api/inbox/")&&method==="PATCH"){ const ed=need("editor"); if(!ed) return;
    const id=+url.split("/")[3]; const b=JSON.parse(await parseBody(req,1024*10)||"{}");
    const it=DB.inbox.find(x=>x.id===id); if(it){ it.status=b.status||it.status; saveDB(); try{ bg(()=>mirrorInboxWrite(it,false)); }catch(e){} } send(res,200,{ok:true}); return; }
  if(url.startsWith("/api/inbox/")&&method==="DELETE"){ const ed=need("editor"); if(!ed) return;
    const id=+url.split("/")[3]; const gone=(DB.inbox.find(x=>x.id===id)||null); DB.inbox=DB.inbox.filter(x=>x.id!==id); saveDB();
    try{ if(gone) bg(()=>mirrorInboxWrite(gone,true)); }catch(e){} send(res,200,{ok:true}); return; }
  // ---- users ----
  if(url==="/api/users"){ const ad=need("admin"); if(!ad) return; send(res,200,{users:DB.users.map(u=>({user:u.user,role:u.role}))}); return; }
  if(url==="/api/user-save"&&method==="POST"){ const ad=need("admin"); if(!ad) return;
    const b=JSON.parse(await parseBody(req,1024*10)||"{}");
    let u=DB.users.find(x=>x.user===b.user);
    if(!u){ if(!b.pass){send(res,400,{error:"password required"});return;} u={user:b.user,role:b.role||"editor",mustChange:true,...hashPw(b.pass)}; DB.users.push(u); }
    else { u.role=b.role||u.role; if(b.pass){ Object.assign(u,hashPw(b.pass)); u.mustChange=true; } }
    logAct(me.user,"user "+b.user); saveDB(); send(res,200,{ok:true}); return; }
  if(url==="/api/user-delete"&&method==="POST"){ const ad=need("admin"); if(!ad) return;
    const b=JSON.parse(await parseBody(req,1024*10)||"{}");
    if(b.user===me.user){ send(res,400,{error:"khud ko delete nahi"}); return; }
    DB.users=DB.users.filter(x=>x.user!==b.user); saveDB(); send(res,200,{ok:true}); return; }
  if(url==="/api/password"&&method==="POST"){
    const b=JSON.parse(await parseBody(req,1024*10)||"{}");
    const u=DB.users.find(x=>x.user===me.user);
    if(!checkPw(String(b.old||""),u)){ send(res,401,{error:"purana password galat"}); return; }
    Object.assign(u,hashPw(String(b.new||"x"))); u.mustChange=false; logAct(me.user,"password changed"); saveDB(); send(res,200,{ok:true}); return; }
  // ---- publish / backups / preview ----
  if(url==="/api/publish"&&method==="POST"){ const ed=need("editor"); if(!ed) return;
    try{ const r=doPublish(); logAct(me.user,"PUBLISH "+r.changed.join(", ")); saveDB(); send(res,200,{ok:true,...r}); }
    catch(e){ send(res,500,{error:"publish failed: "+e.message}); } return; }
  if(url==="/api/backups"){ const ed=need("editor"); if(!ed) return;
    send(res,200,{backups:fs.existsSync(BACKUP_DIR)?fs.readdirSync(BACKUP_DIR).sort().reverse():[], activity:DB.activity.slice(0,50)}); return; }
  if(url==="/api/rollback"&&method==="POST"){ const ed=need("editor"); if(!ed) return;
    const b=JSON.parse(await parseBody(req,1024*10)||"{}");
    const bdir=path.join(BACKUP_DIR,path.basename(b.backup||""));
    if(!fs.existsSync(bdir)){ send(res,404,{error:"backup nahi mila"}); return; }
    for(const f of fs.readdirSync(bdir)){ const orig=f.replace(/\.bak$/,"").replace(/_/g,"/");
      const src=path.join(bdir,f), dst=path.join(ROOT,orig);
      if(fs.existsSync(dst)) fs.copyFileSync(src,dst); }
    logAct(me.user,"ROLLBACK "+b.backup); saveDB(); send(res,200,{ok:true}); return; }
  if(url.startsWith("/api/preview")){ const p=new URL(req.url,"http://x").searchParams.get("page")||"index.html";
    if(!HTML_FILES.includes(p)){ send(res,400,"bad page","text/plain"); return; }
    const warnings=[]; const {content}=transformFile(p,readF(p),warnings);
    send(res,200,content,"text/html"); return; }
  send(res,404,{error:"not found"});
}

/* ================= SERVER ================= */
loadDB();
http.createServer(async (req,res)=>{
  try{
    const url=req.url.split("?")[0];
    if(url==="/health"&&req.method==="GET"){
      const hbody='{"ok":true}';
      res.writeHead(200,{"Content-Type":"application/json","Content-Length":Buffer.byteLength(hbody),"Cache-Control":"no-store"});
      res.end(hbody); return;
    }
    if(url==="/admin"||url==="/admin/"){ res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}); res.end(fs.readFileSync(path.join(ADMIN_DIR,"panel.html"))); return; }
    if(url.startsWith("/api/")){ await api(req,res,url); return; }
    if(req.method!=="GET"){ send(res,405,"Method not allowed","text/plain"); return; }
    serveStatic(req,res,url);
  }catch(e){ try{send(res,500,"Server error","text/plain");}catch(_){} }
}).listen(PORT,()=>console.log(`JSP site  : http://localhost:${PORT}\nJSP admin : http://localhost:${PORT}/admin  (admin / admin123)`));
