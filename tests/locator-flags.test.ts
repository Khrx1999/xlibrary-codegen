/**
 * Regression tests for the i/s flag handling in src/codegen/locator-translator.ts.
 *
 * Background:
 *   Playwright's recorder emits role/text selectors with case-flag suffixes:
 *     [name="..." i]   — case-insensitive, ALSO implies substring match (when
 *                        prefixed with `internal:`; see vendor roleSelectorEngine.ts:171)
 *     [name="..." s]   — strict (case-sensitive equality) — same as default
 *
 *   Originally the translator stripped only `i` and emitted plain `role=...`,
 *   which silently broke substring matching: a recorded heading like
 *   "Playwright enables reliable" (truncated alternative) would never match
 *   the full-text accessible name because the public `role=` form is exact.
 *
 *   The fix:
 *     - When `i` flag is present → keep `internal:role=` prefix + `i` flag so
 *       Playwright/Browser Library performs substring matching as recorded.
 *     - When `s` flag is present (or no flag) → strip prefix and flag, emit
 *       the idiomatic `role=...[name="..."]` (exact match by default).
 */

import { describe, it, expect } from 'vitest';
import { translateSelector } from '../src/codegen/locator-translator.js';

describe('locator-translator — i flag (substring match)', () => {
  it('keeps internal:role= prefix and i flag when recorder used substring alternative', () => {
    // Playwright recorder emits this when the accessible name is long and it
    // chose the truncated alternative for readability.
    const src = 'internal:role=heading[name="Playwright enables reliable" i]';
    expect(translateSelector(src)).toBe(
      'internal:role=heading[name="Playwright enables reliable" i]',
    );
  });

  it('handles i flag without whitespace before ]', () => {
    expect(translateSelector('internal:role=button[name="Submit"i]')).toBe(
      'internal:role=button[name="Submit"i]',
    );
  });
});

describe('locator-translator — s flag (strict exact match)', () => {
  it('strips s flag and internal: prefix (s = default behavior)', () => {
    const src = 'internal:role=link[name="Writing tests" s]';
    expect(translateSelector(src)).toBe('role=link[name="Writing tests"]');
  });

  it('handles s flag without whitespace', () => {
    expect(translateSelector('internal:role=link[name="Writing tests"s]')).toBe(
      'role=link[name="Writing tests"]',
    );
  });

  it('handles uppercase S flag', () => {
    expect(translateSelector('internal:role=button[name="OK"S]')).toBe('role=button[name="OK"]');
  });
});

describe('locator-translator — no flag (legacy / synthetic)', () => {
  it('strips internal: prefix when no flag present', () => {
    expect(translateSelector('internal:role=button[name="Click me"]')).toBe(
      'role=button[name="Click me"]',
    );
  });
});

describe('locator-translator — non-role selectors are unaffected', () => {
  it('css= passes through untouched', () => {
    expect(translateSelector('css=#submit')).toBe('css=#submit');
  });

  it('xpath= passes through untouched', () => {
    expect(translateSelector('xpath=//button[@id="x"]')).toBe('xpath=//button[@id="x"]');
  });

  it('internal:text= is still simplified to text=', () => {
    expect(translateSelector('internal:text="Submit"')).toBe('text=Submit');
  });

  it('chained selectors split by >> are translated per-part', () => {
    const src = 'internal:role=button[name="Save" i] >> internal:text="Now"';
    expect(translateSelector(src)).toBe('internal:role=button[name="Save" i] >> text=Now');
  });
});

describe('locator-translator — testid with strict/insensitive flag', () => {
  it('strips s flag from testid (data-testid is matched exactly anyway)', () => {
    // Real Playwright recorder output captured from a click on a data-testid element.
    expect(translateSelector('internal:testid=[data-testid="input-email"s]')).toBe(
      '[data-testid="input-email"]',
    );
  });

  it('strips i flag from testid', () => {
    expect(translateSelector('internal:testid=[data-testid="btn-submit" i]')).toBe(
      '[data-testid="btn-submit"]',
    );
  });

  it('still works without any flag', () => {
    expect(translateSelector('internal:testid=[data-testid="form-login"]')).toBe(
      '[data-testid="form-login"]',
    );
  });
});

describe('locator-translator — false positives prevention', () => {
  it('does not strip an "i" that lives inside the quoted text', () => {
    // The word "i" is part of the visible name; it must survive.
    const src = 'internal:role=heading[name="Apple iPhone"s]';
    expect(translateSelector(src)).toBe('role=heading[name="Apple iPhone"]');
  });

  it('does not strip an "s" that lives inside the quoted text', () => {
    const src = 'internal:role=heading[name="Settings"s]';
    expect(translateSelector(src)).toBe('role=heading[name="Settings"]');
  });
});
