import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicForm } from '../public-form';
import { GalleryAlbums } from '../gallery-albums';
import { createClient } from '../supabase';
import { representativeImages, type RepresentativeImage } from '../representative-images';

type PageInfo = { eyebrow: string; title: string; intro: string; kind?: string; art?: RepresentativeImage['key'] };
const pages: Record<string, PageInfo> = {
  about: { eyebrow: 'समिति का परिचय', title: 'हमारे बारे में', intro: 'अखिल भारतीय वैदिक धर्म संरक्षक समिति वेद एवं भारतीय संस्कृति के संरक्षण, सामाजिक जागरूकता और जनकल्याण के उद्देश्यों के साथ कार्य करती है।', art: 'temple' },
  'mission-vision': { eyebrow: 'दृष्टि और ध्येय', title: 'मिशन एवं विजन', intro: 'समिति के प्रकाशित उद्देश्यों में वेद एवं भारतीय संस्कृति का संरक्षण, सामाजिक जागरूकता, जनकल्याण, नागरिक सहायता और सामाजिक सद्भाव को प्रोत्साहित करना शामिल है।', art: 'ramappa' },
  objectives: { eyebrow: 'हमारी दिशा', title: 'समिति के उद्देश्य', intro: 'समिति के उपलब्ध परिचय और वेबसाइट सामग्री में दिए गए उद्देश्यों का संकलन।', art: 'temple' },
  structure: { eyebrow: 'संगठन', title: 'संगठनात्मक संरचना', intro: 'समिति की संरचना ग्यारह संगठनात्मक स्तरों पर आधारित है। अधिकृत इकाइयाँ और पदाधिकारी उपलब्ध होने पर ही यहाँ प्रदर्शित होंगे।', art: 'volunteers' },
  welfare: { eyebrow: 'जनकल्याण', title: 'समाज सेवा और कल्याण', intro: 'सामाजिक जागरूकता, नागरिक सहायता और जनकल्याण समिति के घोषित कार्यक्षेत्र हैं। विशिष्ट गतिविधियों की जानकारी Admin CMS में प्रकाशित होने पर दिखाई जाएगी।', art: 'volunteers' },
  activities: { eyebrow: 'मैदान से जुड़ाव', title: 'समिति की गतिविधियाँ', intro: 'प्रकाशित परियोजनाओं, कार्यक्रमों और समाचारों के माध्यम से समिति की उपलब्ध गतिविधियाँ देखें।', art: 'kumbh' },
  membership: { eyebrow: 'सहभागिता', title: 'सदस्यता की जानकारी', intro: 'इच्छुक व्यक्ति आवेदन जमा कर सकते हैं। आवेदन समिति द्वारा समीक्षा के लिए भेजा जाता है; स्वीकृति से पहले कोई सदस्यता संख्या या खाता नहीं बनता।', kind: 'join', art: 'volunteers' },
  join: { eyebrow: 'सहभागिता', title: 'सदस्यता के लिए आवेदन', intro: 'आवेदन समिति की समीक्षा के लिए जमा होगा। इस प्रारंभिक फ़ॉर्म में केवल आवश्यक संपर्क विवरण लिए जाते हैं।', kind: 'join', art: 'volunteers' },
  leadership: { eyebrow: 'संगठन', title: 'प्रबंधन टीम', intro: 'केवल Admin CMS में प्रकाशित अधिकृत पदाधिकारी यहाँ दिखेंगे।' },
  projects: { eyebrow: 'जनकल्याण', title: 'परियोजनाएँ', intro: 'समिति द्वारा CMS में प्रकाशित परियोजनाएँ और उपलब्ध विवरण।', kind: 'projects', art: 'volunteers' },
  news: { eyebrow: 'समाचार एवं घोषणाएँ', title: 'समाचार और अपडेट', intro: 'समिति द्वारा प्रकाशित समाचार और घोषणाएँ। अलग सार्वजनिक notices तालिका उपलब्ध नहीं है; प्रकाशित समाचार ही यहाँ दिखते हैं।', kind: 'news', art: 'kumbh' },
  notices: { eyebrow: 'सूचनाएँ', title: 'सूचनाएँ और घोषणाएँ', intro: 'प्रकाशित समाचार CMS से उपलब्ध घोषणाएँ। इस project में अलग notice management table नहीं है।', kind: 'news', art: 'kumbh' },
  events: { eyebrow: 'कार्यक्रम', title: 'कार्यक्रम और आयोजन', intro: 'समिति द्वारा प्रकाशित कार्यक्रम। तारीख और स्थान तभी दिखेंगे जब वे CMS में दिए गए हों।', kind: 'events', art: 'kumbh' },
  gallery: { eyebrow: 'गतिविधियों की झलक', title: 'फोटो गैलरी', intro: 'प्रकाशित एल्बम की प्रामाणिक तस्वीरें देखें।' },
  reports: { eyebrow: 'पारदर्शिता', title: 'वार्षिक रिपोर्ट एवं लेखा-परीक्षण', intro: 'अधिकृत प्रशासक द्वारा प्रकाशित रिपोर्ट और दस्तावेज़।' },
  awards: { eyebrow: 'अभिलेख', title: 'सम्मान एवं उपलब्धियाँ', intro: 'केवल CMS में प्रकाशित और सत्यापित अभिलेख प्रदर्शित किए जाते हैं।' },
  donate: { eyebrow: 'समर्थन', title: 'सहयोग के बारे में पूछें', intro: 'ऑनलाइन भुगतान सुविधा सक्रिय नहीं है। सत्यापित भुगतान और अनुपालन व्यवस्था उपलब्ध होने तक इस वेबसाइट पर दान स्वीकार नहीं किया जाता।' },
  contact: { eyebrow: 'संपर्क', title: 'समिति से संपर्क करें', intro: 'संदेश भेजें; वह समिति के संपर्क प्रबंधन प्रणाली में दर्ज होगा।' },
};
const levels = ['राष्ट्रीय','राज्य','मंडल','जिला','तहसील','ब्लॉक','ग्राम पंचायत','नगर पंचायत','नगरपालिका परिषद','नगर निगम','महानगर निगम'];
const objectives = ['वेद एवं भारतीय संस्कृति का संरक्षण और अध्ययन','धर्म एवं सामाजिक जागरूकता को प्रोत्साहित करना','जनकल्याण, नागरिक सहायता और सामाजिक सेवा कार्यक्रमों का आयोजन','शिक्षा, सामाजिक सुरक्षा और जनहित के विषयों पर जागरूकता','सामाजिक सद्भाव, शांति और विश्वास को बढ़ावा देना','स्थानीय स्तर पर सेवा कार्यों का समन्वय'];
export function generateStaticParams() { return Object.keys(pages).map(slug => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const page = pages[slug];
  return page ? { title: `${page.title} | अखिल भारतीय वैदिक धर्म संरक्षक समिति`, description: page.intro } : {};
}
async function readPublished(type: string, order = 'created_at') {
  const db = createClient(); if (!db) return [];
  try { const { data, error } = await db.from(type).select('*').eq('published', true).eq('archived', false).order(order, { ascending: false }).limit(60); return error ? [] : data || []; }
  catch { return []; }
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="empty-feature"><span>◎</span><div><h3>प्रकाशित सामग्री उपलब्ध नहीं</h3><p>{children}</p></div></div>; }
function Cards({ items, kind }: { items: any[]; kind: string }) {
  if (!items.length) return <Empty>Admin CMS में अधिकृत जानकारी प्रकाशित होने पर वह यहाँ दिखाई देगी।</Empty>;
  return <div className="feature-grid">{items.map((item:any)=><article className="feature-card" key={item.id}>
    {(item.image_path || item.photo_path || item.file_path) && <div className="editorial-image"><img src={item.image_path || item.photo_path || item.file_path} alt={item.title || item.name || 'समिति अभिलेख'} loading="lazy"/></div>}
    <div><small>{item.category || item.location || item.fiscal_year || item.issuer || item.designation || (item.starts_at ? new Date(item.starts_at).toLocaleDateString('hi-IN') : '')}</small><h3>{item.title || item.name}</h3>
      {(item.description || item.body || item.biography) && <p>{item.description || item.body || item.biography}</p>}
      {kind === 'reports' && item.file_path && <a className="textlink" href={item.file_path} target="_blank" rel="noreferrer">रिपोर्ट खोलें ↗</a>}
      {kind === 'awards' && item.file_path && <a className="textlink" href={item.file_path} target="_blank" rel="noreferrer">दस्तावेज़ खोलें ↗</a>}
      {kind === 'news' && item.slug && <Link className="textlink" href={`/news#${item.slug}`}>विवरण देखें ↗</Link>}
    </div></article>)}</div>;
}
export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const page = pages[slug]; if (!page) notFound();
  let items: any[] = [];
  if (page.kind === 'projects') items = await readPublished('projects');
  if (page.kind === 'news') items = await readPublished('news', 'published_at');
  if (page.kind === 'events') items = await readPublished('events', 'starts_at');
  if (slug === 'activities' || slug === 'welfare') { const [projects, events] = await Promise.all([readPublished('projects'), readPublished('events','starts_at')]); items = [...projects, ...events]; }
  if (slug === 'leadership') items = await readPublished('management_team','sort_order');
  if (slug === 'awards') items = await readPublished('awards');
  if (slug === 'reports') items = await readPublished('annual_audit_reports');
  let albums: any[] = [];
  if (slug === 'gallery') { const db=createClient(); if(db){try{const {data,error}=await db.from('photo_albums').select('id,title,description,cover_path,gallery_images(id,file_path,caption,sort_order)').eq('published',true).eq('archived',false).order('created_at',{ascending:false});if(!error)albums=data||[];}catch{}} }
  return <>
    <section className={`page-banner${page.art ? ' has-photo' : ''}`}>
      {page.art && <div className="page-banner-visual" aria-hidden="true" style={{backgroundImage:`linear-gradient(90deg,rgba(8,28,45,.92),rgba(8,28,45,.62)),url("${representativeImages[page.art].src}")`}}/>}
      <div className="wrap"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">मुखपृष्ठ</Link><span>›</span><span>{page.title}</span></nav><span className="eyebrow">{page.eyebrow}</span><h1>{page.title}</h1><p>{page.intro}</p>{page.art && <small className="page-image-credit">प्रतिनिधि तस्वीर (समिति का कार्यक्रम नहीं): <a href={representativeImages[page.art].filePage} target="_blank" rel="noreferrer">{representativeImages[page.art].author} / Wikimedia Commons</a> · <a href={representativeImages[page.art].licenseUrl} target="_blank" rel="noreferrer">{representativeImages[page.art].license}</a> · प्रदर्शन हेतु crop और overlay</small>}</div>
    </section>
    <section className="page-content section"><div className="wrap">
      {slug === 'about' && <div className="about-highlights"><article><small>01 · संस्कृति</small><h2>वेद एवं भारतीय संस्कृति</h2><p>समिति के घोषित उद्देश्यों में संरक्षण और अध्ययन शामिल है।</p></article><article><small>02 · जागरूकता</small><h2>सामाजिक जागरूकता</h2><p>धर्म, शिक्षा और जनहित के विषयों पर जागरूकता को प्रोत्साहित करना।</p></article><article><small>03 · जनकल्याण</small><h2>सेवा और सहायता</h2><p>जनकल्याण, नागरिक सहायता और सामाजिक सेवा के प्रयासों का समन्वय।</p></article></div>}
      {slug === 'structure' && <><div className="page-lead"><h2>ग्यारह स्तरों का <i>संगठनात्मक ढाँचा</i></h2><p>यह सूची project की मौजूदा संगठन संरचना से ली गई है। वास्तविक इकाई/पदाधिकारी अलग से अधिकृत होने पर प्रकाशित होंगे।</p></div><div className="level-grid">{levels.map((level,i)=><article key={level}><small>स्तर {String(i+1).padStart(2,'0')}</small><b>{level}</b></article>)}</div></>}
      {slug === 'objectives' && <><div className="objective-grid inner-objectives">{objectives.map((text,i)=><article className="objective-card" key={text}><span>{String(i+1).padStart(2,'0')}</span><p>{text}</p></article>)}</div><Link className="textlink" href="/mission-vision">मिशन एवं विजन देखें ↗</Link></>}
      {slug === 'mission-vision' && <div className="mission-grid"><article><span className="eyebrow dark">ध्येय</span><h2>संरक्षण और <i>जागरूकता</i></h2><p>वेद एवं भारतीय संस्कृति का संरक्षण और धर्म एवं सामाजिक जागरूकता को प्रोत्साहित करना।</p></article><article><span className="eyebrow dark">दृष्टि</span><h2>जनकल्याण और <i>सामाजिक सद्भाव</i></h2><p>समिति के घोषित उद्देश्यों में नागरिक सहायता, शिक्षा, जनहित और समाज में शांति तथा विश्वास को बढ़ावा देना शामिल है।</p></article></div>}
      {slug === 'gallery' && (albums.length ? <GalleryAlbums albums={albums}/> : <Empty>आधिकारिक फोटो एल्बम Admin CMS से प्रकाशित होने पर यहाँ दिखेंगे।</Empty>)}
      {['projects','news','notices','events','activities','welfare','leadership','reports','awards'].includes(slug) && <Cards items={items} kind={page.kind || slug}/>}
      {page.kind === 'join' && <PublicForm kind="join"/>}
      {slug === 'contact' && <PublicForm kind="contact"/>}
      {slug === 'donate' && <div className="support-notice"><b>भुगतान सुविधा सक्रिय नहीं है</b><p>बैंक विवरण या भुगतान निर्देश इस project में verified public configuration के रूप में उपलब्ध नहीं हैं। किसी भुगतान को इस वेबसाइट से न भेजें। सामान्य पूछताछ के लिए संपर्क फ़ॉर्म का उपयोग करें।</p><Link className="button gold" href="/contact">संपर्क करें <span>↗</span></Link></div>}
      {!page.kind && !['about','structure','objectives','mission-vision','gallery','projects','news','notices','events','activities','welfare','leadership','reports','awards','contact','donate'].includes(slug) && <div className="page-lead"><p>{page.intro}</p><Link className="textlink" href="/join">सदस्यता आवेदन करें ↗</Link></div>}
    </div></section>
  </>;
}
