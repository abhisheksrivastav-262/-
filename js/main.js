// जर्नलिस्ट सेवा परिषद — shared interactions
(function(){
  const WHATSAPP_NUMBER = "918318168274";
  const $ = (s,c=document)=>c.querySelector(s);
  const $$ = (s,c=document)=>Array.from(c.querySelectorAll(s));

  // Sticky active nav
  const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  $$(".nav a, .mobile-menu a.mlink, footer a").forEach(a=>{
    const href=(a.getAttribute("href")||"").toLowerCase();
    if(href===path || (path===""&&href==="index.html") || (path==="index.html"&&href==="./")) a.classList.add("active");
  });

  // Mobile menu (top dropdown)
  const btn = $("#menuBtn"), menu = $("#mobileMenu");
  if(btn&&menu){
    btn.addEventListener("click",()=>{
      const open = menu.classList.toggle("open");
      btn.textContent = open ? "✕" : "☰";
      btn.setAttribute("aria-expanded", open ? "true":"false");
    });
    menu.addEventListener("click",e=>{ if(e.target.closest("a")){ menu.classList.remove("open"); btn.textContent="☰"; }});
    // Scroll करते ही खुला मेन्यू बंद करें (mobile UX)
    window.addEventListener("scroll",()=>{
      if(menu.classList.contains("open")){ menu.classList.remove("open"); btn.textContent="☰"; btn.setAttribute("aria-expanded","false"); }
    },{passive:true});
  }

  // Scroll reveal
  const io = new IntersectionObserver(entries=>{
    entries.forEach(en=>{ if(en.isIntersecting){ en.target.classList.add("visible"); io.unobserve(en.target);} });
  },{threshold:.12});
  $$(".reveal").forEach(el=>io.observe(el));

  // Footer year
  $$("[data-year]").forEach(el=>el.textContent=new Date().getFullYear());

  // ---- WhatsApp helpers ----
  function openWhatsApp(text){
    const url = "https://wa.me/"+WHATSAPP_NUMBER+"?text="+encodeURIComponent(text);
    window.open(url,"_blank","noopener");
  }
  // Admin inbox copy (silent — fails quietly on static hosting)
  function saveInbox(type, data){
    try{
      fetch("/api/inbox",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:type,data:data})}).catch(()=>{});
    }catch(e){}
  }

  // Membership form (+ Donate option)
  const mform = $("#membershipForm");
  if(mform){
    mform.addEventListener("submit",e=>{
      e.preventDefault();
      const fd = new FormData(mform);
      const v = k=>String(fd.get(k)||"").trim();
      const mobile = v("mobile").replace(/\D/g,"");
      if(!v("name")||mobile.length<10){ alert("कृपया सही नाम और 10 अंकों का मोबाइल नंबर भरें।"); return; }
      const purpose = v("purpose") || "सदस्यता आवेदन";
      const isDonate = purpose.indexOf("दान") === 0;
      if(isDonate && !(Number(v("amount"))>0)){ alert("कृपया दान की राशि (₹) भरें।"); return; }
      const lines = [
        isDonate ? "नमस्ते, मैं जर्नलिस्ट सेवा परिषद को सहयोग (दान) देना चाहता/चाहती हूँ। मैंने नीचे दिए QR पर भुगतान कर दिया है।"
                 : "नमस्ते, मुझे जर्नलिस्ट सेवा परिषद की सदस्यता के लिए आवेदन करना है।",
        "———————————",
        "उद्देश्य: " + purpose,
        "पूरा नाम: "+v("name"),
        "मोबाइल नंबर: "+v("mobile"),
        "ईमेल: "+(v("email")||"-"),
        "शहर: "+(v("city")||"-"),
        "जिला: "+(v("district")||"-"),
        "राज्य: "+(v("state")||"-"),
        "मीडिया संस्थान: "+(v("org")||"-"),
        "पद / भूमिका: "+(v("role")||"-"),
        "पत्रकारिता अनुभव: "+(v("exp")||"-"),
        "संदेश: "+(v("message")||"-"),
        ...(isDonate ? ["दान राशि: ₹" + v("amount"), "UTR/रेफरेंस: " + (v("utr") || "-")] : []),
        "———————————",
        isDonate ? "कृपया भुगतान की पुष्टि करें।" : "कृपया सदस्यता प्रक्रिया की जानकारी दें।"
      ];
      $("#formStatus") && ($("#formStatus").textContent = "WhatsApp खुल रहा है… कृपया Send दबाकर आवेदन भेजें।");
      saveInbox(isDonate?"donate":"membership",{purpose:purpose,name:v("name"),mobile:v("mobile"),email:v("email"),city:v("city"),district:v("district"),state:v("state"),org:v("org"),role:v("role"),exp:v("exp"),message:v("message"),amount:v("amount"),utr:v("utr")});
      openWhatsApp(lines.join("\n"));
    });
    // Donate box toggle + #donate preselect + submit text swap
    const donateBox = $("#donateBox");
    const submitBtn = mform.querySelector('button[type="submit"]');
    const syncPurpose = ()=>{
      const sel = mform.querySelector('input[name="purpose"]:checked');
      const isDon = sel && sel.value.indexOf("दान")===0;
      if(donateBox) donateBox.hidden = !isDon;
      if(submitBtn) submitBtn.textContent = isDon ? "दान की जानकारी भेजें →" : "सदस्यता के लिए आवेदन करें →";
    };
    $$('input[name="purpose"]', mform).forEach(r=>r.addEventListener("change",syncPurpose));
    if(location.hash === "#donate"){
      const d = mform.querySelector('input[name="purpose"][value^="दान"]');
      if(d) d.checked = true;
    }
    syncPurpose();
  }

  // Contact form
  const cform = $("#contactForm");
  if(cform){
    cform.addEventListener("submit",e=>{
      e.preventDefault();
      const fd = new FormData(cform);
      const v = k=>String(fd.get(k)||"").trim();
      if(!v("name")||!v("mobile")){ alert("कृपया नाम और मोबाइल नंबर भरें।"); return; }
      const lines = [
        "नमस्ते, जर्नलिस्ट सेवा परिषद से संपर्क करना है।",
        "———————————",
        "नाम: "+v("name"),
        "मोबाइल: "+v("mobile"),
        "ईमेल: "+(v("email")||"-"),
        "विषय: "+(v("subject")||"-"),
        "संदेश: "+(v("message")||"-")
      ];
      $("#cStatus") && ($("#cStatus").textContent="WhatsApp खुल रहा है… कृपया Send दबाकर संदेश भेजें।");
      saveInbox("contact",{name:v("name"),mobile:v("mobile"),email:v("email"),subject:v("subject"),message:v("message")});
      openWhatsApp(lines.join("\n"));
    });
  }

  // ---------- Advertisements (DEMO placeholders — CMS/असली विज्ञापन से बदलें) ----------
  const ADS = [
    {label:"विज्ञापन", title:"आपका विज्ञापन यहाँ", text:"इस प्रीमियम स्थान पर अपना विज्ञापन दिखाएं। संपर्क करें — 8318168274", cta:"संपर्क करें →", href:"tel:8318168274", theme:"house"},
    {label:"विज्ञापन • Demo", title:"Demo विज्ञापन", text:"यह उदाहरण स्लाइड है — असली विज्ञापनदाता मिलते ही बदल दी जाएगी।", cta:"Demo", href:"contact.html", theme:"t1"},
    {label:"विज्ञापन • Demo", title:"Demo विज्ञापन", text:"यह उदाहरण स्लाइड है — असली विज्ञापनदाता मिलते ही बदल दी जाएगी।", cta:"Demo", href:"contact.html", theme:"t2"}
  ];
  function adSlideHTML(a){
    return '<span class="ad-tag">'+a.label+'</span>'
      + (a.img?'<img class="ad-photo" src="'+a.img+'" alt="'+a.title+'">':"")
      + '<div><h3>'+a.title+'</h3><p>'+a.text+'</p>'
      + '<a class="btn btn-gold btn-sm" href="'+a.href+'">'+a.cta+'</a></div>';
  }
  function buildSlider(afterEl){
    const sec = document.createElement("section");
    sec.className = "ad-section";
    sec.setAttribute("aria-label","विज्ञापन");
    sec.innerHTML = '<div class="container"><div class="ad-slider"><div class="ad-track">'
      + (window.__ADS||ADS).map(a=>'<div class="ad-slide theme-'+a.theme+'">'+adSlideHTML(a)+'</div>').join("")
      + '</div><button class="ad-nav prev" aria-label="पिछला विज्ञापन">‹</button>'
      + '<button class="ad-nav next" aria-label="अगला विज्ञापन">›</button><div class="ad-dots">'
      + (window.__ADS||ADS).map((_,i)=>'<button aria-label="विज्ञापन '+(i+1)+'"></button>').join("")
      + '</div></div></div>';
    afterEl.after(sec);
    const track = sec.querySelector(".ad-track");
    const dots = Array.from(sec.querySelectorAll(".ad-dots button"));
    let idx = 0, timer = null;
    const go = i=>{ const L=(window.__ADS||ADS); idx=(i+L.length)%L.length; track.style.transform="translateX(-"+(idx*100)+"%)"; dots.forEach((d,k)=>d.classList.toggle("active",k===idx)); };
    const play = ()=>{ stop(); timer=setInterval(()=>go(idx+1),5000); };
    const stop = ()=>{ if(timer){clearInterval(timer); timer=null;} };
    sec.querySelector(".prev").addEventListener("click",()=>{go(idx-1);play();});
    sec.querySelector(".next").addEventListener("click",()=>{go(idx+1);play();});
    dots.forEach((d,k)=>d.addEventListener("click",()=>{go(k);play();}));
    const slider = sec.querySelector(".ad-slider");
    slider.addEventListener("pointerenter",stop);
    slider.addEventListener("pointerleave",play);
    go(0); play();
  }
  function buildStrip(afterEl){
    const wrap = document.createElement("div");
    wrap.className = "container";
    wrap.innerHTML = '<div class="ad-strip" aria-label="विज्ञापन"><a href="#" id="adStripLink"><span class="ad-tag">विज्ञापन</span><span id="adStripText"></span></a></div>';
    afterEl.after(wrap);
    const link = wrap.querySelector("#adStripLink"), txt = wrap.querySelector("#adStripText");
    let i = 0;
    const show = ()=>{ const L=(window.__ADS||ADS); const a=L[i%L.length]; link.href=a.href; txt.textContent=a.title+" — "+a.text; i++; };
    show(); setInterval(show,5000);
  }
  function buildVideoAd(beforeEl){
    const sec = document.createElement("section");
    sec.className = "video-ad-sec";
    sec.setAttribute("aria-label","वीडियो विज्ञापन");
    sec.innerHTML = '<div class="container"><div class="center reveal visible"><span class="eyebrow">वीडियो</span><h2>वीडियो विज्ञापन</h2></div>'
      + '<div class="video-ad"><span class="ad-tag">विज्ञापन • Demo</span>'
      + '<video controls preload="none" poster="https://images.unsplash.com/photo-1485846234645-a62644f84728?w=1000&q=80&auto=format&fit=crop">'
      + '<source src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" type="video/mp4">'
      + 'आपका ब्राउज़र वीडियो नहीं चला सकता।</video>'
      + '<p class="hint">Demo वीडियो विज्ञापन — ग्राहक का असली प्रचार वीडियो मिलते ही बदला जाएगा (CMS editable)।</p></div></div>';
    beforeEl.before(sec);
  }
  const isHome = (path === "index.html");
  const trustEl = document.querySelector(".trust");
  // Home पर prime spot (hero के नीचे) अब असली संगठन वीडियो का है — demo ad slider नहीं दिखेगा
  void trustEl;
  const footerEl = document.querySelector("footer");
  if(isHome && footerEl) buildVideoAd(footerEl);
  const pageHero = document.querySelector(".page-hero");
  if(pageHero && !isHome && !document.querySelector(".ad-strip")) buildStrip(pageHero);

  // News filter + search
  const chips = $$(".chip[data-filter]");
  const cards = $$("[data-category]");
  const search = $("#newsSearch");
  function applyNews(){
    const active = ($(".chip.active")||{}).dataset?.filter || "all";
    const q = (search?.value||"").toLowerCase().trim();
    cards.forEach(c=>{
      const okCat = active==="all" || c.dataset.category===active;
      const okQ = !q || c.textContent.toLowerCase().includes(q);
      c.style.display = (okCat&&okQ) ? "" : "none";
    });
  }
  chips.forEach(ch=>ch.addEventListener("click",()=>{chips.forEach(x=>x.classList.remove("active"));ch.classList.add("active");applyNews();}));
  search?.addEventListener("input",applyNews);

  // Gallery filter + lightbox
  const gchips = $$(".chip[data-gfilter]");
  const gitems = $$(".g-item");
  gchips.forEach(ch=>ch.addEventListener("click",()=>{
    gchips.forEach(x=>x.classList.remove("active"));ch.classList.add("active");
    const f = ch.dataset.gfilter;
    gitems.forEach(g=>{ g.style.display = (f==="all"||g.dataset.gcat===f)?"":"none"; });
  }));
  const lb = $("#lightbox"), lbImg = $("#lightboxImg");
  // delegated — works for dynamically added gallery items too
  document.addEventListener("click",e=>{
    const g=e.target.closest?e.target.closest(".g-item"):null;
    if(!g||!lb||!lbImg) return;
    const im = g.querySelector("img");
    if(im){ lbImg.src=im.src; lbImg.alt=im.alt; lb.classList.add("open"); document.body.style.overflow="hidden"; }
  });
  lb?.addEventListener("click",()=>{ lb.classList.remove("open"); document.body.style.overflow=""; });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"){ lb?.classList.remove("open"); document.body.style.overflow=""; menu?.classList.remove("open"); }});

  // Share buttons (delegated — works for dynamically added cards too)
  document.addEventListener("click",e=>{
    const a=e.target.closest?e.target.closest("[data-share]"):null;
    if(!a) return;
    e.preventDefault();
    const type=a.dataset.share, title=encodeURIComponent(a.dataset.title||document.title), url=encodeURIComponent(location.href);
    let u = type==="x" ? `https://twitter.com/intent/tweet?text=${title}&url=${url}`
      : type==="fb" ? `https://www.facebook.com/sharer/sharer.php?u=${url}`
      : `https://wa.me/?text=${title}%20${url}`;
    window.open(u,"_blank","noopener,width=640,height=560");
  });

  // ---------- Dynamic content from Supabase (same-origin API; local fallback = do nothing) ----------
  function dynTail(s){ try{ const u=String(s||""); const i=u.lastIndexOf("/"); return i>=0?u.slice(i+1):u; }catch(e){ return ""; } }
  function dynObserve(root){ try{ (root||document).querySelectorAll(".reveal:not(.visible)").forEach(el=>{ try{io.observe(el);}catch(e){ el.classList.add("visible"); } }); }catch(e){} }
  function fillMarker(name, html){
    try{
      const it=document.createNodeIterator(document.body, NodeFilter.SHOW_COMMENT);
      let n;
      while((n=it.nextNode())){
        if((n.nodeValue||"").trim()!==name) continue;
        let s=n.nextSibling; const rm=[];
        while(s && !(s.nodeType===8 && (s.nodeValue||"").trim()==="/"+name)){ rm.push(s); s=s.nextSibling; }
        if(!s) continue;
        const tmp=document.createElement("div"); tmp.innerHTML=html;
        const frag=document.createDocumentFragment();
        while(tmp.firstChild) frag.appendChild(tmp.firstChild);
        n.parentNode.insertBefore(frag, s);
        rm.forEach(x=>{ if(x.parentNode) x.parentNode.removeChild(x); });
      }
    }catch(e){}
  }
  function dynFigure(l){
    return '<figure class="leader-card reveal"><img loading="lazy" width="480" height="544" src="'+l.img+'" alt="'+l.alt+'"><figcaption>'+l.cap+'</figcaption></figure>';
  }
  function dynFixLeaders(grid){
    grid.querySelectorAll("figure.leader-card img").forEach(im=>{
      const go=()=>{ try{ if(im.naturalWidth>im.naturalHeight){ const f=im.closest("figure"); if(f&&!f.classList.contains("leader-card--full")){ f.classList.add("leader-card--full"); im.setAttribute("width","480"); im.setAttribute("height","360"); } } }catch(e){} };
      if(im.complete&&im.naturalWidth) go(); else im.addEventListener("load",go);
    });
  }
  function dynNewsCard(n){
    const t=n.share||n.title;
    return '<article class="news-card reveal" data-category="'+n.cat+'"><img loading="lazy" width="600" height="400" src="'+n.img+'" alt="'+(n.alt||n.title)+'"><div class="news-body"><span class="tag">'+n.tag+'</span><p class="meta">'+n.date+'</p><h3>'+n.title+'</h3><p>'+n.desc+'</p><div class="share-row"><a href="#" data-share="wa" data-title="'+t+'">WhatsApp</a><a href="#" data-share="x" data-title="'+t+'">X</a><a href="#" data-share="fb" data-title="'+t+'">Facebook</a></div></div></article>';
  }
  function dynActCard(a){
    return '<article class="t-item reveal" data-category="'+a.cat+'">'+(a.img?'<img class="t-thumb" loading="lazy" src="'+a.img+'" alt="'+a.title+'">':"")+'<div class="t-date"><b>'+a.date+'</b><span>'+a.place+'</span></div><div><span class="tag">'+a.tag+'</span><h3 style="color:var(--navy)">'+a.title+'</h3><p class="meta">'+a.meta+'</p><p>'+a.desc+'</p></div></article>';
  }
  function dynGalFig(g){
    return '<figure class="g-item reveal" data-gcat="'+g.cat+'"><img loading="lazy" width="600" height="420" src="'+g.img+'" alt="'+(g.alt||g.cap)+'"><figcaption>'+g.cap+'</figcaption></figure>';
  }
  function dynChips(cats, attr){
    return '<button class="chip active" data-'+attr+'="all">सभी</button>' + (cats||[]).map(c=>'\n<button class="chip" data-'+attr+'="'+c.value+'">'+c.label+'</button>').join("");
  }
  function dynBindChips(bar, cardSel, dataKey, applyExtra){
    bar.querySelectorAll(".chip").forEach(ch=>ch.addEventListener("click",()=>{
      bar.querySelectorAll(".chip").forEach(x=>x.classList.remove("active")); ch.classList.add("active");
      const f=ch.dataset[dataKey];
      document.querySelectorAll(cardSel).forEach(c=>{ const v=c.dataset[dataKey==="gfilter"?"gcat":"category"]; c.style.display=(f==="all"||v===f)?"":"none"; });
      if(applyExtra){ try{applyExtra();}catch(e){} }
    }));
  }
  function dynRebuildChips(cats, attr, cardSel, dataKey, applyExtra){
    const bar=document.querySelector(".toolbar");
    if(!bar) return;
    const sb=bar.querySelector(".searchbar");
    bar.innerHTML=dynChips(cats, attr);
    if(sb) bar.appendChild(sb);
    dynBindChips(bar, cardSel, dataKey, applyExtra);
  }
  function dynLeaders(L){
    if(!L||!L.changed||!L.items||!L.items.length) return;
    $$(".grid-leaders").forEach(grid=>{
      const cur=[...grid.querySelectorAll("figure")].map(f=>{ const im=f.querySelector("img"); return dynTail(im?im.getAttribute("src"):""); }).join(";;");
      const nw=L.items.map(x=>dynTail(x.img)).join(";;");
      if(cur&&cur===nw) return;
      grid.innerHTML=L.items.map(dynFigure).join("");
      dynFixLeaders(grid); dynObserve(grid);
    });
  }
  function dynWelfare(W){
    if(!W||!W.changed||!W.items||!W.items.length) return;
    if(path!=="index.html") return;
    let sec=null;
    $$("section h2").forEach(h=>{ if(h.textContent.trim()==="पत्रकार हित एवं कल्याण") sec=h.closest("section"); });
    if(!sec) return;
    const cards=sec.querySelectorAll(".grid-3 .card");
    if(cards.length!==W.items.length) return;
    W.items.forEach((w,i)=>{ const h=cards[i].querySelector("h3"), p=cards[i].querySelector("p"); if(h) h.textContent=w.title; if(p) p.textContent=w.body; });
  }
  function dynNews(N){
    if(!N||!N.changed||!N.items||!N.items.length) return;
    if(path!=="news.html") return;
    const grid=$(".news-grid"); if(!grid) return;
    const cur=[...grid.querySelectorAll("article")].map(a=>dynTail((a.querySelector("img")||{}).getAttribute? (a.querySelector("img").getAttribute("src")||""):"")+"|"+((a.querySelector("h3")||{}).textContent||"")).join(";;");
    if(cur===N.items.map(x=>dynTail(x.img)+"|"+x.title).join(";;")) return;
    grid.innerHTML=N.items.map(dynNewsCard).join("");
    dynRebuildChips(N.cats||[],"filter",".news-card","filter",applyNews);
    try{applyNews();}catch(e){}
    dynObserve(grid);
  }
  function dynActs(A){
    if(!A||!A.changed||!A.items||!A.items.length) return;
    if(path!=="activities.html") return;
    const tl=document.querySelector(".timeline"); if(!tl) return;
    const metaByTitle={};
    tl.querySelectorAll("article").forEach(a=>{ const h=a.querySelector("h3"); const m=a.querySelector("p.meta"); if(h) metaByTitle[h.textContent.trim()]=m?m.textContent:""; });
    const cur=[...tl.querySelectorAll("article")].map(a=>((a.querySelector("h3")||{}).textContent||"")).join(";;");
    if(cur===A.items.map(x=>x.title).join(";;")) return;
    tl.innerHTML=A.items.map(a=>{ const c=Object.assign({},a); if(!c.meta&&metaByTitle[c.title]) c.meta=metaByTitle[c.title]; return dynActCard(c); }).join("");
    dynRebuildChips(A.cats||[],"filter",".t-item","filter",null);
    dynObserve(tl);
  }
  function dynGallery(G){
    if(!G||!G.changed||!G.items||!G.items.length) return;
    if(path!=="gallery.html") return;
    const grid=document.querySelector(".g-grid"); if(!grid) return;
    const clsByTail={};
    grid.querySelectorAll("figure").forEach(f=>{ const im=f.querySelector("img"); if(im) clsByTail[dynTail(im.getAttribute("src"))]=f.getAttribute("class")||""; });
    const cur=Object.keys(clsByTail).join(";;");
    if(cur===G.items.map(x=>dynTail(x.img)).join(";;")) return;
    grid.innerHTML=G.items.map(g=>{ let h=dynGalFig(g); const t=dynTail(g.img); if(clsByTail[t]&&clsByTail[t].indexOf("g-item--tall")>=0) h=h.replace('class="g-item reveal"','class="g-item g-item--tall reveal"'); return h; }).join("");
    dynRebuildChips(G.cats||[],"gfilter",".g-item","gfilter",null);
    dynObserve(grid);
  }
  function dynObjectives(O){
    if(!O||!O.changed||!O.items||!O.items.length) return;
    if(path!=="index.html"&&path!=="about.html") return;
    $$(".check-list").forEach(ul=>{ ul.innerHTML=O.items.map(t=>"<li>"+t.text+"</li>").join(""); });
  }
  function dynNotices(N){
    if(!N||!N.changed||!N.items||!N.items.length) return;
    if(path!=="activities.html") return;
    const kindName={event:"📅 आगामी कार्यक्रम",achieve:"🏆 उपलब्धि",convention:"🎪 अधिवेशन"};
    fillMarker("NOTICES", N.items.map(n=>'<article class="t-item reveal"><div class="t-date"><b>'+(n.date||"")+'</b><span>'+(n.place||"")+'</span></div><div><span class="tag">'+(kindName[n.kind]||n.kind||"📢 सूचना")+'</span><h3 style="color:var(--navy)">'+n.title+'</h3><p>'+(n.desc||"")+'</p></div></article>').join("\n"));
    dynObserve(document.querySelector(".timeline"));
  }
  function dynConsumer(C){
    if(!C||!C.changed||!C.items||!C.items.length) return;
    if(path!=="consumer.html") return;
    fillMarker("CONSUMER-LIST", '<div class="grid-3" style="margin-top:26px">\n'+C.items.map(c=>'<div class="card reveal visible"><div class="icon">📢</div><h3>'+c.title+'</h3>'+(c.date?'<p class="meta">'+c.date+'</p>':"")+'<p>'+(c.desc||"")+'</p></div>').join("\n")+'\n</div>');
  }
  function dynDonors(D){
    if(!D||!D.changed||!D.items||!D.items.length) return;
    if(path!=="membership.html") return;
    fillMarker("DONORS-WALL", '<div class="grid-3" style="margin-top:26px">\n'+D.items.map(d=>'<div class="card reveal visible"><div class="icon">❤️</div><h3>'+d.name+'</h3><p>'+(d.amount?("₹"+d.amount):"")+((d.amount&&d.note)?" • ":"")+(d.note||"")+'</p>'+(d.date?'<p class="meta">'+d.date+'</p>':"")+'</div>').join("\n")+'\n</div>');
  }
  function dynAds(A){
    if(!A||!A.changed||!A.items||!A.items.length) return;
    window.__ADS=A.items;
    document.querySelectorAll(".ad-section,.ad-strip").forEach(e=>{ if(e.parentNode) e.parentNode.removeChild(e); });
    if(pageHero&&!isHome&&!document.querySelector(".ad-strip")) buildStrip(pageHero);
  }
  function dynDonation(D){
    if(!D) return;
    if(D.qr){
      const im=document.querySelector("#donateBox img");
      if(im && dynTail(im.getAttribute("src"))!==dynTail(D.qr)) im.src=D.qr;
    }
    const b=D.bank||{};
    if(b.bankName||b.accNo||b.ifsc||b.holder||b.upiId){
      const box=document.querySelector("#donateBox");
      if(box){
        const ph=[...box.querySelectorAll("p.hint")].find(p=>p.textContent.includes("बैंक विवरण जल्द"));
        if(ph){
          const rows=[];
          if(b.bankName||b.accNo||b.ifsc||b.holder) rows.push('<div class="info-row" style="background:#fff">🏦 <b>बैंक खाता:</b><br>'+[b.bankName&&("बैंक: "+b.bankName),b.accNo&&("खाता नं: "+b.accNo),b.ifsc&&("IFSC: "+b.ifsc),b.holder&&("धारक: "+b.holder)].filter(Boolean).join("<br>")+'</div>');
          if(b.upiId) rows.push('<div class="info-row" style="background:#fff">📱 <b>UPI ID:</b> '+b.upiId+'</div>');
          if(rows.length){ const tmp=document.createElement("div"); tmp.innerHTML=rows.join("\n"); ph.replaceWith(...tmp.childNodes); }
        }
      }
    }
  }
  function dynSocial(S){
    if(!S||!S.changed) return;
    const links=S.links||{};
    const icons={fb:"f",ig:"ig",x:"x",yt:"▶",wa:"💬"};
    const live=Object.keys(icons).filter(k=>links[k]);
    if(!live.length) return;
    fillMarker("SOCIAL", '<div class="social-row">\n'+live.map(k=>'<a href="'+links[k]+'" target="_blank" rel="noopener" aria-label="'+k+'">'+icons[k]+'</a>').join("\n")+'\n</div>');
  }
  function dynTexts(pairs){
    (pairs||[]).forEach(pr=>{
      try{
        const old=pr.old, nw=pr.new;
        if(!old||old===nw) return;
        const isNum=/^[\d+\s]+$/.test(String(old).trim())&&/\d/.test(old);
        const els=document.body.querySelectorAll("*");
        for(const el of els){
          const tn=el.tagName;
          if(tn==="SCRIPT"||tn==="STYLE"||tn==="NOSCRIPT"||tn==="TEMPLATE") continue;
          try{
            if(el.innerHTML&&el.innerHTML.trim()===old){ el.innerHTML=nw; continue; }
            if(el.children.length===0&&el.textContent&&el.textContent.includes(old)){ el.textContent=el.textContent.split(old).join(nw); }
          }catch(e){}
        }
        if(isNum){
          document.querySelectorAll("a[href]").forEach(a=>{
            try{ const h=a.getAttribute("href"); if(h&&(h.includes("tel:")||h.includes("wa.me"))&&h.includes(old.trim())) a.setAttribute("href",h.split(old.trim()).join(String(nw).trim())); }catch(e){}
          });
        }
      }catch(e){}
    });
  }
  async function dynLoad(){
    let d=null;
    try{
      const ctl=new AbortController(); const to=setTimeout(()=>{try{ctl.abort();}catch(e){}},7000);
      const r=await fetch("/api/public/content",{signal:ctl.signal}); clearTimeout(to);
      if(!r.ok) return; d=await r.json();
    }catch(e){ return; }
    if(!d||d.source==="local") return;
    try{ dynLeaders(d.leaders); }catch(e){}
    try{ dynWelfare(d.welfare); }catch(e){}
    try{ dynNews(d.news); }catch(e){}
    try{ dynActs(d.activities); }catch(e){}
    try{ dynGallery(d.gallery); }catch(e){}
    try{ dynObjectives(d.objectives); }catch(e){}
    try{ dynNotices(d.notices); }catch(e){}
    try{ dynConsumer(d.consumer); }catch(e){}
    try{ dynDonors(d.donors); }catch(e){}
    try{ dynAds(d.ads); }catch(e){}
    try{ dynDonation(d.donation); }catch(e){}
    try{ dynSocial(d.social); }catch(e){}
    try{ dynTexts(d.texts||[]); }catch(e){}
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",()=>setTimeout(dynLoad,300));
  else setTimeout(dynLoad,300);
})();
