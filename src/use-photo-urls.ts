import { useEffect, useState } from 'react';
import type { Equipment } from './model';
import { idbGet } from './idb';

/** Миниатюры фотографий выбранного оборудования из IndexedDB. */
export function usePhotoUrls(equipment: Equipment | undefined): Record<string, string> {
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const keys = equipment?.photos || [];
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
  }, [equipment?.id, equipment?.photos?.length]);

  return photoUrls;
}
