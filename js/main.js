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
      + '<div><h3>'+a.title+'</h3><p>'+a.text+'</p>'
      + '<a class="btn btn-gold btn-sm" href="'+a.href+'">'+a.cta+'</a></div>';
  }
  function buildSlider(afterEl){
    const sec = document.createElement("section");
    sec.className = "ad-section";
    sec.setAttribute("aria-label","विज्ञापन");
    sec.innerHTML = '<div class="container"><div class="ad-slider"><div class="ad-track">'
      + ADS.map(a=>'<div class="ad-slide theme-'+a.theme+'">'+adSlideHTML(a)+'</div>').join("")
      + '</div><button class="ad-nav prev" aria-label="पिछला विज्ञापन">‹</button>'
      + '<button class="ad-nav next" aria-label="अगला विज्ञापन">›</button><div class="ad-dots">'
      + ADS.map((_,i)=>'<button aria-label="विज्ञापन '+(i+1)+'"></button>').join("")
      + '</div></div></div>';
    afterEl.after(sec);
    const track = sec.querySelector(".ad-track");
    const dots = Array.from(sec.querySelectorAll(".ad-dots button"));
    let idx = 0, timer = null;
    const go = i=>{ idx=(i+ADS.length)%ADS.length; track.style.transform="translateX(-"+(idx*100)+"%)"; dots.forEach((d,k)=>d.classList.toggle("active",k===idx)); };
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
    const show = ()=>{ const a=ADS[i%ADS.length]; link.href=a.href; txt.textContent=a.title+" — "+a.text; i++; };
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
  if(isHome && trustEl) buildSlider(trustEl);
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
  gitems.forEach(g=>g.addEventListener("click",()=>{
    const im = g.querySelector("img");
    if(lb&&lbImg&&im){ lbImg.src=im.src; lbImg.alt=im.alt; lb.classList.add("open"); document.body.style.overflow="hidden"; }
  }));
  lb?.addEventListener("click",()=>{ lb.classList.remove("open"); document.body.style.overflow=""; });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"){ lb?.classList.remove("open"); document.body.style.overflow=""; menu?.classList.remove("open"); }});

  // Share buttons
  $$("[data-share]").forEach(a=>a.addEventListener("click",e=>{
    e.preventDefault();
    const type=a.dataset.share, title=encodeURIComponent(a.dataset.title||document.title), url=encodeURIComponent(location.href);
    let u = type==="x" ? `https://twitter.com/intent/tweet?text=${title}&url=${url}`
      : type==="fb" ? `https://www.facebook.com/sharer/sharer.php?u=${url}`
      : `https://wa.me/?text=${title}%20${url}`;
    window.open(u,"_blank","noopener,width=640,height=560");
  }));
})();
