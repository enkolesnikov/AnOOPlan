/** Выбранный на плане объект: оборудование, трасса, кабель или замечание. */
export type Selection = { kind: 'equipment' | 'route' | 'cable' | 'pin'; id: string } | null;
/** Активный инструмент планшета. */
export type Tool = 'select' | 'pan' | 'equipment' | 'route' | 'calibrate' | 'cable' | 'measure' | 'pin';
/** Основные экраны приложения. */
export type View = 'plan' | 'journal' | 'specs' | 'estimate';
/** Виды объектов, с которыми работают шторка действий, копирование и удаление. */
export type ObjectKind = 'equipment' | 'route' | 'cable' | 'pin';
/** Вкладки структуры проекта в сайдбаре. */
export type StructureTab = 'floors' | 'equipment' | 'routes' | 'cables' | 'pins';
/** Объект, для которого открыта нижняя шторка действий. */
export type SheetTarget = { kind: ObjectKind; id: string } | null;
