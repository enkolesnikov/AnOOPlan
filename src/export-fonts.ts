// Шрифты для PDF берутся из самого приложения: сабсет PT Sans (OFL) с кириллицей и латиницей,
// поэтому PDF собирается офлайн, без системных шрифтов и сервера. Сабсет и переименование
// в «AnOOPlan Sans» сделаны по требованию OFL (Reserved Font Names «PT Sans»/«ParaType»).
import regularUrl from './assets/fonts/AnOOPlanSans-Regular.ttf?url';
import boldUrl from './assets/fonts/AnOOPlanSans-Bold.ttf?url';

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
