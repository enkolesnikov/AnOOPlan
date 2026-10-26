// Плоский конфиг ESLint (ESLint 10, typescript-eslint 8).
// Цель — зафиксировать осмысленные правила и не допускать новых нарушений,
// а не переписать существующий код под линтер. Файлы, которые в 2.5.0 правят
// параллельные задачи (engine/model/migrations/export/server/UI-хуки), не должны
// требовать правок: правила, конфликтующие с их текущим стилем, точечно отключены
// с пояснением в отчёте. Для остального кода правила действуют.
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'tools/**',
      'android/assets/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'store/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Доступность JSX: роли, alt, aria, клавиатурные обработчики. Правила
  // проверены на текущем коде — новых нарушений быть не должно.
  jsxA11y.flatConfigs.recommended,
  {
    rules: {
      // Числовое поле — наш контрол: label оборачивает <NumberField>, внутри которого <input>.
      'jsx-a11y/label-has-associated-control': ['error', { controlComponents: ['NumberField'], depth: 3 }],
    },
  },
  // Хуки: rules-of-hooks — ошибка (сломанный порядок хуков), exhaustive-deps —
  // предупреждение. Полный recommended v7 включает правила React Compiler, они
  // требуют отдельной миграции и пока не включаются.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      // Playwright-конфиг требует Node-глобалы; сервер — только Node.
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['server/**/*.ts', 'tests/**/*.ts', 'vite.config.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['scripts/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      // Осмысленные правила стиля и безопасности, общие для всех файлов.
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'properties'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // CLI-скрипты — это интерфейс: печатают отчёт в stdout, поэтому console.log
    // для них штатный. Профиксить smoke-dom.mjs нельзя: он в запретном списке.
    files: ['scripts/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // scripts/smoke-dom.mjs (запрещён к правке в 2.5.0) содержит старый
    // `let`-паттерн и присваивание, которое не читается; правил не касаемся.
    files: ['scripts/smoke-dom.mjs'],
    rules: {
      'prefer-const': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    // src/engine.ts правит параллельная задача: здесь `let start` без
    // переприсваивания — снимаем prefer-const точечно, не трогая файл.
    files: ['src/engine.ts'],
    rules: {
      'prefer-const': 'off',
    },
  },
  {
    // server/app.ts и server/validation.ts (запрещены к правке) используют `any`
    // в границах валидации. Правило остаётся включённым для src/, tests/ и scripts/.
    files: ['server/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // В этих UI-файлах (запрещены к правке) есть неиспользуемые деструктурированные
    // переменные — это их текущее состояние. Правило действует на остальной код.
    files: [
      'src/ui/chrome.tsx',
      'src/ui/plan-screen.tsx',
      'src/ui/use-app-effects.ts',
      'src/ui/use-plan-editing.ts',
      'src/ui/use-project-io.ts',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Останов сервера — консольный лог, а не отладочный вывод приложения.
    files: ['server/index.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // DSH-плагин и установщик — Node-скрипты вне бандла приложения.
    files: ['dsh/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
);
