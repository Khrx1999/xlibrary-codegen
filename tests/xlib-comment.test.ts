/**
 * Tests for src/codegen/xlib-comment.ts
 *
 * Covers:
 *   - formatXlibComment: step only, step + alts, TypeScript prefix, edge cases
 *   - parseXlibComment:  round-trip, Python/TS prefixes, malformed input
 */

import { describe, it, expect } from 'vitest';
import { formatXlibComment, parseXlibComment } from '../src/codegen/xlib-comment.js';

// ---------------------------------------------------------------------------
// formatXlibComment
// ---------------------------------------------------------------------------

describe('formatXlibComment — step only', () => {
  it('emits "# xlib:step=N" with default # prefix', () => {
    expect(formatXlibComment({ step: 1 })).toBe('# xlib:step=1');
  });

  it('step 5 is correct', () => {
    expect(formatXlibComment({ step: 5 })).toBe('# xlib:step=5');
  });

  it('empty alts array → still emits step-only', () => {
    expect(formatXlibComment({ step: 3, alts: [] })).toBe('# xlib:step=3');
  });

  it('undefined alts → step-only', () => {
    expect(formatXlibComment({ step: 2, alts: undefined })).toBe('# xlib:step=2');
  });

  it('TypeScript prefix // works', () => {
    expect(formatXlibComment({ step: 4, prefix: '//' })).toBe('// xlib:step=4');
  });
});

describe('formatXlibComment — step + alts', () => {
  it('single alt produces JSON array', () => {
    const result = formatXlibComment({ step: 1, alts: ['css=#login-btn'] });
    expect(result).toBe('# xlib:step=1;alts=["css=#login-btn"]');
  });

  it('multiple alts are JSON-encoded', () => {
    const result = formatXlibComment({
      step: 3,
      alts: ['css=#id', '[data-testid="submit"]', 'role=button[name="Login"]'],
    });
    expect(result).toBe(
      '# xlib:step=3;alts=["css=#id","[data-testid=\\"submit\\"]","role=button[name=\\"Login\\"]"]',
    );
  });

  it('alts with single quotes are preserved (JSON escapes double quotes only)', () => {
    const result = formatXlibComment({ step: 2, alts: ["[aria-label='Sign in']"] });
    expect(result).toBe(`# xlib:step=2;alts=["[aria-label='Sign in']"]`);
  });

  it('TypeScript prefix with alts', () => {
    const result = formatXlibComment({ step: 7, alts: ['#id', '.btn'], prefix: '//' });
    expect(result).toBe('// xlib:step=7;alts=["#id",".btn"]');
  });
});

// ---------------------------------------------------------------------------
// parseXlibComment
// ---------------------------------------------------------------------------

describe('parseXlibComment — step only', () => {
  it('parses bare step marker', () => {
    expect(parseXlibComment('# xlib:step=1')).toEqual({ step: 1 });
  });

  it('parses step marker with leading 4-space indent', () => {
    expect(parseXlibComment('    # xlib:step=5')).toEqual({ step: 5 });
  });

  it('parses TypeScript // prefix', () => {
    expect(parseXlibComment('  // xlib:step=3')).toEqual({ step: 3 });
  });

  it('returns null for non-xlib comment', () => {
    expect(parseXlibComment('    # TODO: fix this')).toBeNull();
  });

  it('returns null for empty line', () => {
    expect(parseXlibComment('')).toBeNull();
  });

  it('returns null for regular Robot keyword line', () => {
    expect(parseXlibComment('    Click    css=#btn')).toBeNull();
  });
});

describe('parseXlibComment — step + alts', () => {
  it('round-trips step + single alt', () => {
    const formatted = formatXlibComment({ step: 1, alts: ['css=#login-btn'] });
    const parsed = parseXlibComment(formatted);
    expect(parsed).toEqual({ step: 1, alts: ['css=#login-btn'] });
  });

  it('round-trips step + multiple alts', () => {
    const alts = ['css=#id', '[data-testid="submit"]'];
    const formatted = formatXlibComment({ step: 5, alts });
    const parsed = parseXlibComment(formatted);
    expect(parsed).toEqual({ step: 5, alts });
  });

  it('round-trips with TypeScript prefix', () => {
    const formatted = formatXlibComment({ step: 9, alts: ['#id', '.cls'], prefix: '//' });
    const parsed = parseXlibComment('    ' + formatted);
    expect(parsed).toEqual({ step: 9, alts: ['#id', '.cls'] });
  });

  it('round-trips aria-label with single quotes in alt', () => {
    const alts = ["[aria-label='Sign in']"];
    const formatted = formatXlibComment({ step: 2, alts });
    const parsed = parseXlibComment(formatted);
    expect(parsed).toEqual({ step: 2, alts });
  });
});

describe('parseXlibComment — edge cases', () => {
  it('returns null when alts is not a JSON array', () => {
    expect(parseXlibComment('# xlib:step=1;alts=not-json')).toBeNull();
  });

  it('returns null when alts contains non-string elements', () => {
    expect(parseXlibComment('# xlib:step=1;alts=[1,2,3]')).toBeNull();
  });

  it('returns null for step=0 (must be >= 1)', () => {
    expect(parseXlibComment('# xlib:step=0')).toBeNull();
  });

  it('returns null for negative step', () => {
    expect(parseXlibComment('# xlib:step=-1')).toBeNull();
  });

  it('returns null for non-integer step', () => {
    expect(parseXlibComment('# xlib:step=1.5')).toBeNull();
  });

  it('returns null for trailing junk after step (no semicolon)', () => {
    // 'step=3 something' — the step regex requires digits then ';' or end-of-string.
    // A space after the digits is not valid, so this is malformed → null.
    const result = parseXlibComment('# xlib:step=3 something');
    expect(result).toBeNull();
  });

  it('returns null for xlib: prefix but no step=', () => {
    expect(parseXlibComment('# xlib:alts=["x"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full round-trip: format then parse
// ---------------------------------------------------------------------------

describe('round-trip: formatXlibComment + parseXlibComment', () => {
  it('step-only round-trip', () => {
    for (const step of [1, 2, 10, 99, 1000]) {
      const line = formatXlibComment({ step });
      expect(parseXlibComment(line)).toEqual({ step });
    }
  });

  it('step + alts round-trip with various selectors', () => {
    const cases: [number, string[]][] = [
      [1, ['#id']],
      [2, ['css=#x', '[data-testid="y"]']],
      [3, ['role=button[name="OK"]', '.my-class', "xpath=//button[@id='z']"]],
    ];
    for (const [step, alts] of cases) {
      const line = formatXlibComment({ step, alts });
      expect(parseXlibComment(line)).toEqual({ step, alts });
    }
  });
});
