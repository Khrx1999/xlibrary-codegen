// @ts-check
/**
 * ESLint 9 flat config for xlibrary.
 *
 * Strategy:
 *   - js.configs.recommended applies everywhere (TS + JS)
 *   - typescript-eslint recommendedTypeChecked applies ONLY to **\/*.ts
 *     (it requires a tsconfig project; the config file itself is JS)
 *   - eslint-config-prettier last to disable stylistic rules Prettier owns
 *   - vendor/, dist/, snapshots, fixtures are not linted
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // ── Ignore generated / vendored / test data ─────────────────────────
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'vendor/**',
      'tools/viewer/**',
      'coverage/**',
      'tests/snapshots/**',
      'tests/fixtures/**',
    ],
  },

  // ── Baseline: applies to .ts and .js alike ──────────────────────────
  js.configs.recommended,

  // ── Type-checked TS lint — ONLY for .ts files in the project ────────
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Error: catch real bugs ────────────────────────────────────────
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // ── Allow underscore-prefixed unused (exhaustiveness sentinels, discards) ──
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-unused-vars': 'off',

      // ── CLI tool: console output is the primary UX ────────────────────
      'no-console': 'off',

      // ── Pragmatic: bundle-patcher needs `any` casts; warn elsewhere ──
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── Looser rules for bundle-patcher (low-level monkey patching) ─────
  {
    files: ['src/recorder/bundle-patcher.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-var': 'off', // global type augmentation needs `var`
    },
  },

  // ── Tests: relax type-safety where mocks blur shape ─────────────────
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ── Prettier compat — MUST be last to disable stylistic rules ───────
  prettier,
);
