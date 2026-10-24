import type { Project } from '../model';

/** Свободное обозначение копии: «T1-копия», «T1-копия 2», … */
export function uniqueNumber(base: string, used: Set<string>): string {
  let candidate = `${base}-копия`;
  let index = 2;
  while (used.has(candidate)) candidate = `${base}-копия ${index++}`;
  return candidate;
}

/** Следующий свободный номер замечания «З-N». */
export function nextPinNumber(project: Project): string {
  const used = new Set(project.pins.map(item => item.number));
  let number = project.pins.length + 1;
  while (used.has(`З-${number}`)) number += 1;
  return `З-${number}`;
}
