import Link from 'next/link';
import { createClient } from './supabase';
import { RepresentativePhotoStrip } from './representative-photo-strip';
import { representativeImages } from './representative-images';

type Row = Record<string, any>;
const objectives = [
  ['वेद एवं भारतीय संस्कृति का संरक्षण और अध्ययन', '01'],
  ['धर्म एवं सामाजिक जागरूकता को प्रोत्साहित करना', '02'],
  ['जनकल्याण, नागरिक सहायता और सामाजिक सेवा कार्यक्रम', '03'],
  ['शिक्षा, सामाजिक सुरक्षा और जनहित के विषयों पर जागरूकता', '04'],
  ['सामाजिक सद्भाव, शांति और विश्वास को बढ़ावा देना', '05'],
  ['स्थानीय स्तर पर सेवा कार्यों का समन्वय', '06'],
];

async function read(type: string, limit = 3, order = 'created_at'): Promise<Row[]> {
  const db = createClient();
  if (!db) return [];
  try {
    const { data, error } = await db.from(type).select('*').eq('published', true).eq('archived', false).order(order, { ascending: false }).limit(limit);
    return error ? [] : (data || []) as Row[];
  } catch { return []; }
}
async function readUpcomingEvents(limit = 3): Promise<Row[]> {
  const db = createClient(); if (!db) return [];
  try { const { data, error } = await db.from('events').select('*').eq('published', true).eq('archived', false).gte('starts_at', new Date().toISOString()).order('starts_at', { ascending: true }).limit(limit); return error ? [] : (data || []) as Row[]; }
  catch { return []; }
}

function ImageCard({ src, alt, label }: { src?: string | null; alt: string; label?: string }) {
  return <div className="editorial-image">
    {src ? <img src={src} alt={alt} loading="lazy"/> : <div className="image-fallback" aria-label="आधिकारिक तस्वीर उपलब्ध नहीं"><span>॥ ॐ ॥</span><small>आधिकारिक चित्र उपलब्ध होने पर यहाँ प्रकाशित होगा</small></div>}
    {label && <span className="image-label">{label}</span>}
  </div>;
}

function SectionHeading({ eyebrow, title, href, action }: { eyebrow: string; title: React.ReactNode; href?: string; action?: string }) {
  return <div className="section-heading"><div><span className="eyebrow dark">{eyebrow}</span><h2>{title}</h2></div>{href && <Link className="textlink" href={href}>{action || 'और देखें'} <span>↗</span></Link>}</div>;
}

export default async function Home() {
  const [slides, projects, albums, news, events, team] = await Promise.all([
    read('homepage_slides', 5, 'sort_order'), read('projects'), read('photo_albums'), read('news'), readUpcomingEvents(), read('management_team', 4, 'sort_order'),
  ]);
  const hero = slides[0];
  const heroImage = hero?.image_url || representativeImages.kumbh.src;
  const updates = news.slice(0, 3);
  return <>
    <section className="home-hero">
      <div className="hero-photo" style={{ backgroundImage: `linear-gradient(90deg,rgba(8,28,45,.93) 0%,rgba(8,28,45,.76) 48%,rgba(8,28,45,.2) 100%),url("${heroImage}")` }} />
      <div className="wrap home-hero-inner"><div className="hero-copy">
        <span className="eyebrow">अखिल भारतीय वैदिक धर्म संरक्षक समिति</span>
        <h1>{hero?.title || <>परंपरा का सम्मान,<br/><i>समाज के साथ सेवा</i></>}</h1>
        <p>{hero?.subtitle || 'वेद एवं भारतीय संस्कृति के संरक्षण, सामाजिक जागरूकता और जनकल्याण के उद्देश्य से समर्पित।'}</p>
        <div className="hero-actions"><Link className="button gold" href="/join">सदस्यता के लिए आवेदन <span>↗</span></Link><Link className="button outline" href="/about">समिति का परिचय <span>→</span></Link></div>
        <div className="hero-verse">“सत्यं वद। धर्मं चर। ॐ वेदो खिलो धर्ममूलम्।”</div>
      </div><div className="hero-side-note"><span>संस्कृति</span><span className="note-rule"/><span>जनसेवा</span></div></div>
      {!hero?.image_url && <div className="hero-caption">प्रतिनिधि छवि · <a href={representativeImages.kumbh.filePage} target="_blank" rel="noreferrer">Balone21 / Wikimedia Commons</a> · <a href={representativeImages.kumbh.licenseUrl} target="_blank" rel="noreferrer">CC BY-SA 4.0</a> · crop और overlay लागू</div>}
    </section>

    <section className="intro-section section"><div className="wrap intro-grid">
      <div className="intro-stamp"><span>ॐ</span><small>सत्यं वद · धर्मं चर</small></div>
      <div><span className="eyebrow dark">समिति का परिचय</span><h2>परंपरा से प्रेरित,<br/><i>समाज के लिए प्रतिबद्ध</i></h2><p className="lead">अखिल भारतीय वैदिक धर्म संरक्षक समिति वेद एवं भारतीय संस्कृति के संरक्षण, सामाजिक जागरूकता और जनकल्याण के उद्देश्यों के साथ कार्य करती है। समिति के बारे में विस्तृत तथा स्वीकृत जानकारी प्रकाशित होने पर इस परिचय को CMS से अपडेट किया जा सकता है।</p><Link className="textlink" href="/about">हमारे बारे में पढ़ें <span>↗</span></Link></div>
    </div></section>

    <section className="section objectives-section"><div className="wrap"><SectionHeading eyebrow="हमारी दिशा" title={<>उद्देश्य और <i>प्रतिबद्धताएँ</i></>} href="/objectives" action="सभी उद्देश्य"/><div className="objective-grid">{objectives.map(([text, number])=><article className="objective-card" key={number}><span>{number}</span><p>{text}</p><b>↗</b></article>)}</div></div></section>

    <section className="section organization-band"><div className="wrap organization-grid"><div><span className="eyebrow">संगठनात्मक व्यवस्था</span><h2>स्थानीय जुड़ाव से<br/><i>व्यापक समन्वय तक</i></h2><p>समिति की संगठनात्मक संरचना में ग्यारह स्तर हैं। अधिकृत इकाइयों और पदाधिकारियों का विवरण उपलब्ध होने पर ही प्रकाशित किया जाएगा।</p><Link className="button outline" href="/structure">संरचना देखें <span>↗</span></Link></div><div className="level-visual"><div className="level-ring"><span>११</span><small>संगठनात्मक स्तर</small></div><p>राष्ट्रीय · राज्य · मंडल · जिला · तहसील · ब्लॉक · ग्राम एवं नगर इकाइयाँ</p></div></div></section>

    <section className="section"><div className="wrap"><SectionHeading eyebrow="कार्य और सहभागिता" title={<>समाज के साथ <i>सार्थक जुड़ाव</i></>} href="/welfare" action="कार्य क्षेत्र"/><div className="welfare-grid"><article><span>01</span><h3>जागरूकता</h3><p>धर्म, शिक्षा और जनहित के विषयों पर जागरूकता को प्रोत्साहित करना।</p></article><article><span>02</span><h3>सामाजिक सेवा</h3><p>जनकल्याण और नागरिक सहायता से जुड़े सेवा प्रयासों का समन्वय।</p></article><article><span>03</span><h3>सांस्कृतिक संरक्षण</h3><p>वेद एवं भारतीय संस्कृति के अध्ययन और संरक्षण के उद्देश्य को आगे बढ़ाना।</p></article></div></div></section>

    <section className="section visual-section"><div className="wrap"><SectionHeading eyebrow="भारत की संस्कृति और सेवा" title={<>प्रतिनिधि <i>दृश्य</i></>} /><p className="visual-intro">नीचे दी गई Wikimedia Commons तस्वीरें सांस्कृतिक धरोहर और स्वयंसेवा के उदाहरण हैं; ये समिति के अपने कार्यक्रमों की तस्वीरें नहीं हैं।</p><RepresentativePhotoStrip/></div></section>

    {projects.length > 0 && <section className="section tinted"><div className="wrap"><SectionHeading eyebrow="जनकल्याण" title={<>प्रकाशित <i>परियोजनाएँ</i></>} href="/projects" action="सभी परियोजनाएँ"/><div className="feature-grid">{projects.slice(0,3).map((item:Row)=><Link className="feature-card" href="/projects" key={item.id}><ImageCard src={item.image_path} alt={item.title}/><div><small>{item.category || item.location || 'समिति परियोजना'}</small><h3>{item.title}</h3><p>{item.description}</p></div></Link>)}</div></div></section>}

    {team.length > 0 && <section className="section"><div className="wrap"><SectionHeading eyebrow="समिति नेतृत्व" title={<>प्रबंधन <i>टीम</i></>} href="/leadership" action="पूरी टीम"/><div className="team-grid">{team.map((person:Row)=><article className="team-card" key={person.id}><ImageCard src={person.photo_path} alt={person.name}/><div><h3>{person.name}</h3><span>{person.designation}</span>{person.biography && <p>{person.biography}</p>}</div></article>)}</div></div></section>}

    {(updates.length > 0 || events.length > 0) && <section className="section updates-section"><div className="wrap"><SectionHeading eyebrow="समिति से जुड़ी जानकारी" title={<>समाचार और <i>आगामी कार्यक्रम</i></>} href="/news" action="सभी अपडेट"/><div className="feature-grid">{[...events, ...updates].slice(0,3).map((item:Row, index:number)=><article className="feature-card" key={`${item.id}-${index}`}><ImageCard src={item.image_path} alt={item.title}/><div><small>{item.starts_at ? new Date(item.starts_at).toLocaleDateString('hi-IN') : item.published_at ? new Date(item.published_at).toLocaleDateString('hi-IN') : item.location || 'समिति अपडेट'}</small><h3>{item.title}</h3><p>{item.description || item.body}</p></div></article>)}</div></div></section>}

    <section className="section gallery-section"><div className="wrap"><SectionHeading eyebrow="गतिविधियों की झलक" title={<>फोटो <i>गैलरी</i></>} href="/gallery" action="गैलरी खोलें"/>{albums.length ? <div className="feature-grid">{albums.slice(0,3).map((album:Row)=><Link className="feature-card" href="/gallery" key={album.id}><ImageCard src={album.cover_path} alt={album.title}/><div><h3>{album.title}</h3><p>{album.description || 'समिति का प्रकाशित फोटो एल्बम'}</p></div></Link>)}</div> : <div className="empty-feature"><span>◎</span><div><h3>आधिकारिक फोटो एल्बम की प्रतीक्षा</h3><p>प्रामाणिक गतिविधि तस्वीरें Admin CMS से प्रकाशित होने पर इस स्थान पर दिखेंगी।</p></div><Link className="textlink" href="/gallery">गैलरी देखें ↗</Link></div>}</div></section>

    <section className="section membership-band"><div className="wrap membership-inner"><div><span className="eyebrow">समिति से जुड़ें</span><h2>सहभागिता की शुरुआत<br/><i>सदस्यता आवेदन से</i></h2><p>आवेदन समिति की समीक्षा के लिए जमा होगा। स्वीकृति और आगे की प्रक्रिया की जानकारी समिति द्वारा दी जाएगी।</p></div><div className="membership-actions"><Link className="button gold" href="/join">आवेदन करें <span>↗</span></Link><Link className="button outline" href="/contact">संपर्क करें <span>→</span></Link><small>ऑनलाइन दान/भुगतान सुविधा सक्रिय नहीं है।</small></div></div></section>
  </>;
}
