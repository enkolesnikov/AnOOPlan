import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

/** Результат разбора ввода числового поля: пусто, число или понятная ошибка. */
export type NumberParse =
  | { kind: 'empty' }
  | { kind: 'valid'; value: number; raw: string }
  | { kind: 'invalid'; message: string };

export const NUMBER_ERROR = 'Введите число';
export const NEGATIVE_ERROR = 'Значение не может быть отрицательным';

/**
 * Разбирает ввод числового поля: пробелы-разделители разрядов и запятая
 * как десятичный знак допустимы; буквы, несколько разделителей и минус —
 * нет. Возвращает ошибку, чтобы поле могло показать её, а не стереть ввод.
 */
export function parseNumberInput(input: string): NumberParse {
  if (input.trim() === '') return { kind: 'empty' };
  // «1 000» и «12,5» — обычный ввод на телефоне: убираем пробелы, запятую к точке.
  const raw = input.replace(/\s+/g, '').replace(/,/g, '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return { kind: 'invalid', message: NUMBER_ERROR };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return { kind: 'invalid', message: NUMBER_ERROR };
  if (parsed < 0) return { kind: 'invalid', message: NEGATIVE_ERROR };
  // Минус ноль — то же число, что и ноль: не тащим знак в модель.
  return { kind: 'valid', value: parsed === 0 ? 0 : parsed, raw };
}

/** Переход состояния числового поля: что сохранить в модели и какую ошибку показать. */
export function reduceNumberField(current: number | null, input: string): { value: number | null; commit: string | null; error: string | null } {
  const parsed = parseNumberInput(input);
  if (parsed.kind === 'empty') return { value: null, commit: '', error: null };
  if (parsed.kind === 'valid') return { value: parsed.value, commit: parsed.raw, error: null };
  // Ошибка не меняет модель: последнее валидное значение остаётся в проекте.
  return { value: current, commit: null, error: parsed.message };
}

/** Представление поля: ошибка связана с input через aria-describedby и видна рядом. */
export function NumberFieldView({ text, error, errorId, ariaLabel, placeholder, onChange, onBlur }: {
  text: string;
  error: string | null;
  errorId: string;
  ariaLabel?: string;
  placeholder?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}) {
  return <span className="number-field">
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      title={error ?? undefined}
      className={error ? 'invalid' : undefined}
      placeholder={placeholder}
      value={text}
      onChange={onChange}
      onBlur={onBlur}
    />
    {error ? <span className="field-error" id={errorId} role="alert">{error}</span> : null}
  </span>;
}

// Числовое поле: принимает и точку, и запятую (русская раскладка), сохраняет
// последнее валидное значение и объясняет, почему ввод не принят.
export function NumberField({ value, onCommit, placeholder, ariaLabel }: {
  value: number | null;
  onCommit: (raw: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const format = (input: number | null): string => (input === null || input === undefined || !Number.isFinite(input) ? '' : String(input));
  const [text, setText] = useState<string>(() => format(value));
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const external = useRef<number | null>(value);
  useEffect(() => {
    if (external.current !== value) { external.current = value; setText(format(value)); setError(null); }
  }, [value]);
  return <NumberFieldView
    text={text}
    error={error}
    errorId={errorId}
    ariaLabel={ariaLabel}
    placeholder={placeholder}
    onChange={event => {
      const raw = event.target.value;
      setText(raw);
      const next = reduceNumberField(external.current, raw);
      external.current = next.value;
      setError(next.error);
      if (next.commit !== null) onCommit(next.commit);
    }}
    onBlur={() => { if (!error) setText(format(external.current)); }}
  />;
}
