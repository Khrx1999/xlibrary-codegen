/**
 * Compatibility test against the bundled playwright-core.
 *
 * Why a separate file from bundle-patcher.test.ts:
 *   - That file exercises the regex transformers against synthetic fixtures
 *     and (for patches #2 and #3) launches a real headless chromium to verify
 *     the runtime wrappers actually fire.
 *   - This file verifies the cheapest, most-failing-prone signal: did the
 *     `Module._compile` regex even MATCH against today's coreBundle.js?
 *
 * That single signal is what regresses silently when a `playwright-core`
 * minor bump renames or reformats the targeted internals. The runtime tests
 * never get to run if the compile-time patches missed, so this is the gate
 * we want to assert first whenever a new playwright-core version lands.
 *
 * Patches #2 (Inspector HTML injection) and #3 (output follows Target) only
 * set their runtime "succeeded" flags when their wrappers actually execute
 * inside the Inspector — verified in `bundle-patcher.test.ts`, not here.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

// Side-effect import installs the Module._compile hook BEFORE playwright-core
// loads — must happen at the very top of this file.
import '../src/recorder/bundle-patcher.js';

import {
  wasBundlePatchSuccessful,
  wasSelectorCandidatesPatchSuccessful,
} from '../src/recorder/bundle-patcher.js';

describe('bundle-patcher compatibility with bundled playwright-core', () => {
  beforeAll(async () => {
    // Triggers coreBundle.js compile under our patched hook.
    await import('playwright-core');
  });

  it('patch #1 (languageSet regex) matches the bundled coreBundle.js', () => {
    // If this fails, Playwright internals have drifted — update the regex
    // in src/recorder/bundle-patcher.ts (patchBundleSource) and re-pin the
    // tested range in package.json.
    expect(wasBundlePatchSuccessful()).toBe(true);
  });

  it('playwright-core version is within the supported range declared in package.json', () => {
    const requireFromHere = createRequire(import.meta.url);
    const pkg = requireFromHere('playwright-core/package.json') as { version: string };

    // Supported range in package.json: ">=1.49.0 <1.61.0".
    // Adjust both this matcher AND the package.json range together.
    expect(pkg.version).toMatch(/^1\.(49|5\d|60)\./);
  });

  it('patch #4 (selectorCandidates regex) matches the bundled coreBundle.js', () => {
    // If this fails, the `_ariaSnapshot` internals in pollingRecorderSource.ts
    // (stored as source5 in coreBundle.js) have drifted. Update the regex
    // patterns in patchSelectorCandidates() in src/recorder/bundle-patcher.ts
    // and re-pin the tested version range in package.json.
    //
    // Both regex targets must match for this to pass:
    //   1. RE_MULTIPLE — the generateSelector call with testIdAttributeName
    //   2. RE_RETURN   — the unique _ariaSnapshot return statement
    expect(wasSelectorCandidatesPatchSuccessful()).toBe(true);
  });
});
