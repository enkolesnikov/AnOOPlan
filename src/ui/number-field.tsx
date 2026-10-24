import { useEffect, useRef, useState } from 'react';

// Числовое поле: принимает и точку, и запятую (русская раскладка) и не теряет ввод.
export function NumberField({ value, onCommit, placeholder, ariaLabel }: {
  value: number | null;
  onCommit: (raw: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const format = (input: number | null): string => (input === null || input === undefined || !Number.isFinite(input) ? '' : String(input));
  const [text, setText] = useState<string>(() => format(value));
  const external = useRef<number | null>(value);
  useEffect(() => {
    if (external.current !== value) { external.current = value; setText(format(value)); }
  }, [value]);
  return <input
    type="text"
    inputMode="decimal"
    autoComplete="off"
    spellCheck={false}
    aria-label={ariaLabel}
    placeholder={placeholder}
    value={text}
    onChange={event => {
      const raw = event.target.value;
      setText(raw);
      const normalized = raw.replace(/,/g, '.').replace(/\s+/g, '');
      if (normalized === '') { external.current = null; onCommit(''); return; }
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) { external.current = parsed; onCommit(normalized); }
    }}
    onBlur={() => setText(format(value))}
  />;
}
