/**
 * bundle-patcher integration test.
 *
 * Verifies the Option B mechanism: rewriting coreBundle.js at Module._compile
 * time so our RobotFrameworkLanguageGenerator is visible to Playwright's
 * recorder via `languageSet()`.
 *
 * Why this lives in tests/ and runs against the REAL bundle:
 *   The whole point of the patch is to survive Playwright's internal bundling.
 *   Mocking the bundle defeats the purpose. We bias toward integration coverage
 *   so an upstream Playwright change that breaks the regex is caught here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Importing bundle-patcher installs the Module._compile hook as a side effect.
// playwright-core is then loaded inside beforeAll() so the hook can intercept it.
import {
  registerLanguageGenerator,
  isBundlePatchApplied,
  wasBundlePatchSuccessful,
  setInspectorInjection,
  wasInspectorPatchSuccessful,
  wasInspectorInjected,
  wasOutputFollowsTargetSuccessful,
} from '../src/recorder/bundle-patcher.js';
import { RobotFrameworkLanguageGenerator } from '../src/codegen/robotframework.js';
import { SeleniumLibraryLanguageGenerator } from '../src/codegen/selenium.js';

const _require = createRequire(import.meta.url);

describe('bundle-patcher (Option B integration)', () => {
  // Force playwright-core to load BEFORE any test runs, so the hook has had a
  // chance to rewrite coreBundle.js. Subsequent tests can then check flags.
  beforeAll(async () => {
    await import('playwright-core');
  });

  it('successfully patched the loaded coreBundle.js', () => {
    expect(wasBundlePatchSuccessful()).toBe(true);
  });

  it('does not modify coreBundle.js on disk (in-memory patch only)', async () => {
    // The package's exports field only exposes the subpath without `.js`.
    const path = _require.resolve('playwright-core/lib/coreBundle');
    const onDisk = await readFile(path, 'utf8');
    expect(onDisk).not.toContain('__xlibExtras');
    expect(onDisk).not.toContain('__xlibrary_inspectorPatchSucceeded');
  });

  it('injects HTML into the Inspector index.html when injection is set', async () => {
    const MARKER = '<div id="xlibrary-test-marker">HELLO_FROM_TEST</div>';
    setInspectorInjection(MARKER);

    const pw = await import('playwright-core');
    const browser = await pw.chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext();
      // Just opening the recorder triggers the Inspector page → triggers
      // the patched route fulfiller → sets our runtime flags.
      await (
        ctx as unknown as {
          _enableRecorder: (p: Record<string, unknown>) => Promise<void>;
        }
      )._enableRecorder({
        language: 'robotframework',
        mode: 'recording',
        launchOptions: {},
        contextOptions: {},
      });
      await new Promise((r) => setTimeout(r, 3000));

      expect(wasInspectorPatchSuccessful()).toBe(true);
      expect(wasInspectorInjected()).toBe(true);
    } finally {
      await browser.close();
      setInspectorInjection(undefined);
    }
  }, 60_000);

  it('registers a generator that the recorder picks up via languageSet()', async () => {
    const gen = new RobotFrameworkLanguageGenerator('Bundle Patcher Test');
    registerLanguageGenerator(gen);

    const pw = await import('playwright-core');
    const browser = await pw.chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext();

      const dir = join(tmpdir(), `xlib-bp-${Date.now()}`);
      await mkdir(dir, { recursive: true });
      const outPath = join(dir, 'out.robot');
      try {
        // _enableRecorder is undocumented but stable — typed via cast.
        await (
          ctx as unknown as {
            _enableRecorder: (params: Record<string, unknown>) => Promise<void>;
          }
        )._enableRecorder({
          language: 'robotframework',
          mode: 'recording',
          outputFile: outPath,
          launchOptions: {},
          contextOptions: {},
        });

        // The recorder's _RecorderApp calls languageSet() in its constructor,
        // which trips our isBundlePatchApplied flag.
        await new Promise((r) => setTimeout(r, 800));
        expect(isBundlePatchApplied()).toBe(true);

        // And it writes Robot Framework output via OUR generator.
        const content = await readFile(outPath, 'utf8');
        expect(content).toContain('*** Settings ***');
        expect(content).toContain('Library    Browser');
        expect(content).toContain('*** Test Cases ***');
        expect(content).toContain('Bundle Patcher Test');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('patch #3 (output file follows Target dropdown) ran in the bundle', async () => {
    // Just opening the recorder exercises the patched setContent line at
    // least once (the empty-actions render still fires setContent with an
    // empty body). If the patched code executes, the runtime flag is set.
    //
    // The full E2E switch-and-verify proof lives in our manual script (see
    // session log) — automating an Inspector dropdown click inside vitest
    // is brittle because the Inspector is in a separate chromium process
    // and ThrottledFile flushes race with the test's read. Verifying the
    // patched line *executed* is enough to catch regex drift after a
    // Playwright upgrade.
    registerLanguageGenerator(new SeleniumLibraryLanguageGenerator('Patch3 Test'));

    const pw = await import('playwright-core');
    const browser = await pw.chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext();
      await (
        ctx as unknown as {
          _enableRecorder: (p: Record<string, unknown>) => Promise<void>;
        }
      )._enableRecorder({
        language: 'robotframework',
        mode: 'recording',
        launchOptions: {},
        contextOptions: {},
      });
      await new Promise((r) => setTimeout(r, 1000));

      expect(wasOutputFollowsTargetSuccessful()).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
