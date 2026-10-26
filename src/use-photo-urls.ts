import { useEffect, useState } from 'react';
import { idbGet } from './idb';

/** Миниатюры фотографий выбранного оборудования из IndexedDB. */
export function usePhotoUrls(photos: string[] | undefined, ownerId: string | undefined): Record<string, string> {
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  // Ключ стабилен при том же наборе фото: массив приходит новым на каждый рендер.
  const photosKey = photos?.join('\u0000') ?? '';

  useEffect(() => {
    const keys = photosKey ? photosKey.split('\u0000') : [];
    if (!keys.length) { setPhotoUrls({}); return; }
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const map: Record<string, string> = {};
      for (const key of keys) {
        try {
          const blob = await idbGet('photo:' + key);
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          created.push(url);
          map[key] = url;
        } catch { /* хранилище недоступно */ }
      }
      if (cancelled) { created.forEach(url => URL.revokeObjectURL(url)); return; }
      setPhotoUrls(map);
    })();
    return () => { cancelled = true; created.forEach(url => URL.revokeObjectURL(url)); };
  }, [ownerId, photosKey]);

  return photoUrls;
}
