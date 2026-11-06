import { representativeImages, type RepresentativeImage } from './representative-images';

export function RepresentativePhotoStrip({ images = ['temple','volunteers','ramappa'] as RepresentativeImage['key'][] }: { images?: RepresentativeImage['key'][] }) {
  return <div className="representative-strip">{images.map(key => {
    const item=representativeImages[key];
    return <figure className="representative-card" key={key}>
      <div className="representative-card-image"><img src={item.src} alt={item.alt} loading="lazy"/></div>
      <figcaption><b>{item.title}</b><small>{item.context}</small><span><a href={item.filePage} target="_blank" rel="noreferrer">{item.author} · Wikimedia Commons</a> · <a href={item.licenseUrl} target="_blank" rel="noreferrer">{item.license}</a> · प्रदर्शन हेतु crop</span></figcaption>
    </figure>;
  })}</div>;
}
