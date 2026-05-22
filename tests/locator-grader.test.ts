/**
 * Exhaustive unit tests for src/codegen/locator-grader.ts
 *
 * Coverage:
 *   - classifySelector: all SelectorKind values + edge cases
 *   - baseGradeFor: each kind → expected base grade
 *   - applyUniquenessBonus: all (base × matchCount) combinations
 *   - gradeCandidate: full pipeline per kind
 *   - rankCandidates: sorting, stability, empty input
 *   - Snapshot: full grade table for each kind × {undefined, 0, 1, 5}
 */

import { describe, it, expect } from 'vitest';
import {
  classifySelector,
  baseGradeFor,
  applyUniquenessBonus,
  gradeCandidate,
  rankCandidates,
} from '../src/codegen/locator-grader.js';
import type { Grade, SelectorKind, GradeInput, GradeResult } from '../src/codegen/locator-grader.js';

// ─────────────────────────────────────────────────────────────────────────────
// classifySelector
// ─────────────────────────────────────────────────────────────────────────────

describe('classifySelector', () => {
  // ── testid ────────────────────────────────────────────────────────────────
  describe('testid', () => {
    it('classifies internal:testid= prefix', () => {
      expect(classifySelector('internal:testid=["login-btn"]')).toBe('testid');
    });

    it('classifies internal:testid without value brackets', () => {
      expect(classifySelector('internal:testid=login-btn')).toBe('testid');
    });

    it('classifies [data-testid="login"] (quoted value)', () => {
      expect(classifySelector('[data-testid="login"]')).toBe('testid');
    });

    it('classifies [data-testid=login] (unquoted value)', () => {
      expect(classifySelector('[data-testid=login]')).toBe('testid');
    });

    it('classifies [data-testid="submit-btn"] with dashes', () => {
      expect(classifySelector('[data-testid="submit-btn"]')).toBe('testid');
    });
  });

  // ── role-with-name ────────────────────────────────────────────────────────
  describe('role-with-name', () => {
    it('classifies internal:role=button[name="Sign in"]', () => {
      expect(classifySelector('internal:role=button[name="Sign in"]')).toBe('role-with-name');
    });

    it('classifies internal:role=button[name="Sign in" i] (i flag)', () => {
      expect(classifySelector('internal:role=button[name="Sign in" i]')).toBe('role-with-name');
    });

    it('classifies internal:role=button[name="Sign in" s] (s flag)', () => {
      expect(classifySelector('internal:role=button[name="Sign in" s]')).toBe('role-with-name');
    });

    it('classifies role=button[name="Submit"] (bare role= form)', () => {
      expect(classifySelector('role=button[name="Submit"]')).toBe('role-with-name');
    });

    it('classifies role=link[name="Writing tests"]', () => {
      expect(classifySelector('role=link[name="Writing tests"]')).toBe('role-with-name');
    });

    it('classifies internal:role=heading[name="Playwright enables reliable" i]', () => {
      expect(
        classifySelector('internal:role=heading[name="Playwright enables reliable" i]'),
      ).toBe('role-with-name');
    });

    // ── role WITHOUT name → unknown ──────────────────────────────────────────
    it('returns unknown for internal:role=button (no name)', () => {
      expect(classifySelector('internal:role=button')).toBe('unknown');
    });

    it('returns unknown for role=button (no name attribute)', () => {
      expect(classifySelector('role=button')).toBe('unknown');
    });

    it('returns unknown for internal:role=checkbox (no name)', () => {
      expect(classifySelector('internal:role=checkbox')).toBe('unknown');
    });
  });

  // ── label ─────────────────────────────────────────────────────────────────
  describe('label', () => {
    it('classifies internal:label="Email"', () => {
      expect(classifySelector('internal:label="Email"')).toBe('label');
    });

    it('classifies internal:label=Password', () => {
      expect(classifySelector('internal:label=Password')).toBe('label');
    });

    it('classifies label=Email (bare form)', () => {
      expect(classifySelector('label=Email')).toBe('label');
    });

    it('classifies label=Username with spaces', () => {
      expect(classifySelector('label=First Name')).toBe('label');
    });
  });

  // ── placeholder ───────────────────────────────────────────────────────────
  describe('placeholder', () => {
    it('classifies internal:attr=[placeholder="Search"]', () => {
      expect(classifySelector('internal:attr=[placeholder="Search"]')).toBe('placeholder');
    });

    it('classifies internal:attr with name="placeholder" value format', () => {
      expect(classifySelector('internal:attr[name="placeholder"][value="Search..."]')).toBe(
        'placeholder',
      );
    });

    it('classifies placeholder=Search... (bare form)', () => {
      expect(classifySelector('placeholder=Search...')).toBe('placeholder');
    });

    it('classifies placeholder=Enter your email', () => {
      expect(classifySelector('placeholder=Enter your email')).toBe('placeholder');
    });
  });

  // ── text ─────────────────────────────────────────────────────────────────
  describe('text', () => {
    it('classifies internal:text="Click here"', () => {
      expect(classifySelector('internal:text="Click here"')).toBe('text');
    });

    it('classifies internal:text=Submit (no quotes)', () => {
      expect(classifySelector('internal:text=Submit')).toBe('text');
    });

    it('classifies internal:has-text="Login"', () => {
      expect(classifySelector('internal:has-text="Login"')).toBe('text');
    });

    it('classifies text="Login" (bare form)', () => {
      expect(classifySelector('text="Login"')).toBe('text');
    });

    it('classifies text=Login (unquoted bare form)', () => {
      expect(classifySelector('text=Login')).toBe('text');
    });
  });

  // ── css ───────────────────────────────────────────────────────────────────
  describe('css', () => {
    it('classifies css=.submit-btn', () => {
      expect(classifySelector('css=.submit-btn')).toBe('css');
    });

    it('classifies css=#login', () => {
      expect(classifySelector('css=#login')).toBe('css');
    });

    it('classifies css=[type=submit]', () => {
      expect(classifySelector('css=[type=submit]')).toBe('css');
    });

    it('classifies .btn-primary (bare dot prefix)', () => {
      expect(classifySelector('.btn-primary')).toBe('css');
    });

    it('classifies #login (bare hash prefix)', () => {
      expect(classifySelector('#login')).toBe('css');
    });

    it('classifies [type=submit] (bare bracket prefix)', () => {
      expect(classifySelector('[type=submit]')).toBe('css');
    });

    it('classifies :nth-child(2) (bare colon prefix)', () => {
      expect(classifySelector(':nth-child(2)')).toBe('css');
    });

    it('classifies button (bare tag selector)', () => {
      expect(classifySelector('button')).toBe('css');
    });

    it('classifies input[type=submit] (bare tag with attribute)', () => {
      expect(classifySelector('input[type=submit]')).toBe('css');
    });
  });

  // ── xpath ─────────────────────────────────────────────────────────────────
  describe('xpath', () => {
    it('classifies xpath=//button[@id="go"]', () => {
      expect(classifySelector('xpath=//button[@id="go"]')).toBe('xpath');
    });

    it('classifies //button[@id="go"] (bare // prefix)', () => {
      expect(classifySelector('//button[@id="go"]')).toBe('xpath');
    });

    it('classifies //div/span/button', () => {
      expect(classifySelector('//div/span/button')).toBe('xpath');
    });

    it('classifies xpath=/html/body/div[1]', () => {
      expect(classifySelector('xpath=/html/body/div[1]')).toBe('xpath');
    });
  });

  // ── unknown ───────────────────────────────────────────────────────────────
  describe('unknown', () => {
    it('returns unknown for empty string', () => {
      expect(classifySelector('')).toBe('unknown');
    });

    it('returns unknown for whitespace-only string', () => {
      expect(classifySelector('   ')).toBe('unknown');
    });

    it('returns unknown for unrecognized internal: prefix', () => {
      expect(classifySelector('internal:nth=2')).toBe('unknown');
    });

    it('returns unknown for internal:role= without name', () => {
      expect(classifySelector('internal:role=button')).toBe('unknown');
    });

    it('returns unknown for role= without name', () => {
      expect(classifySelector('role=link')).toBe('unknown');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// baseGradeFor
// ─────────────────────────────────────────────────────────────────────────────

describe('baseGradeFor', () => {
  const cases: [SelectorKind, Grade][] = [
    ['testid', 'A+'],
    ['role-with-name', 'A'],
    ['label', 'A'],
    ['placeholder', 'B'],
    ['text', 'B'],
    ['css', 'C'],
    ['xpath', 'D'],
    ['unknown', 'D'],
  ];

  for (const [kind, expected] of cases) {
    it(`${kind} → ${expected}`, () => {
      expect(baseGradeFor(kind)).toBe(expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// applyUniquenessBonus
// ─────────────────────────────────────────────────────────────────────────────

describe('applyUniquenessBonus', () => {
  // ── matchCount === undefined → no bonus ────────────────────────────────────
  describe('matchCount = undefined (not measured)', () => {
    const noBonus: [Grade, Grade][] = [
      ['A+', 'A+'],
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C'],
      ['D', 'D'],
    ];
    for (const [base, expected] of noBonus) {
      it(`${base} stays ${expected}`, () => {
        expect(applyUniquenessBonus(base, undefined)).toBe(expected);
      });
    }
  });

  // ── matchCount === 0 → no bonus (broken selector) ──────────────────────────
  describe('matchCount = 0 (no match)', () => {
    const noBonus: [Grade, Grade][] = [
      ['A+', 'A+'],
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C'],
      ['D', 'D'],
    ];
    for (const [base, expected] of noBonus) {
      it(`${base} stays ${expected}`, () => {
        expect(applyUniquenessBonus(base, 0)).toBe(expected);
      });
    }
  });

  // ── matchCount === 1 → +1 tier ─────────────────────────────────────────────
  describe('matchCount = 1 (unique — bonus applied)', () => {
    it('A+ stays A+ (already top)', () => {
      expect(applyUniquenessBonus('A+', 1)).toBe('A+');
    });
    it('A → A+', () => {
      expect(applyUniquenessBonus('A', 1)).toBe('A+');
    });
    it('B → A', () => {
      expect(applyUniquenessBonus('B', 1)).toBe('A');
    });
    it('C → B', () => {
      expect(applyUniquenessBonus('C', 1)).toBe('B');
    });
    it('D → C', () => {
      expect(applyUniquenessBonus('D', 1)).toBe('C');
    });
  });

  // ── matchCount > 1 → no bonus (ambiguous) ─────────────────────────────────
  describe('matchCount > 1 (ambiguous — no bonus)', () => {
    const values = [2, 3, 5, 100];
    for (const n of values) {
      it(`matchCount=${n}: A stays A`, () => {
        expect(applyUniquenessBonus('A', n)).toBe('A');
      });
      it(`matchCount=${n}: B stays B`, () => {
        expect(applyUniquenessBonus('B', n)).toBe('B');
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// gradeCandidate — full pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('gradeCandidate', () => {
  it('testid, matchCount=undefined → A+, uniqueOnPage=false', () => {
    const result = gradeCandidate({ selector: '[data-testid="login"]' });
    expect(result).toEqual<GradeResult>({
      selector: '[data-testid="login"]',
      kind: 'testid',
      grade: 'A+',
      uniqueOnPage: false,
    });
  });

  it('testid, matchCount=1 → A+ (already top, bonus is no-op), uniqueOnPage=true', () => {
    const result = gradeCandidate({ selector: '[data-testid="login"]', matchCount: 1 });
    expect(result).toEqual<GradeResult>({
      selector: '[data-testid="login"]',
      kind: 'testid',
      grade: 'A+',
      uniqueOnPage: true,
    });
  });

  it('label, matchCount=1 → A+, uniqueOnPage=true', () => {
    const result = gradeCandidate({ selector: 'label=Email', matchCount: 1 });
    expect(result).toEqual<GradeResult>({
      selector: 'label=Email',
      kind: 'label',
      grade: 'A+',
      uniqueOnPage: true,
    });
  });

  it('role-with-name, matchCount=1 → A+, uniqueOnPage=true', () => {
    const result = gradeCandidate({ selector: 'role=button[name="Submit"]', matchCount: 1 });
    expect(result).toEqual<GradeResult>({
      selector: 'role=button[name="Submit"]',
      kind: 'role-with-name',
      grade: 'A+',
      uniqueOnPage: true,
    });
  });

  it('placeholder, matchCount=0 → B (no bonus for 0 matches), uniqueOnPage=false', () => {
    const result = gradeCandidate({ selector: 'placeholder=Search', matchCount: 0 });
    expect(result).toEqual<GradeResult>({
      selector: 'placeholder=Search',
      kind: 'placeholder',
      grade: 'B',
      uniqueOnPage: false,
    });
  });

  it('css, matchCount=1 → B (C → B via bonus), uniqueOnPage=true', () => {
    const result = gradeCandidate({ selector: '.submit-btn', matchCount: 1 });
    expect(result).toEqual<GradeResult>({
      selector: '.submit-btn',
      kind: 'css',
      grade: 'B',
      uniqueOnPage: true,
    });
  });

  it('xpath, matchCount=1 → C (D → C via bonus), uniqueOnPage=true', () => {
    const result = gradeCandidate({ selector: '//button[@id="go"]', matchCount: 1 });
    expect(result).toEqual<GradeResult>({
      selector: '//button[@id="go"]',
      kind: 'xpath',
      grade: 'C',
      uniqueOnPage: true,
    });
  });

  it('unknown (empty selector), matchCount=5 → D, uniqueOnPage=false', () => {
    const result = gradeCandidate({ selector: '', matchCount: 5 });
    expect(result).toEqual<GradeResult>({
      selector: '',
      kind: 'unknown',
      grade: 'D',
      uniqueOnPage: false,
    });
  });

  it('role without name → unknown → D', () => {
    const result = gradeCandidate({ selector: 'internal:role=button' });
    expect(result.kind).toBe('unknown');
    expect(result.grade).toBe('D');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rankCandidates
// ─────────────────────────────────────────────────────────────────────────────

describe('rankCandidates', () => {
  it('returns [] for empty input', () => {
    expect(rankCandidates([])).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const result = rankCandidates([{ selector: 'label=Email', matchCount: 1 }]);
    expect(result).toHaveLength(1);
    expect(result[0].selector).toBe('label=Email');
  });

  it('sorts best→worst (A+ before A before B before C before D)', () => {
    const inputs: GradeInput[] = [
      { selector: '//button', matchCount: undefined },         // xpath → D
      { selector: '.btn', matchCount: undefined },             // css   → C
      { selector: 'text=Login', matchCount: undefined },       // text  → B
      { selector: 'label=Email', matchCount: undefined },      // label → A
      { selector: '[data-testid="btn"]', matchCount: undefined }, // testid → A+
    ];
    const results = rankCandidates(inputs);
    expect(results.map((r) => r.grade)).toEqual(['A+', 'A', 'B', 'C', 'D']);
  });

  it('is STABLE for equal grades — preserves input order', () => {
    // Three css selectors — all should get grade C and remain in original order.
    const inputs: GradeInput[] = [
      { selector: '.first', matchCount: undefined },
      { selector: '.second', matchCount: undefined },
      { selector: '.third', matchCount: undefined },
    ];
    const results = rankCandidates(inputs);
    expect(results.map((r) => r.selector)).toEqual(['.first', '.second', '.third']);
  });

  it('is STABLE across mixed grades — same-grade groups keep input order', () => {
    const inputs: GradeInput[] = [
      { selector: 'label=A', matchCount: undefined },   // A
      { selector: '#id1', matchCount: undefined },      // C
      { selector: 'label=B', matchCount: undefined },   // A
      { selector: '#id2', matchCount: undefined },      // C
    ];
    const results = rankCandidates(inputs);
    expect(results.map((r) => r.selector)).toEqual(['label=A', 'label=B', '#id1', '#id2']);
  });

  it('applies bonus before ranking', () => {
    const inputs: GradeInput[] = [
      { selector: '.css-only', matchCount: undefined },      // C
      { selector: '//xpath', matchCount: 1 },                // D→C via bonus
      { selector: 'text=Hello', matchCount: 1 },             // B→A via bonus
    ];
    const results = rankCandidates(inputs);
    // text=Hello gets A, .css-only gets C, //xpath gets C
    expect(results[0].selector).toBe('text=Hello');
    expect(results[0].grade).toBe('A');
    // css and xpath-with-bonus are both C — input order preserved
    expect(results[1].selector).toBe('.css-only');
    expect(results[2].selector).toBe('//xpath');
  });

  it('places uniqueOnPage=true candidates ahead when that drives a grade difference', () => {
    const inputs: GradeInput[] = [
      { selector: 'role=button[name="Ok"]', matchCount: 5 },  // role → A (no bonus)
      { selector: 'label=Submit', matchCount: 1 },            // label → A+
    ];
    const results = rankCandidates(inputs);
    expect(results[0].grade).toBe('A+');
    expect(results[0].selector).toBe('label=Submit');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot: full grade table — each kind × {undefined, 0, 1, 5}
// ─────────────────────────────────────────────────────────────────────────────

describe('snapshot — full grade table (kind × matchCount)', () => {
  // Canonical selector per kind for snapshot testing
  const kindSelector: Record<SelectorKind, string> = {
    testid: '[data-testid="btn"]',
    'role-with-name': 'role=button[name="Submit"]',
    label: 'label=Email',
    placeholder: 'placeholder=Search',
    text: 'text=Login',
    css: '.btn-primary',
    xpath: '//button[@id="go"]',
    unknown: '',
  };

  const matchCounts: Array<number | undefined> = [undefined, 0, 1, 5];
  const kinds: SelectorKind[] = [
    'testid',
    'role-with-name',
    'label',
    'placeholder',
    'text',
    'css',
    'xpath',
    'unknown',
  ];

  /**
   * Expected grade table — manually derived from the spec heuristic table
   * and +1-tier bonus rule.
   *
   * Format: expectedGrade[kind][matchCountIndex] where index 0=undefined, 1=0, 2=1, 3=5
   */
  const expectedGrades: Record<SelectorKind, [Grade, Grade, Grade, Grade]> = {
    testid:            ['A+', 'A+', 'A+', 'A+'], // A+ → bonus is no-op
    'role-with-name':  ['A',  'A',  'A+', 'A' ], // A  → bonus → A+
    label:             ['A',  'A',  'A+', 'A' ], // A  → bonus → A+
    placeholder:       ['B',  'B',  'A',  'B' ], // B  → bonus → A
    text:              ['B',  'B',  'A',  'B' ], // B  → bonus → A
    css:               ['C',  'C',  'B',  'C' ], // C  → bonus → B
    xpath:             ['D',  'D',  'C',  'D' ], // D  → bonus → C
    unknown:           ['D',  'D',  'C',  'D' ], // D  → bonus → C
  };

  for (const kind of kinds) {
    for (let i = 0; i < matchCounts.length; i++) {
      const mc = matchCounts[i];
      const expected = expectedGrades[kind][i];
      it(`${kind} × matchCount=${mc === undefined ? 'undefined' : mc} → ${expected}`, () => {
        const result = gradeCandidate({ selector: kindSelector[kind], matchCount: mc });
        expect(result.grade).toBe(expected);
      });
    }
  }
});
