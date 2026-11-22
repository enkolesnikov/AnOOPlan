import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import React from 'react';
import {
  NEGATIVE_ERROR,
  NUMBER_ERROR,
  NumberField,
  parseNumberInput,
  reduceNumberField,
} from '../src/ui/number-field';

/**
 * Числовое поле: разбор ввода, переход состояния и видимая обратная связь.
 * Компонент рендерим через react-dom в happy-dom. Важно: react-dom подключаем
 * после установки window/document — иначе его делегирование input-событий
 * (нужное для onChange) инициализируется без DOM. Невалидный ввод не стирается
 * молча: поле показывает ошибку, а модель хранит последнее валидное значение.
 */

test('parseNumberInput: запятая, пробелы, минус и мусор', () => {
  assert.deepEqual(parseNumberInput(''), { kind: 'empty' });
  assert.deepEqual(parseNumberInput('   '), { kind: 'empty' });
  assert.deepEqual(parseNumberInput('12,5'), { kind: 'valid', value: 12.5, raw: '12.5' });
  assert.deepEqual(parseNumberInput(' 1 000 '), { kind: 'valid', value: 1000, raw: '1000' });
  assert.deepEqual(parseNumberInput('0'), { kind: 'valid', value: 0, raw: '0' });
  assert.deepEqual(parseNumberInput('-0'), { kind: 'valid', value: 0, raw: '-0' });
  assert.deepEqual(parseNumberInput('abc'), { kind: 'invalid', message: NUMBER_ERROR });
  assert.deepEqual(parseNumberInput('-5'), { kind: 'invalid', message: NEGATIVE_ERROR });
  assert.deepEqual(parseNumberInput('1,2,3'), { kind: 'invalid', message: NUMBER_ERROR });
  assert.deepEqual(parseNumberInput('1e3'), { kind: 'invalid', message: NUMBER_ERROR });
  assert.deepEqual(parseNumberInput('--1'), { kind: 'invalid', message: NUMBER_ERROR });
});

test('reduceNumberField: невалидный ввод сохраняет последнее валидное значение', () => {
  assert.deepEqual(reduceNumberField(20, 'abc'), { value: 20, commit: null, error: NUMBER_ERROR });
  assert.deepEqual(reduceNumberField(20, '-5'), { value: 20, commit: null, error: NEGATIVE_ERROR });
  assert.deepEqual(reduceNumberField(20, '1,2,3'), { value: 20, commit: null, error: NUMBER_ERROR });
  assert.deepEqual(reduceNumberField(20, '30,5'), { value: 30.5, commit: '30.5', error: null });
  assert.deepEqual(reduceNumberField(20, ''), { value: null, commit: '', error: null });
});

test('NumberField: ошибка видна, aria-invalid, последнее валидное значение не теряется', async () => {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  // После window/document: React DOM ловит input-события через document/window.
  const { createRoot } = await import('react-dom/client');

  const committed: string[] = [];
  const container = window.document.createElement('div') as unknown as Parameters<typeof createRoot>[0];
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(NumberField, { value: 20, ariaLabel: 'НДС, %', onCommit: raw => committed.push(raw) }));
  });
  const host = container as unknown as HTMLElement;
  const input = (): HTMLInputElement => {
    const element = host.querySelector('input');
    assert.ok(element, 'поле не отрисовано');
    return element;
  };
  const type = async (value: string): Promise<void> => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    assert.ok(setter);
    setter.call(input(), value);
    await React.act(async () => { input().dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event); });
  };

  assert.equal(input().value, '20');
  assert.equal(input().getAttribute('aria-label'), 'НДС, %');
  assert.equal(input().getAttribute('aria-invalid'), null);

  // «abc» не коммитится и не стирается: ввод остаётся, рядом — ошибка.
  await type('abc');
  assert.equal(committed.length, 0, 'невалидный ввод не должен менять модель');
  assert.equal(input().value, 'abc');
  assert.equal(input().getAttribute('aria-invalid'), 'true');
  assert.equal(input().getAttribute('title'), NUMBER_ERROR);
  const describedBy = input().getAttribute('aria-describedby');
  assert.ok(describedBy);
  const hint = [...host.querySelectorAll('.field-error')].find(element => element.id === describedBy);
  assert.ok(hint, 'aria-describedby должен указывать на видимую подсказку');
  assert.equal(hint.getAttribute('role'), 'alert');
  assert.equal(hint.textContent, NUMBER_ERROR);

  // Отрицательное число — отдельная понятная ошибка, модель по-прежнему 20.
  await type('-5');
  assert.equal(committed.length, 0);
  assert.equal(input().getAttribute('aria-invalid'), 'true');
  assert.equal(host.querySelector('.field-error')?.textContent, NEGATIVE_ERROR);

  // Уход из поля не стирает ввод молча: текст и ошибка остаются на месте.
  await React.act(async () => { input().dispatchEvent(new window.Event('blur', { bubbles: true }) as unknown as Event); });
  assert.equal(input().value, '-5');
  assert.equal(host.querySelector('.field-error')?.textContent, NEGATIVE_ERROR);

  // Корректное значение снимает ошибку и коммитится последним.
  await type('30,5');
  assert.deepEqual(committed, ['30.5']);
  assert.equal(input().getAttribute('aria-invalid'), null);
  assert.equal(host.querySelector('.field-error'), null);
  assert.equal(input().value, '30,5');

  // Очистка поля — явное «не задано», а не ошибка.
  await type('');
  assert.deepEqual(committed, ['30.5', '']);
  assert.equal(input().getAttribute('aria-invalid'), null);

  await React.act(async () => { root.unmount(); });
  window.close();
});
