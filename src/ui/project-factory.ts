import type { Floor, Project } from '../model';
import { createUuid as uid } from '../compat';

/** Новый этаж с параметрами по умолчанию. */
export const freshFloor = (name = 'Этаж 1'): Floor => ({ id: uid(), name, elevation: null, metersPerUnit: null, page: 1, width: 1000, height: 700 });
/** Новый пустой проект. */
export const freshProject = (): Project => ({ schemaVersion: 2, id: uid(), name: 'Новый проект', floors: [freshFloor()], equipment: [], routes: [], cables: [], pins: [], updatedAt: new Date().toISOString() });
