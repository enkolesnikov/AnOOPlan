// Планирование рендера PDF-подложки: сколько пикселей рисовать и какую часть листа.
// Для обычных A4-A3 рисуется весь лист (как раньше), для больших A1-A0 — только видимая
// область с запасом, чтобы WebView не упирался в память при зуме.
export interface PlanViewport {
  sheetWidth: number;
  sheetHeight: number;
  zoom: number;
  dpr: number;
  viewWidth: number;
  viewHeight: number;
  panX: number;
  panY: number;
  maxPixels: number;
}

export interface PlanRender {
  scale: number;
  clipX: number;
  clipY: number;
  clipWidth: number;
  clipHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  clipped: boolean;
}

/**
 * Бюджет пикселей подложки: 8 Мпикс ≈ 32 МБ RGBA.
 * A4-A3 рисуются целиком, A1-A0 — по видимой области с понижением разрешения.
 */
export const PLAN_MAX_PIXELS = 8_000_000;

/** Нижняя граница бюджета: даже при экзотических размерах не рисуем меньше этого. */
const MIN_MAX_PIXELS = 250_000;
/** Качество выше 2× не нужно: WebView всё равно не покажет больше. */
const MAX_QUALITY = 2;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const formatNumber = (value: number, digits = 1): string => {
  const rounded = Number(value.toFixed(digits));
  return String(rounded).replace('.', ',');
};

const formatMegapixels = (pixels: number): string => `${formatNumber(pixels / 1_000_000, pixels < 10_000_000 ? 2 : 1)} Мпикс`;

const formatMegabytes = (bytes: number): string => `${formatNumber(bytes / 1_000_000, bytes < 10_000_000 ? 1 : 0)} МБ`;

/** Стандартные листы A4-A0 в единицах PDF (72 dpi). */
const SHEET_FORMATS: readonly { name: string; width: number; height: number }[] = [
  { name: 'A4', width: 842, height: 595 },
  { name: 'A3', width: 1191, height: 842 },
  { name: 'A2', width: 1684, height: 1191 },
  { name: 'A1', width: 2384, height: 1684 },
  { name: 'A0', width: 3370, height: 2384 },
];
/** PDF может быть отрисован в 72 dpi (единицы PDF) или 300 dpi (растровая подложка). */
const SHEET_DPI_SCALES = [1, 300 / 72];

/** Название формата листа (A4-A0) по размерам, если размеры похожи на стандартные. */
function sheetFormatName(sheetWidth: number, sheetHeight: number): string | null {
  const long = Math.max(sheetWidth, sheetHeight);
  const short = Math.min(sheetWidth, sheetHeight);
  if (!(long > 0) || !(short > 0)) return null;
  if (Math.abs(long / short - Math.SQRT2) > 0.02) return null;
  for (const scale of SHEET_DPI_SCALES) {
    for (const format of SHEET_FORMATS) {
      const width = Math.max(format.width, format.height) * scale;
      const height = Math.min(format.width, format.height) * scale;
      if (Math.abs(long - width) <= width * 0.02 && Math.abs(short - height) <= height * 0.02) return format.name;
    }
  }
  return null;
}

/** Нужен ли рендер по частям: считается по полному листу, а не по текущему виду. */
export function needsClipping(sheetWidth: number, sheetHeight: number, dpr: number, maxPixels: number): boolean {
  const quality = clamp(dpr, 0.75, MAX_QUALITY);
  return Math.max(1, sheetWidth) * Math.max(1, sheetHeight) * quality * quality > Math.max(MIN_MAX_PIXELS, maxPixels);
}

/**
 * Предупреждение о памяти: полный лист при текущем dpr не влезает в бюджет рендера,
 * поэтому будет отрисована только видимая область. null — полный лист помещается.
 */
export function planMemoryWarning(sheetWidth: number, sheetHeight: number, dpr: number, maxPixels: number = PLAN_MAX_PIXELS): string | null {
  const width = Math.max(1, sheetWidth);
  const height = Math.max(1, sheetHeight);
  const quality = clamp(dpr, 0.75, MAX_QUALITY);
  const budget = Math.max(MIN_MAX_PIXELS, maxPixels);
  const pixels = width * height * quality * quality;
  if (pixels <= budget) return null;
  const format = sheetFormatName(width, height);
  const sheet = format ? `Лист ${format}` : `Лист ${formatNumber(width, 0)}×${formatNumber(height, 0)} ед.`;
  return `${sheet}: ${formatMegapixels(pixels)} при масштабе экрана ${formatNumber(quality, 2)}× — больше бюджета `
    + `${formatMegapixels(budget)} (${formatMegabytes(budget * 4)} RGBA). Отрисовывается только видимая область; `
    + 'чтобы увидеть лист целиком, нажмите «Вписать».';
}

export function planRender(input: PlanViewport): PlanRender {
  const sheetWidth = Math.max(1, input.sheetWidth);
  const sheetHeight = Math.max(1, input.sheetHeight);
  const quality = clamp(input.dpr, 0.75, MAX_QUALITY);
  const maxPixels = Math.max(MIN_MAX_PIXELS, input.maxPixels);

  const fullPixels = sheetWidth * sheetHeight * quality * quality;
  if (fullPixels <= maxPixels) {
    return {
      scale: quality,
      clipX: 0,
      clipY: 0,
      clipWidth: sheetWidth,
      clipHeight: sheetHeight,
      // floor: произведение сторон канвы гарантированно не выходит за бюджет с учётом округления.
      canvasWidth: Math.max(1, Math.floor(sheetWidth * quality)),
      canvasHeight: Math.max(1, Math.floor(sheetHeight * quality)),
      clipped: false,
    };
  }

  // Видимая часть листа в координатах PDF плюс запас на панорамирование.
  const zoom = Math.max(0.02, input.zoom);
  const visibleLeft = -input.panX / zoom;
  const visibleTop = -input.panY / zoom;
  const visibleRight = (input.viewWidth - input.panX) / zoom;
  const visibleBottom = (input.viewHeight - input.panY) / zoom;

  const padding = 0.25;
  const padX = (visibleRight - visibleLeft) * padding;
  const padY = (visibleBottom - visibleTop) * padding;

  const clipX = clamp(visibleLeft - padX, 0, sheetWidth);
  const clipY = clamp(visibleTop - padY, 0, sheetHeight);
  const clipRight = clamp(visibleRight + padX, clipX + 1, sheetWidth);
  const clipBottom = clamp(visibleBottom + padY, clipY + 1, sheetHeight);
  const clipWidth = Math.max(1, clipRight - clipX);
  const clipHeight = Math.max(1, clipBottom - clipY);

  const wanted = clamp(zoom * quality, quality, 3);
  const budgetScale = Math.sqrt(maxPixels / (clipWidth * clipHeight));
  // Нижней границы по качеству нет: бюджет памяти важнее, иначе канва может его превысить.
  const scale = Math.max(0.01, Math.min(wanted, budgetScale));

  return {
    scale,
    clipX,
    clipY,
    clipWidth,
    clipHeight,
    canvasWidth: Math.max(1, Math.floor(clipWidth * scale)),
    canvasHeight: Math.max(1, Math.floor(clipHeight * scale)),
    clipped: true,
  };
}

/** Резервный вариант: весь лист, но с ограничением по памяти. */
export function fallbackPlan(sheetWidth: number, sheetHeight: number, maxPixels: number = PLAN_MAX_PIXELS): PlanRender {
  const width = Math.max(1, sheetWidth);
  const height = Math.max(1, sheetHeight);
  const scale = Math.max(0.05, Math.min(2, Math.sqrt(Math.max(MIN_MAX_PIXELS, maxPixels) / (width * height))));
  return {
    scale,
    clipX: 0,
    clipY: 0,
    clipWidth: width,
    clipHeight: height,
    // floor: даже с округлением канва не должна превышать бюджет.
    canvasWidth: Math.max(1, Math.floor(width * scale)),
    canvasHeight: Math.max(1, Math.floor(height * scale)),
    clipped: false,
  };
}
