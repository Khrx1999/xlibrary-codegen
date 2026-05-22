/**
 * Integration tests for bundle-patcher warning / fallback paths.
 *
 * The `printBundlePatchWarning` function in runner.ts is called when the
 * bundle patcher regex misses (Playwright version drift). It cannot be
 * called directly (not exported), but the pattern — checking
 * wasBundlePatchSuccessful() / wasInspectorPatchSuccessful() / wasOutputFollowsTargetSuccessful()
 * flags — is what drives the warning banner.
 *
 * This file tests:
 *   1. The three status query functions from bundle-patcher.ts after the
 *      existing tests have loaded playwright-core (they share the same process).
 *   2. registerLanguageGenerator() idempotency and isolation.
 *   3. setInspectorInjection() / wasInspectorInjected() round-trip (state only,
 *      not requiring a browser).
 *   4. installBundlePatch() idempotency — calling it multiple times doesn't
 *      stack the hook.
 *   5. The compat check: playwright-core version in the supported range.
 *
 * Note: bundle-patcher.test.ts already fires up a real browser and asserts
 * the flags are set. These tests layer on top by covering the flag query
 * functions and the state-only behavior without browser launch overhead.
 *
 * Coverage target: src/recorder/bundle-patcher.ts (status queries, registration,
 * injection state, idempotency).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

// Import bundle-patcher BEFORE playwright-core loads
import {
  registerLanguageGenerator,
  isBundlePatchApplied,
  wasBundlePatchSuccessful,
  wasInspectorPatchSuccessful,
  wasOutputFollowsTargetSuccessful,
  setInspectorInjection,
  wasInspectorInjected,
  installBundlePatch,
} from '../../src/recorder/bundle-patcher.js';

// ─────────────────────────────────────────────────────────────────────────────
// Setup: load playwright-core so the compile hook fires
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Ensure playwright-core has been compiled through our hook.
  // Previous test files in the suite also do this — idempotency ensures
  // the hook only runs once even if called multiple times.
  await import('playwright-core');
});

// ─────────────────────────────────────────────────────────────────────────────
// Bundle patch status query functions
// ─────────────────────────────────────────────────────────────────────────────

describe('bundle-patcher — status query functions', () => {
  it('wasBundlePatchSuccessful() returns a boolean', () => {
    expect(typeof wasBundlePatchSuccessful()).toBe('boolean');
  });

  it('wasBundlePatchSuccessful() is true (patch #1 regex matched this playwright-core version)', () => {
    // If this fails, the playwright-core version has drifted beyond the supported range.
    // Update the regex in src/recorder/bundle-patcher.ts and re-pin package.json.
    expect(wasBundlePatchSuccessful()).toBe(true);
  });

  it('wasInspectorPatchSuccessful() returns a boolean', () => {
    // This flag is only set when the Inspector actually serves HTML — not
    // necessarily true in the test process. We only assert the type.
    expect(typeof wasInspectorPatchSuccessful()).toBe('boolean');
  });

  it('wasOutputFollowsTargetSuccessful() returns a boolean', () => {
    expect(typeof wasOutputFollowsTargetSuccessful()).toBe('boolean');
  });

  it('isBundlePatchApplied() returns a boolean', () => {
    // This flag is set only when languageSet() ACTUALLY RUNS inside the recorder,
    // which requires _enableRecorder(). Not required here — test type only.
    expect(typeof isBundlePatchApplied()).toBe('boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerLanguageGenerator
// ─────────────────────────────────────────────────────────────────────────────

describe('bundle-patcher — registerLanguageGenerator()', () => {
  it('does not throw when called with a valid generator-like object', () => {
    const fakeGen = {
      id: 'fake-lang',
      groupName: 'Test',
      name: 'Fake',
      highlighter: 'python',
      generateHeader: () => '',
      generateAction: () => '',
      generateFooter: () => '',
    };
    expect(() => registerLanguageGenerator(fakeGen)).not.toThrow();
  });

  it('does not throw when called multiple times with the same generator', () => {
    const gen = {
      id: 'test-lang',
      generateHeader: () => '',
      generateAction: () => '',
      generateFooter: () => '',
    };
    expect(() => {
      registerLanguageGenerator(gen);
      registerLanguageGenerator(gen);
      registerLanguageGenerator(gen);
    }).not.toThrow();
  });

  it('the global registry is an array after registration', () => {
    registerLanguageGenerator({ id: 'probe' });
    expect(Array.isArray(globalThis.__xlibrary_extraLanguageGenerators)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setInspectorInjection / wasInspectorInjected
// ─────────────────────────────────────────────────────────────────────────────

describe('bundle-patcher — setInspectorInjection()', () => {
  it('does not throw when setting an HTML string', () => {
    expect(() => setInspectorInjection('<div>hello</div>')).not.toThrow();
  });

  it('does not throw when clearing with undefined', () => {
    expect(() => setInspectorInjection(undefined)).not.toThrow();
  });

  it('wasInspectorInjected() returns a boolean', () => {
    expect(typeof wasInspectorInjected()).toBe('boolean');
  });

  it('injection state is stored in globalThis after set', () => {
    setInspectorInjection('<div id="test">TEST</div>');
    expect(globalThis.__xlibrary_inspectorInjection).toBe('<div id="test">TEST</div>');
    // Cleanup
    setInspectorInjection(undefined);
    expect(globalThis.__xlibrary_inspectorInjection).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// installBundlePatch idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe('bundle-patcher — installBundlePatch() idempotency', () => {
  it('returns false when called after initial install (already installed)', () => {
    // The side-effect import at the top of this file already called
    // installBundlePatch() once. Subsequent calls must return false.
    const result = installBundlePatch();
    expect(result).toBe(false);
  });

  it('calling multiple times does not reset the installed flag', () => {
    installBundlePatch();
    installBundlePatch();
    installBundlePatch();
    // Still false — already installed
    expect(installBundlePatch()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// playwright-core version is within supported range
// ─────────────────────────────────────────────────────────────────────────────

describe('bundle-patcher — playwright-core version compatibility', () => {
  it('installed playwright-core version is in the supported range (>=1.49.0 <1.61.0)', () => {
    const requireFromHere = createRequire(import.meta.url);
    const pkg = requireFromHere('playwright-core/package.json') as { version: string };
    // Supported range in package.json: ">=1.49.0 <1.61.0"
    expect(pkg.version).toMatch(/^1\.(49|5\d|60)\./);
  });

  it('playwright-core patch #1 regex matched this version (regression guard)', () => {
    // If this fails after a playwright-core bump, the patcher regex needs updating.
    // The test name is intentionally long to appear clearly in failure reports.
    expect(wasBundlePatchSuccessful()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// coreBundle.js on disk is not modified (safety)
// ─────────────────────────────────────────────────────────────────────────────

describe('bundle-patcher — disk safety', () => {
  it('coreBundle.js on disk does not contain __xlibExtras (in-memory patch only)', async () => {
    const requireFromHere = createRequire(import.meta.url);
    const path = requireFromHere.resolve('playwright-core/lib/coreBundle');
    const { readFile } = await import('node:fs/promises');
    const onDisk = await readFile(path, 'utf8');
    expect(onDisk).not.toContain('__xlibExtras');
    expect(onDisk).not.toContain('__xlibrary_inspectorPatchSucceeded');
    expect(onDisk).not.toContain('__xlibrary_outputFollowsTargetSucceeded');
  });
});
