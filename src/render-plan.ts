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

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Нужен ли рендер по частям: считается по полному листу, а не по текущему виду. */
export function needsClipping(sheetWidth: number, sheetHeight: number, dpr: number, maxPixels: number): boolean {
  const quality = clamp(dpr, 0.75, 2);
  return Math.max(1, sheetWidth) * Math.max(1, sheetHeight) * quality * quality > Math.max(250_000, maxPixels);
}

export function planRender(input: PlanViewport): PlanRender {
  const sheetWidth = Math.max(1, input.sheetWidth);
  const sheetHeight = Math.max(1, input.sheetHeight);
  const quality = clamp(input.dpr, 0.75, 2);
  const maxPixels = Math.max(250_000, input.maxPixels);

  const fullPixels = sheetWidth * sheetHeight * quality * quality;
  if (fullPixels <= maxPixels) {
    return {
      scale: quality,
      clipX: 0,
      clipY: 0,
      clipWidth: sheetWidth,
      clipHeight: sheetHeight,
      canvasWidth: Math.max(1, Math.round(sheetWidth * quality)),
      canvasHeight: Math.max(1, Math.round(sheetHeight * quality)),
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
  const scale = Math.max(0.1, Math.min(wanted, budgetScale));

  return {
    scale,
    clipX,
    clipY,
    clipWidth,
    clipHeight,
    canvasWidth: Math.max(1, Math.round(clipWidth * scale)),
    canvasHeight: Math.max(1, Math.round(clipHeight * scale)),
    clipped: true,
  };
}

/** Резервный вариант: весь лист, но с ограничением по памяти. */
export function fallbackPlan(sheetWidth: number, sheetHeight: number, maxPixels: number): PlanRender {
  const width = Math.max(1, sheetWidth);
  const height = Math.max(1, sheetHeight);
  const scale = Math.max(0.05, Math.min(2, Math.sqrt(maxPixels / (width * height))));
  return {
    scale,
    clipX: 0,
    clipY: 0,
    clipWidth: width,
    clipHeight: height,
    canvasWidth: Math.max(1, Math.round(width * scale)),
    canvasHeight: Math.max(1, Math.round(height * scale)),
    clipped: false,
  };
}
