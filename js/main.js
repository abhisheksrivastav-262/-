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

  // Membership form
  const mform = $("#membershipForm");
  if(mform){
    mform.addEventListener("submit",e=>{
      e.preventDefault();
      const fd = new FormData(mform);
      const v = k=>String(fd.get(k)||"").trim();
      const mobile = v("mobile").replace(/\D/g,"");
      if(!v("name")||mobile.length<10){ alert("कृपया सही नाम और 10 अंकों का मोबाइल नंबर भरें।"); return; }
      const lines = [
        "नमस्ते, मुझे जर्नलिस्ट सेवा परिषद की सदस्यता के लिए आवेदन करना है।",
        "———————————",
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
        "———————————",
        "कृपया सदस्यता प्रक्रिया की जानकारी दें।"
      ];
      $("#formStatus") && ($("#formStatus").textContent = "WhatsApp खुल रहा है… कृपया Send दबाकर आवेदन भेजें।");
      openWhatsApp(lines.join("\n"));
    });
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
