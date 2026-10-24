import { NumberField } from './number-field';

/** Поле формы: числовое (NumberField с запятой) или текстовое. */
export function field(label: string, value: string | number | null, change: (value: string) => void, numeric = false, hint?: string) {
  if (numeric) {
    const current = typeof value === 'number' && Number.isFinite(value) ? value : null;
    return <label className="field">{label}<NumberField value={current} placeholder="Не задано" onCommit={change} />{hint && <small>{hint}</small>}</label>;
  }
  return <label className="field">{label}<input type="text" value={value ?? ''} onChange={e => change(e.target.value)} />{hint && <small>{hint}</small>}</label>;
}
