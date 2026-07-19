import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Configuración plana (ESLint 9). El proyecto no tenía ESLint: `npm run lint`
 * solo corría `tsc`. El chequeo de tipos se mantiene aparte (`npm run
 * typecheck`); ESLint cubre lo que el compilador no ve — sobre todo las reglas
 * de hooks de React, que es donde se cuelan los bugs de dependencias.
 */
export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'qa/reports', 'supabase/functions', '*.tsbuildinfo'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Un `_` al inicio marca un argumento/variable que se ignora a propósito.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // ── Calibración para un código que ya existe ────────────────────────
      // ESLint entra a un proyecto de ~250 archivos ya escritos. Si estas
      // reglas quedan en `error`, `npm run lint` falla desde el primer día y
      // deja de servir como señal (nadie distingue lo nuevo de la deuda).
      // Van como `warning`: se ven, no bloquean. Lo que queda en `error` es
      // lo que sí rompe en ejecución.
      '@typescript-eslint/no-explicit-any': 'warn',
      // `catch {}` vacío es un idioma deliberado del proyecto: hay APIs del
      // navegador (AudioContext, clipboard) cuyo fallo no debe romper nada.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `let x: T` asignada una sola vez pero DESPUÉS de definirla es
      // necesaria cuando un callback declarado antes la referencia
      // (p. ej. los canales de Supabase Realtime).
      'prefer-const': ['error', { destructuring: 'all', ignoreReadBeforeAssign: true }],

      // eslint-plugin-react-hooks v7 trae las reglas del React Compiler, que
      // son mucho más estrictas que las clásicas y marcan patrones que hoy
      // funcionan (p. ej. setState dentro de un efecto). Backlog, no bloqueo.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // `rules-of-hooks` y `exhaustive-deps` sí quedan como están: son las que
      // atrapan bugs de verdad.
    },
  },
  // Scripts y bots de QA: corren en Node, no en el navegador.
  {
    files: ['qa/**/*.{ts,mjs,js}', '*.config.{js,ts,mjs}', 'scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
    rules: {
      // Idiomas de Playwright que ESLint malinterpreta:
      //  · `async ({}, testInfo) => {}` — fixture vacío a propósito.
      //  · el fixture se llama `use`, y la regla lo confunde con un hook de React.
      'no-empty-pattern': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
);
