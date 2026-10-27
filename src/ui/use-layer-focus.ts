import { useEffect, useRef, useState } from 'react';
import type { NativeHostWindow, WebBackHandler } from './native';
import type { WorkspaceState } from './use-workspace-state';

/**
 * Модальность слоёв интерфейса (UX-01) и системная кнопка «Назад» (UX-02).
 *
 * Разметку шторок не трогаем: по открытым флагам состояния находим верхний слой
 * через `document.querySelector`, помечаем его `aria-modal`, удерживаем в нём
 * Tab/Shift+Tab, закрываем по Escape и возвращаем фокус инициатору. Закрытые
 * off-canvas сайдбар и свойства получают `inert`/`aria-hidden` (с fallback для
 * старых WebView), чтобы их поля не попадали в Tab-порядок.
 *
 * Сюда же регистрируется `window.__anooplanHandleBack`: им MainActivity
 * спрашивает веб-часть, закрыт ли Back верхним слоем. Приоритет слоёв:
 * sheet → export/history/about/projects/templates/onboarding → props → menu → корень.
 */

type LayerId = 'sheet' | 'toolsMore' | 'export' | 'history' | 'about' | 'projects' | 'templates' | 'onboarding' | 'props' | 'menu';

type Layer = {
  id: LayerId;
  /** Закрывает слой существующим сеттером состояния. */
  close: () => void;
  /** Селекторы корня слоя: сначала точный, затем общий запасной. */
  selectors: string[];
};

/** Панели свойств и сайдбар — off-canvas только на узком экране (см. styles.css). */
const DRAWER_QUERY = '(max-width: 1023px)';

/** Любой лист/шторка, кроме «О программе» (у него собственный класс `.about-sheet`). */
const ANY_SHEET = '.sheet-backdrop:not(.about-backdrop) .sheet';
/** Любая модалка; при одновременно открытых шаблонах/обучении уточняется выше. */
const ANY_MODAL = '.modal-backdrop .modal';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FALLBACK_FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

type Stamp = {
  /** Исходные значения атрибутов, которые слой поменял (null — атрибута не было). */
  attributes: Map<string, string | null>;
  /** Fallback без inert: исходные tabindex'ы вложенных элементов. */
  tabStops: Map<HTMLElement, string | null>;
};

/** Состояние верхнего слоя между коммитами: чем вернуть фокус при закрытии. */
type ActiveLayer = { id: LayerId; element: HTMLElement; opener: HTMLElement | null };

/** Список открытых слоёв в порядке приоритета: первый — самый верхний. */
function buildLayers(state: WorkspaceState, drawerMode: boolean): Layer[] {
  const layers: Layer[] = [];
  if (state.sheet) layers.push({ id: 'sheet', close: () => state.setSheet(null), selectors: ['.sheet[aria-label="Действия с объектом"]', ANY_SHEET] });
  if (state.toolsMoreOpen) layers.push({ id: 'toolsMore', close: () => state.setToolsMoreOpen(false), selectors: ['.tool-sheet'] });
  if (state.exportOpen) layers.push({ id: 'export', close: () => state.setExportOpen(false), selectors: ['.sheet[aria-label="Экспорт и копия"]', ANY_SHEET] });
  if (state.historyOpen) layers.push({ id: 'history', close: () => state.setHistoryOpen(false), selectors: ['.sheet[aria-label="История версий"]', ANY_SHEET] });
  if (state.aboutOpen) layers.push({ id: 'about', close: () => state.setAboutOpen(false), selectors: ['.about-sheet', '.about-backdrop .sheet'] });
  if (state.projects) layers.push({ id: 'projects', close: () => state.setProjects(null), selectors: ['.modal-backdrop .modal:not(.template-modal):not(.onboarding-modal)', ANY_MODAL] });
  if (state.templatesOpen) layers.push({ id: 'templates', close: () => state.setTemplatesOpen(false), selectors: ['.template-modal', ANY_MODAL] });
  if (state.onboardingOpen) layers.push({ id: 'onboarding', close: () => state.setOnboardingOpen(false), selectors: ['.onboarding-modal', ANY_MODAL] });
  // Drawer'ы — слои только на узком экране; на широком они статичные колонки.
  if (drawerMode) {
    if (state.propsOpen) layers.push({ id: 'props', close: () => state.setPropsOpen(false), selectors: ['.properties'] });
    if (state.menuOpen) layers.push({ id: 'menu', close: () => state.setMenuOpen(false), selectors: ['.sidebar'] });
  }
  return layers;
}

function findLayerElement(layer: Layer): HTMLElement | null {
  for (const selector of layer.selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

function readDrawerMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof window.matchMedia === 'function') return window.matchMedia(DRAWER_QUERY).matches;
    return window.innerWidth <= 1023;
  } catch {
    return false;
  }
}

/** Следит за breakpoint, на котором сайдбар и свойства становятся off-canvas. */
function useDrawerMode(): boolean {
  const [drawerMode, setDrawerMode] = useState(readDrawerMode);
  useEffect(() => {
    let media: MediaQueryList | null = null;
    try {
      media = typeof window.matchMedia === 'function' ? window.matchMedia(DRAWER_QUERY) : null;
    } catch {
      media = null;
    }
    if (!media) {
      const onResize = () => setDrawerMode(readDrawerMode());
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    setDrawerMode(media.matches);
    const onChange = (event: MediaQueryListEvent) => setDrawerMode(event.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return drawerMode;
}

function supportsInert(): boolean {
  return typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;
}

function rememberAttribute(stamps: Map<HTMLElement, Stamp>, element: HTMLElement, name: string): void {
  let stamp = stamps.get(element);
  if (!stamp) {
    stamp = { attributes: new Map(), tabStops: new Map() };
    stamps.set(element, stamp);
  }
  if (!stamp.attributes.has(name)) stamp.attributes.set(name, element.getAttribute(name));
}

function setLayerAttribute(stamps: Map<HTMLElement, Stamp>, element: HTMLElement, name: string, value: string | null): void {
  rememberAttribute(stamps, element, name);
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function restoreStamps(stamps: Map<HTMLElement, Stamp>): void {
  for (const [element, stamp] of stamps) {
    for (const [name, value] of stamp.attributes) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    for (const [node, value] of stamp.tabStops) {
      if (value === null) node.removeAttribute('tabindex');
      else node.setAttribute('tabindex', value);
    }
  }
  stamps.clear();
}

/** Убирает закрытую панель из Tab-порядка и accessibility tree. */
function makeInert(stamps: Map<HTMLElement, Stamp>, element: HTMLElement): void {
  setLayerAttribute(stamps, element, 'inert', '');
  setLayerAttribute(stamps, element, 'aria-hidden', 'true');
  // Старые WebView не знают inert: убираем потомков из Tab-порядка вручную.
  if (supportsInert()) return;
  let stamp = stamps.get(element);
  if (!stamp) {
    stamp = { attributes: new Map(), tabStops: new Map() };
    stamps.set(element, stamp);
  }
  for (const node of element.querySelectorAll<HTMLElement>(FALLBACK_FOCUSABLE)) {
    if (!stamp.tabStops.has(node)) stamp.tabStops.set(node, node.getAttribute('tabindex'));
    node.setAttribute('tabindex', '-1');
  }
}

function styleOf(element: Element): CSSStyleDeclaration | null {
  try {
    const view = element.ownerDocument?.defaultView;
    return view?.getComputedStyle ? view.getComputedStyle(element) : null;
  } catch {
    return null;
  }
}

/** Элемент реально отрисован: не спрятан атрибутом hidden или CSS предка. */
function isRendered(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return false;
    const style = styleOf(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    if (node === element.ownerDocument?.body) break;
  }
  return true;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(node => typeof node.focus === 'function' && node.tabIndex >= 0 && !node.hasAttribute('disabled') && !node.closest('[inert]') && isRendered(node));
}

function focusLayerRoot(stamps: Map<HTMLElement, Stamp>, element: HTMLElement): void {
  setLayerAttribute(stamps, element, 'tabindex', '-1');
  element.focus();
}

function focusInside(stamps: Map<HTMLElement, Stamp>, element: HTMLElement): void {
  const items = focusables(element);
  if (items.length) items[0].focus();
  else focusLayerRoot(stamps, element);
}

function restoreFocus(opener: HTMLElement | null): void {
  if (!opener || !opener.isConnected || typeof opener.focus !== 'function') return;
  try {
    opener.focus({ preventScroll: true });
  } catch {
    opener.focus();
  }
}

/** Инициатор слоя — элемент, с которого открыли шторку; body фокусом не считаем. */
function openerOf(element: HTMLElement): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || typeof active.focus !== 'function') return null;
  return element.contains(active) ? null : active;
}

/** Помечает открытый слой модальным; role="dialog" нужен, чтобы aria-modal был валиден. */
function markModal(stamps: Map<HTMLElement, Stamp>, element: HTMLElement): void {
  setLayerAttribute(stamps, element, 'aria-modal', 'true');
  const role = element.getAttribute('role');
  if (role !== 'dialog' && role !== 'alertdialog') setLayerAttribute(stamps, element, 'role', 'dialog');
}

export function useLayerFocus(state: WorkspaceState): void {
  const drawerMode = useDrawerMode();
  const layers = buildLayers(state, drawerMode);
  const layersRef = useRef<Layer[]>(layers);
  layersRef.current = layers;
  const signature = layers.map(layer => layer.id).join('|');
  const activeRef = useRef<ActiveLayer | null>(null);
  const stampsRef = useRef(new Map<HTMLElement, Stamp>());

  // Атрибуты и фокус пересчитываются только при смене набора слоёв или breakpoint.
  useEffect(() => {
    const top = layersRef.current[0] ?? null;
    const element = top ? findLayerElement(top) : null;
    const previous = activeRef.current;
    const stamps = stampsRef.current;

    restoreStamps(stamps);

    // 1. Закрытые (и оказавшиеся под модальным слоем) панели — вне Tab-порядка.
    if (drawerMode) {
      for (const drawer of document.querySelectorAll<HTMLElement>('.sidebar, .properties')) {
        const id: LayerId = drawer.classList.contains('sidebar') ? 'menu' : 'props';
        if (top?.id !== id) makeInert(stamps, drawer);
      }
    }

    // 2. Открытый слой модальный: aria-modal и подходящая роль.
    if (element) markModal(stamps, element);

    // 3. Фокус: возврат инициатору при закрытии, перевод внутрь при открытии.
    if (!element || !top) {
      activeRef.current = null;
      if (previous) restoreFocus(previous.opener);
      return;
    }
    if (previous && previous.id === top.id && previous.element === element) {
      activeRef.current = previous;
      return;
    }
    // При переходе между слоями инициатора наследуем от предыдущего слоя.
    const opener = previous ? previous.opener : openerOf(element);
    activeRef.current = { id: top.id, element, opener };
    if (!element.contains(document.activeElement)) focusInside(stamps, element);
  }, [signature, drawerMode]);

  // Tab/Shift+Tab — только внутри верхнего слоя, Escape — закрыть его.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const top = layersRef.current[0];
      if (!top) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        // Гасим событие до фоновых обработчиков (Escape на плане отменяет черчение).
        event.stopPropagation();
        top.close();
        return;
      }
      if (event.key !== 'Tab') return;
      const element = findLayerElement(top);
      if (!element) return;
      const stamps = stampsRef.current;
      const items = focusables(element);
      if (!items.length) {
        event.preventDefault();
        focusLayerRoot(stamps, element);
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (!active || !element.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
        return;
      }
      const index = items.indexOf(active);
      if (index === -1) {
        event.preventDefault();
        items[0].focus();
        return;
      }
      if (event.shiftKey && index === 0) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && index === items.length - 1) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // UX-02: системная кнопка «Назад» сначала спрашивает веб-часть.
  useEffect(() => {
    const target = window as NativeHostWindow;
    const handler: WebBackHandler = () => {
      const top = layersRef.current[0];
      if (!top) return false;
      top.close();
      return true;
    };
    target.__anooplanHandleBack = handler;
    return () => {
      if (target.__anooplanHandleBack === handler) delete target.__anooplanHandleBack;
    };
  }, []);

  // Снимаем все временные атрибуты при размонтировании приложения.
  useEffect(() => () => restoreStamps(stampsRef.current), []);
}
