// Шрифты для PDF берутся из самого приложения: PT Sans (OFL) с поддержкой кириллицы,
// поэтому PDF собирается офлайн, без системных шрифтов и сервера.
import regularUrl from './assets/fonts/PT_Sans-Web-Regular.ttf?url';
import boldUrl from './assets/fonts/PT_Sans-Web-Bold.ttf?url';

export interface JournalFonts {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}

let cache: Promise<JournalFonts> | null = null;

export function loadJournalFonts(): Promise<JournalFonts> {
  if (!cache) {
    cache = (async () => {
      const fetchFont = async (url: string): Promise<ArrayBuffer> => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Не удалось загрузить шрифт (${response.status})`);
        return response.arrayBuffer();
      };
      const [regular, bold] = await Promise.all([fetchFont(regularUrl), fetchFont(boldUrl)]);
      return { regular, bold };
    })();
  }
  return cache;
}
