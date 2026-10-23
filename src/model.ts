export interface Point { x:number; y:number }
export interface Floor { id:string; name:string; elevation:number|null; metersPerUnit:number|null; pdfId?:string; page:number; width:number; height:number }
export interface Equipment {
  id:string; number:string; name:string; type:string; floorId:string; x:number; y:number;
  height:number|null; note:string; properties:Record<string,string>; photos?:string[];
  /** Цвет иконки на плане (#rrggbb). null/undefined — цвет по умолчанию для типа. */
  color?: string | null;
}
export interface Vertex { id:string; floorId:string; x:number; y:number; height:number|null }
export interface Segment { id:string; a:Vertex; b:Vertex; mode:'orthogonal'|'spatial'; reservePercent:number; reserveFixed:number }
export interface Route {
  id:string; number:string; type:string; segments:Segment[]; note:string;
  /** Ширина лотка, мм. null/undefined — размер неизвестен, заполнение не считается. */
  trayWidthMm?: number | null;
  /** Высота борта лотка, мм. null/undefined — размер неизвестен. */
  trayHeightMm?: number | null;
  /** Площадь сечения лотка, мм². Если задана, приоритетнее ширины и высоты. */
  trayAreaMm2?: number | null;
}
export interface Pin { id:string; number:string; floorId:string; x:number; y:number; comment:string; status:'open'|'closed'; photos?:string[]; createdAt:string; updatedAt:string }
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
export interface ProjectDocument { compiledBy?:string; checkedBy?:string; date?:string }
export interface Project { schemaVersion:1|2; id:string; name:string; floors:Floor[]; equipment:Equipment[]; routes:Route[]; cables:Cable[]; pins:Pin[]; updatedAt:string; document?:ProjectDocument }
