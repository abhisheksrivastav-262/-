'use client';

import { useEffect, useMemo, useState } from 'react';

type Photo = { id: string; file_path: string; caption?: string | null; albumTitle: string };
type Album = { id: string; title: string; description?: string | null; cover_path?: string | null; gallery_images?: { id: string; file_path: string; caption?: string | null; sort_order?: number }[] };

export function GalleryAlbums({ albums }: { albums: Album[] }) {
  const photos = useMemo(() => albums.flatMap(album => [...(album.cover_path ? [{ id: `${album.id}-cover`, file_path: album.cover_path, caption: album.title, sort_order: -1 }] : []), ...(album.gallery_images || [])].sort((a,b)=>(a.sort_order || 0)-(b.sort_order || 0)).map(photo => ({ ...photo, albumTitle: album.title }))), [albums]);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (active === null) return;
    const closeOnEscape = (event: KeyboardEvent) => { if(event.key === 'Escape') setActive(null); if(event.key === 'ArrowRight') setActive(index => index === null ? null : (index + 1) % photos.length); if(event.key === 'ArrowLeft') setActive(index => index === null ? null : (index - 1 + photos.length) % photos.length); };
    window.addEventListener('keydown', closeOnEscape); document.body.style.overflow='hidden';
    return () => { window.removeEventListener('keydown', closeOnEscape); document.body.style.overflow=''; };
  }, [active, photos.length]);
  return <>
    {albums.map(album => <section className="album-block" key={album.id}><div className="album-heading"><div><h2>{album.title}</h2>{album.description && <p>{album.description}</p>}</div><span>{(album.gallery_images || []).length} तस्वीरें</span></div><div className="album-grid">{(album.gallery_images || []).slice().sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map(photo => { const index=photos.findIndex(item=>item.id===photo.id); return <button className="album-photo" key={photo.id} onClick={()=>setActive(index)} aria-label={`${photo.caption || album.title} — बड़ा देखें`}><img src={photo.file_path} alt={photo.caption || album.title} loading="lazy"/><span>{photo.caption || album.title}</span></button>; })}</div></section>)}
    {active !== null && photos[active] && <div className="lightbox" role="dialog" aria-modal="true" aria-label="फोटो गैलरी" onClick={()=>setActive(null)}><button className="lightbox-close" onClick={()=>setActive(null)} aria-label="बंद करें">×</button><button className="lightbox-prev" aria-label="पिछली तस्वीर" onClick={event=>{event.stopPropagation();setActive((active-1+photos.length)%photos.length)}}>‹</button><figure onClick={event=>event.stopPropagation()}><img src={photos[active].file_path} alt={photos[active].caption || photos[active].albumTitle}/><figcaption>{photos[active].caption || photos[active].albumTitle}</figcaption></figure><button className="lightbox-next" aria-label="अगली तस्वीर" onClick={event=>{event.stopPropagation();setActive((active+1)%photos.length)}}>›</button></div>}
  </>;
}
