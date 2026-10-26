import type { Project } from './model';
import { createDemoProject } from './demo';
import { cloneValue as clone } from './compat';
import { createUuid as uid } from './compat';
import { freshProject } from './ui/project-factory';

export const CUSTOM_TEMPLATES_KEY = 'cableplan:templates';

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  project: Project;
}

/** Хранилище кастомных шаблонов; шаблон хранит только структуру, без PDF и фото. */
export interface TemplateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TemplateStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Копия проекта без вложений: шаблон не должен тянуть PDF/фото из чужого проекта. */
export function templateProject(project: Project, name?: string): Project {
  const next = clone(project);
  next.id = uid();
  next.name = name ?? project.name;
  next.updatedAt = new Date().toISOString();
  next.floors = next.floors.map(floor => ({ ...floor, pdfId: undefined }));
  next.equipment = next.equipment.map(item => ({ ...item, photos: [] }));
  next.pins = (next.pins ?? []).map(item => ({ ...item, photos: [] }));
  next.document = project.document ? { ...project.document, changeLog: [] } : undefined;
  return next;
}

/** Первый этаж демо-проекта без второго: используется шаблонами «Склад»/«Периметр». */
function oneFloorDemo(name: string, keep: (number: string) => boolean): Project {
  const demo = createDemoProject();
  const next = templateProject(demo, name);
  const floor = next.floors[0];
  next.floors = [floor];
  const equipment = next.equipment.filter(item => item.floorId === floor.id && keep(item.number));
  const ids = new Set(equipment.map(item => item.id));
  next.equipment = equipment;
  next.routes = next.routes.filter(route => route.segments.every(segment => segment.a.floorId === floor.id && segment.b.floorId === floor.id));
  const routeIds = new Set(next.routes.flatMap(route => route.segments.map(segment => segment.id)));
  next.cables = next.cables.filter(cable => ids.has(cable.fromId) && ids.has(cable.toId) && cable.segmentIds.every(id => routeIds.has(id)));
  next.pins = (next.pins ?? []).filter(pin => pin.floorId === floor.id);
  return next;
}

/** Встроенные шаблоны: пустой, офис, склад, периметр. */
export function builtInTemplates(): ProjectTemplate[] {
  const office = templateProject(createDemoProject(), 'Офис');
  const warehouse = oneFloorDemo('Склад', number => ['Ш1', 'К1', 'К2', 'К3', 'Р1'].includes(number));
  const perimeter = oneFloorDemo('Периметр', number => ['Ш1', 'К1', 'К2', 'К3'].includes(number));
  return [
    { id: 'blank', name: 'Пустой проект', description: 'Один этаж без объектов — начать с нуля.', builtIn: true, project: freshProject() },
    { id: 'office', name: 'Офис', description: '2 этажа, 7 единиц оборудования, 3 трассы и 4 кабеля.', builtIn: true, project: office },
    { id: 'warehouse', name: 'Склад', description: '1 этаж, шкаф, камеры и розетка; трассы и кабели первого этажа.', builtIn: true, project: warehouse },
    { id: 'perimeter', name: 'Периметр', description: '1 этаж, шкаф и три камеры — быстрый старт видеонаблюдения.', builtIn: true, project: perimeter },
  ];
}

/** Создаёт проект из шаблона с новым id и (опционально) именем. */
export function instantiateTemplate(template: ProjectTemplate, name?: string): Project {
  const width = template.project.floors[0]?.width ?? 1000;
  const project = templateProject(template.project, name ?? (template.id === 'blank' ? 'Новый проект' : template.name));
  // Пустой шаблон может быть сохранён до появления этажа — гарантируем этаж.
  if (!project.floors.length) project.floors = freshProject().floors;
  if (!project.floors.every(floor => floor.width > 0 && floor.height > 0)) {
    project.floors = project.floors.map(floor => ({ ...floor, width: floor.width || width, height: floor.height || 700 }));
  }
  return project;
}

/** Кастомные шаблоны из localStorage; повреждённое хранилище не ломает запуск. */
export function readCustomTemplates(storage: TemplateStorage | null = defaultStorage()): ProjectTemplate[] {
  try {
    const raw = storage?.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((item): item is ProjectTemplate => Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item && 'project' in item));
  } catch { return []; }
}

/** Сохраняет текущий проект как кастомный шаблон (без вложений). */
export function saveCustomTemplate(project: Project, name: string, storage: TemplateStorage | null = defaultStorage()): ProjectTemplate {
  const template: ProjectTemplate = {
    id: `custom-${uid()}`,
    name: name.trim() || project.name,
    description: `Сохранён из проекта «${project.name}».`,
    builtIn: false,
    project: templateProject(project, name.trim() || project.name),
  };
  const list = readCustomTemplates(storage).filter(item => item.id !== template.id);
  storage?.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify([...list, template]));
  return template;
}

export function deleteCustomTemplate(id: string, storage: TemplateStorage | null = defaultStorage()): void {
  storage?.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(readCustomTemplates(storage).filter(item => item.id !== id)));
}
