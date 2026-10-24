export interface Point { x:number; y:number }
export interface Floor { id:string; name:string; elevation:number|null; metersPerUnit:number|null; pdfId?:string; page:number; width:number; height:number }
export interface Equipment {
  id:string; number:string; name:string; type:string; floorId:string; x:number; y:number;
  height:number|null; note:string; properties:Record<string,string>; photos?:string[];
  /** Цвет иконки на плане (#rrggbb). null/undefined — цвет по умолчанию для типа. */
  color?: string | null;
}
export interface Vertex { id:string; floorId:string; x:number; y:number; height:number|null }
/**
 * Сегмент трассы. Размеры КНС необязательны: если поле задано, оно переопределяет
 * размер трассы для этого участка (в одной трассе могут быть разные лотки/трубы).
 */
export interface Segment {
  id:string; a:Vertex; b:Vertex; mode:'orthogonal'|'spatial'; reservePercent:number; reserveFixed:number;
  /** Ширина/внутренний диаметр КНС на сегменте, мм. Не задано — размер трассы. */
  trayWidthMm?: number | null;
  /** Высота борта лотка/короба на сегменте, мм. Не задано — размер трассы. */
  trayHeightMm?: number | null;
  /** Площадь сечения КНС на сегменте, мм². Приоритетнее ширины и высоты. */
  trayAreaMm2?: number | null;
}
/** Подсистема СКС: горизонтальная, магистральная или рабочее место. */
export type RouteSubsystem = 'horizontal' | 'trunk' | 'workplace';
export interface Route {
  id:string; number:string; type:string; segments:Segment[]; note:string;
  /** Подсистема СКС (необязательно; старые проекты её не имеют). */
  subsystem?: RouteSubsystem;
  /** Цвет трассы (#rrggbb). null/undefined — цвет по умолчанию для типа КНС. */
  color?: string | null;
  /** Ширина лотка, мм. null/undefined — размер неизвестен, заполнение не считается. */
  trayWidthMm?: number | null;
  /** Высота борта лотка, мм. null/undefined — размер неизвестен. */
  trayHeightMm?: number | null;
  /** Площадь сечения лотка, мм². Если задана, приоритетнее ширины и высоты. */
  trayAreaMm2?: number | null;
}
export interface Pin { id:string; number:string; floorId:string; x:number; y:number; comment:string; status:'open'|'closed'; photos?:string[]; createdAt:string; updatedAt:string }
/** Размер между двумя объектами оборудования: показывается на плане и в PDF. */
export interface Dimension { id:string; fromId:string; toId:string; note?:string }
export interface Cable {
  id:string; number:string; name:string; brand:string; purpose:string;
  fromId:string; toId:string; segmentIds:string[];
  reservePercent:number; reserveFixed:number; startReserve:number; endReserve:number;
  quantity:number; note:string; pricePerMeter?:number;
  /** Внешний диаметр кабеля, мм. null/undefined — неизвестен. */
  outerDiameterMm?: number | null;
  /** Площадь сечения кабеля по внешнему диаметру, мм². Если задана, приоритетнее диаметра. */
  crossSectionMm2?: number | null;
}

/** Вид позиции справочника цен: оборудование, кабель или кабеленесущая система. */
export type PriceKind = 'equipment' | 'cable' | 'tray';

/** Позиция справочника цен проекта. Хранится в проекте, поэтому переживает офлайн, снапшоты и JSON-копию. */
export interface PriceItem {
  id: string;
  kind: PriceKind;
  /** Модель оборудования, марка кабеля или тип трассы. Сопоставление — без учёта регистра и пробелов по краям. */
  name: string;
  /** Единица измерения: «шт», «м» и т.п. */
  unit: string;
  /** Цена за единицу, ₽. null — цена неизвестна, а не 0. */
  price: number | null;
  note: string;
  /** Производитель и артикул — для спецификации КНС (необязательные поля). */
  manufacturer?: string;
  article?: string;
  series?: string;
  /** Типоразмер/сечение, например «Ø20» или «100×50». */
  size?: string;
}

/** Настройки сметы проекта. Работы считаются процентом от стоимости материалов. */
export interface ProjectEstimate {
  laborPercent: number | null;
  note?: string;
}
/** Запись листа регистрации изменений (печатные формы 1.18.0). */
export interface ChangeEntry {
  id: string;
  /** Номер изменения/версия, например «1». */
  version: string;
  /** Дата изменения; свободная строка, обычно YYYY-MM-DD. */
  date: string;
  /** Кто внёс изменение. */
  author: string;
  /** Что изменено. */
  description: string;
}

export interface ProjectDocument {
  compiledBy?:string; checkedBy?:string; date?:string;
  /** Титульный лист: организация, объект, шифр документа, город. */
  organization?:string; object?:string; documentCode?:string; city?:string;
  /** Заголовок документа на титульном листе; по умолчанию «Кабельный журнал и смета». */
  title?:string;
  /** Лист регистрации изменений. */
  changeLog?:ChangeEntry[];
}
export interface Project {
  schemaVersion:1|2; id:string; name:string; floors:Floor[]; equipment:Equipment[];
  routes:Route[]; cables:Cable[]; pins:Pin[]; dimensions?:Dimension[]; updatedAt:string; document?:ProjectDocument;
  /** Справочник цен проекта. Отсутствие трактуется как пустой справочник. */
  catalog?: PriceItem[];
  /** Дата актуальности прайса (YYYY-MM-DD), показывается в смете и КП. */
  catalogDate?: string | null;
  /** Настройки сметы: процент работ и примечание. */
  estimate?: ProjectEstimate;
}
