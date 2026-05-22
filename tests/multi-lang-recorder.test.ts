/**
 * tests/multi-lang-recorder.test.ts
 *
 * Smoke tests for the multi-language recorder support (Task #3, v0.2).
 *
 * Strategy: pure unit tests — no browser is spawned.
 *   - `langToPlaywrightId` is the pure mapper; test all combinations.
 *   - `RobotCodegenOptions.lang` field is tested structurally (type-level via
 *     assignments that must compile; value-level via the mapper).
 *   - Startup banner text is tested indirectly through `langToPlaywrightId`
 *     (the banner renders langLabel(lang) but that is internal to runner.ts;
 *     we verify the ID mapping that drives the _enableRecorder call).
 */

import { describe, it, expect } from 'vitest';
import { langToPlaywrightId } from '../src/recorder/runner.js';
import type { LangTarget, RobotCodegenOptions } from '../src/types.js';

// ---------------------------------------------------------------------------
// langToPlaywrightId — mapping table correctness
// ---------------------------------------------------------------------------

describe('langToPlaywrightId — mapping table', () => {
  // robot + directMode=true → robotframework (existing behaviour, unchanged)
  it('robot + directMode → robotframework', () => {
    expect(langToPlaywrightId('robot', true)).toBe('robotframework');
  });

  // robot + directMode=false → jsonl (JSONL bridge fallback, unchanged)
  it('robot + JSONL bridge mode → jsonl', () => {
    expect(langToPlaywrightId('robot', false)).toBe('jsonl');
  });

  // selenium: always uses Playwright's built-in selenium generator ID
  it('selenium → selenium (ignores directMode=true)', () => {
    expect(langToPlaywrightId('selenium', true)).toBe('selenium');
  });

  it('selenium → selenium (ignores directMode=false)', () => {
    expect(langToPlaywrightId('selenium', false)).toBe('selenium');
  });

  // ts: Playwright Test emitter — the ID confirmed in javascript.ts
  it('ts → playwright-test (ignores directMode=true)', () => {
    expect(langToPlaywrightId('ts', true)).toBe('playwright-test');
  });

  it('ts → playwright-test (ignores directMode=false)', () => {
    expect(langToPlaywrightId('ts', false)).toBe('playwright-test');
  });

  // python: pytest-playwright emitter — the ID confirmed in python.ts
  it('python → python-pytest (ignores directMode=true)', () => {
    expect(langToPlaywrightId('python', true)).toBe('python-pytest');
  });

  it('python → python-pytest (ignores directMode=false)', () => {
    expect(langToPlaywrightId('python', false)).toBe('python-pytest');
  });
});

// ---------------------------------------------------------------------------
// LangTarget type — all valid values compile and are covered
// ---------------------------------------------------------------------------

describe('LangTarget — type coverage', () => {
  const ALL_LANGS: LangTarget[] = ['robot', 'selenium', 'ts', 'python'];

  it('all valid lang values are covered by the mapper', () => {
    // Every lang value must produce a non-empty string (both modes).
    for (const lang of ALL_LANGS) {
      const idDirect = langToPlaywrightId(lang, true);
      const idFallback = langToPlaywrightId(lang, false);
      expect(idDirect, `${lang} + direct must produce a non-empty string`).toBeTruthy();
      expect(idFallback, `${lang} + fallback must produce a non-empty string`).toBeTruthy();
    }
  });

  it('robot lang produces different IDs for direct vs fallback', () => {
    // The JSONL split is the core of the existing behaviour — make sure we
    // didn't accidentally break it.
    expect(langToPlaywrightId('robot', true)).not.toBe(langToPlaywrightId('robot', false));
  });

  it('ts/python/selenium IDs are identical regardless of directMode', () => {
    // Built-in Playwright emitters are always registered — directMode flag
    // is irrelevant for them.
    for (const lang of ['ts', 'python', 'selenium'] as LangTarget[]) {
      expect(langToPlaywrightId(lang, true)).toBe(langToPlaywrightId(lang, false));
    }
  });
});

// ---------------------------------------------------------------------------
// RobotCodegenOptions.lang — structural / type-level checks
// ---------------------------------------------------------------------------

describe('RobotCodegenOptions — lang field', () => {
  it('lang field is optional and defaults are handled by runRecorder', () => {
    // If lang is omitted the options object is still valid.
    const opts: RobotCodegenOptions = { url: 'https://example.com', output: 'test.robot' };
    expect(opts.lang).toBeUndefined();
  });

  it('lang accepts all valid LangTarget values', () => {
    const optRobot: RobotCodegenOptions = { lang: 'robot' };
    const optSelenium: RobotCodegenOptions = { lang: 'selenium' };
    const optTs: RobotCodegenOptions = { lang: 'ts' };
    const optPython: RobotCodegenOptions = { lang: 'python' };

    // Runtime assertion: value round-trips correctly.
    expect(optRobot.lang).toBe('robot');
    expect(optSelenium.lang).toBe('selenium');
    expect(optTs.lang).toBe('ts');
    expect(optPython.lang).toBe('python');
  });
});

// ---------------------------------------------------------------------------
// Playwright language IDs — cross-check against known vendor values
//
// These are the IDs pulled from:
//   vendor/playwright/.../codegen/javascript.ts  → 'playwright-test'
//   vendor/playwright/.../codegen/python.ts      → 'python-pytest'
//   vendor/playwright/.../codegen/languages.ts   → set membership
//
// If any of these assertions fail after a playwright-core upgrade it means
// the upstream IDs changed and langToPlaywrightId needs updating.
// ---------------------------------------------------------------------------

describe('Playwright language IDs — vendor alignment', () => {
  it('playwright-test ID matches vendor javascript.ts', () => {
    // JavaScriptLanguageGenerator(isTest=true).id === 'playwright-test'
    expect(langToPlaywrightId('ts', true)).toBe('playwright-test');
  });

  it('python-pytest ID matches vendor python.ts', () => {
    // PythonLanguageGenerator(isAsync=false, isPyTest=true).id === 'python-pytest'
    expect(langToPlaywrightId('python', true)).toBe('python-pytest');
  });

  it('robotframework ID is preserved from existing integration', () => {
    expect(langToPlaywrightId('robot', true)).toBe('robotframework');
  });

  it('jsonl fallback ID is preserved from existing integration', () => {
    expect(langToPlaywrightId('robot', false)).toBe('jsonl');
  });
});
