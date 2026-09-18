// जर्नलिस्ट सेवा परिषद — Admin Panel Backend (zero-dependency, Node builtins only)
// Run: node admin/server.js  →  site: http://localhost:8010  admin: http://localhost:8010/admin
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 8010;
const ROOT = path.resolve(__dirname, "..");
const ADMIN_DIR = __dirname;
const DB_FILE = path.join(ADMIN_DIR, "data.json");
const BACKUP_DIR = path.join(ADMIN_DIR, "backups");
const HTML_FILES = ["index.html","about.html","journalist-welfare.html","membership.html","activities.html","news.html","gallery.html","contact.html","privacy-policy.html","terms.html"];
const MAIN_JS = "js/main.js";

/* ================= DB ================= */
function defaultDB(){ return {users:[], sessions:{}, fields:{}, published:{}, gpub:{}, seo:{}, lists:{leaders:[],news:[],activities:[],gallery:[],newsCats:[],actCats:[],galCats:[],ads:[]}, settings:{slideSecs:5}, inbox:[], activity:[], seq:1}; }
let DB;
function loadDB(){
  try{ DB = JSON.parse(fs.readFileSync(DB_FILE,"utf8")); }
  catch(e){ DB = defaultDB(); seedDB(); saveDB(); }
  if(!DB.users.length){ DB.users.push({user:"admin", role:"admin", mustChange:true, ...hashPw("admin123")}); saveDB(); }
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
 {id:"home_hero_h1", page:"Home", section:"Hero", file:"index.html", label:"Hero headline (HTML)", type:"textarea", old:"<h1>पत्रकारों की <em>एकता, सम्मान</em> और अधिकारों के लिए समर्पित</h1>"},
 {id:"home_hero_sub", page:"Home", section:"Hero", file:"index.html", label:"Hero sub-text", type:"textarea", old:'<p class="sub">जर्नलिस्ट सेवा परिषद पत्रकारों के हितों, अधिकारों, सम्मान और कल्याण के लिए कार्य करने वाला राष्ट्रीय संगठन है।</p>'},
 {id:"home_vid_h2", page:"Home", section:"Video", file:"index.html", label:"Video heading", old:"<h2>संगठन वीडियो</h2>"},
 {id:"home_trust1", page:"Home", section:"Trust strip", file:"index.html", label:"Trust cell 1 (HTML)", type:"textarea", old:"<b>राष्ट्रीय संगठन</b><p>पत्रकारों के हित में कार्यरत</p>"},
 {id:"home_trust2", page:"Home", section:"Trust strip", file:"index.html", label:"Trust cell 2 (HTML)", type:"textarea", old:"<b>पत्रकार हित</b><p>अधिकार एवं कल्याण के लिए प्रयास</p>"},
 {id:"home_trust3", page:"Home", section:"Trust strip", file:"index.html", label:"Trust cell 3 (HTML)", type:"textarea", old:"<b>संगठनात्मक एकता</b><p>पत्रकारों को एक मंच से जोड़ने का प्रयास</p>"},
 {id:"home_trust4", page:"Home", section:"Trust strip", file:"index.html", label:"Trust cell 4 (HTML)", type:"textarea", old:"<b>सशक्त आवाज़</b><p>पत्रकारों के मुद्दों को प्रमुखता देने का प्रयास</p>"},
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
 {id:"con_map_note", page:"Contact", section:"Maps", file:"contact.html", label:"Map note", type:"textarea", old:'<p class="hint" style="margin-top:10px">नोट: सटीक GPS निर्देशांक सत्यापित न होने के कारण पते पर आधारित Google Maps खोज/एम्बेड दिखाया गया है.'},
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
  // ads from main.js
  const js = readF(MAIN_JS);
  const mAds = js.match(/const ADS = (\[[\s\S]*?\n  \]);/);
  try{ L.ads = (new Function("return "+mAds[1]))(); }catch(e){ L.ads=[]; }
  // seo seed
  DB.seo = {};
  for(const f of HTML_FILES){
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
function chipsHTML(cats, attr){
  return `<button class="chip active" data-${attr}="all">सभी</button>` + cats.map(c=>`\n<button class="chip" data-${attr}="${c.value}">${c.label}</button>`).join("");
}
const qjs = s=>'"'+String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"';
function adsJS(ads){
  return "const ADS = [\n" + ads.map(a=>`    {label:${qjs(a.label)}, title:${qjs(a.title)}, text:${qjs(a.text)}, cta:${qjs(a.cta)}, href:${qjs(a.href)}, theme:${qjs(a.theme)}}`).join(",\n") + "\n  ];";
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
  for(const f of [...HTML_FILES, MAIN_JS]){
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
      DB.inbox.unshift({id:DB.seq++,t:Date.now(),type:b.type||"form",status:"new",data:b.data||{}}); saveDB();
      send(res,200,{ok:true});
    }catch(e){ send(res,400,{error:"bad request"}); } return;
  }
  if(url==="/api/logout"&&method==="POST"){ const sid=cookies(req).sid; if(sid) delete DB.sessions[sid]; saveDB();
    res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":"sid=; HttpOnly; Path=/; Max-Age=0"}); res.end('{"ok":true}'); return; }
  if(url==="/api/me"){ const u=sessionUser(req); send(res,200,u?{user:u.user,role:u.role,mustChange:!!u.mustChange}:{user:null}); return; }

  const me=need("viewer"); if(!me) return;
  // ---- data ----
  if(url==="/api/data"){ send(res,200,{fields:DB.fields, globals:DB.settings.globals||{}, seo:DB.seo, lists:DB.lists, settings:{slideSecs:DB.settings.slideSecs}, fieldDefs:FIELDS.map(f=>({id:f.id,page:f.page,section:f.section,file:f.file,label:f.label,type:f.type||"input",current:(DB.fields[f.id]!==undefined&&DB.fields[f.id]!=="")?DB.fields[f.id]:f.old})), globalDefs:GLOBALS}); return; }
  if(url==="/api/save"&&method==="POST"){ const ed=need("editor"); if(!ed) return;
    const b=JSON.parse(await parseBody(req,8*1024*1024)||"{}");
    if(b.kind==="field"){ DB.fields[b.id]=b.value; }
    else if(b.kind==="globals"){ DB.settings.globals=DB.settings.globals||{}; DB.settings.globals[b.id]=b.value; }
    else if(b.kind==="seo"){ DB.seo[b.id]=b.value; }
    else if(b.kind==="list"){ DB.lists[b.id]=b.value; }
    else if(b.kind==="slideSecs"){ DB.settings.slideSecs=+b.value||5; }
    logAct(me.user,"save "+b.kind+":"+(b.id||"")); saveDB(); send(res,200,{ok:true}); return; }
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
    logAct(me.user,"upload assets/"+folder+"/"+name); saveDB(); send(res,200,{ok:true,path:"assets/"+folder+"/"+name}); return; }
  if(url==="/api/media-delete"&&method==="POST"){ const ed=need("editor"); if(!ed) return;
    const b=JSON.parse(await parseBody(req,1024*10)||"{}");
    const rel=String(b.path||"").replace(/\.\./g,"");
    if(!rel.startsWith("assets/")){ send(res,400,{error:"invalid"}); return; }
    const fp=path.join(ROOT,rel); if(fs.existsSync(fp)) fs.unlinkSync(fp);
    logAct(me.user,"delete "+rel); saveDB(); send(res,200,{ok:true}); return; }
  // ---- inbox ----
  if(url==="/api/inbox"){ send(res,200,{inbox:DB.inbox}); return; }
  if(url==="/api/inbox.csv"){ const rows=[["id","date","type","status","data"]];
    for(const i of DB.inbox) rows.push([i.id,new Date(i.t).toLocaleString("en-IN"),i.type,i.status,JSON.stringify(i.data)]);
    const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(",")).join("\n");
    res.writeHead(200,{"Content-Type":"text/csv","Content-Disposition":"attachment; filename=inbox.csv"}); res.end(csv); return; }
  if(url.startsWith("/api/inbox/")&&method==="PATCH"){ const ed=need("editor"); if(!ed) return;
    const id=+url.split("/")[3]; const b=JSON.parse(await parseBody(req,1024*10)||"{}");
    const it=DB.inbox.find(x=>x.id===id); if(it){ it.status=b.status||it.status; saveDB(); } send(res,200,{ok:true}); return; }
  if(url.startsWith("/api/inbox/")&&method==="DELETE"){ const ed=need("editor"); if(!ed) return;
    const id=+url.split("/")[3]; DB.inbox=DB.inbox.filter(x=>x.id!==id); saveDB(); send(res,200,{ok:true}); return; }
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
    if(url==="/admin"||url==="/admin/"){ res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}); res.end(fs.readFileSync(path.join(ADMIN_DIR,"panel.html"))); return; }
    if(url.startsWith("/api/")){ await api(req,res,url); return; }
    if(req.method!=="GET"){ send(res,405,"Method not allowed","text/plain"); return; }
    serveStatic(req,res,url);
  }catch(e){ try{send(res,500,"Server error","text/plain");}catch(_){} }
}).listen(PORT,()=>console.log(`JSP site  : http://localhost:${PORT}\nJSP admin : http://localhost:${PORT}/admin  (admin / admin123)`));
