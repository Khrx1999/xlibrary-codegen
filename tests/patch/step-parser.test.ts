/**
 * Tests for src/patch/step-parser.ts
 *
 * Coverage:
 *   - parseSteps() for all four target languages
 *   - Edge cases: missing keyword line, blank lines between action and marker,
 *     out-of-order step numbers, duplicate step numbers, no markers present
 *   - findStepsByContent() fuzzy matching: 0 / 1 / N matches, case-insensitivity
 */

import { describe, it, expect } from 'vitest';
import { parseSteps, findStepsByContent } from '../../src/patch/step-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A minimal Robot Framework file with three steps.
 */
const RF_SOURCE = `*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=\${False}
    New Context    viewport=None
    New Page    https://example.com/login
    # xlib:step=1
    Fill Text    css=#username    admin
    # xlib:step=2
    Fill Text    css=#password    secret
    # xlib:step=3
    Click    css=#login-btn
    # xlib:step=4
    Close Browser
`;

/**
 * Same flow emitted as SeleniumLibrary (same `#` comment prefix, different keywords).
 */
const SELENIUM_SOURCE = `*** Settings ***
Library    SeleniumLibrary

*** Test Cases ***
Login Flow
    Open Browser    https://example.com/login    chrome
    # xlib:step=1
    Input Text    css=#username    admin
    # xlib:step=2
    Input Password    css=#password    secret
    # xlib:step=3
    Click Element    css=#login-btn
    # xlib:step=4
    Close Browser
`;

/**
 * Python emitter (Playwright Python) — uses `#` for comments.
 */
const PYTHON_SOURCE = `import re
from playwright.sync_api import Playwright, sync_playwright, expect

def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://example.com/login")
    # xlib:step=1
    page.fill("css=#username", "admin")
    # xlib:step=2
    page.fill("css=#password", "secret")
    # xlib:step=3
    page.click("css=#login-btn")
    # xlib:step=4
    browser.close()
`;

/**
 * TypeScript emitter — uses `//` for comments.
 */
const TS_SOURCE = `import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://example.com/login');
  // xlib:step=1
  await page.fill('css=#username', 'admin');
  // xlib:step=2
  await page.fill('css=#password', 'secret');
  // xlib:step=3
  await page.click('css=#login-btn');
  // xlib:step=4
  await browser.close();
}
`;

/**
 * Markers with `alts` payloads.
 */
const RF_WITH_ALTS = `*** Test Cases ***
Example
    Click    role=button[name="Login"]
    # xlib:step=1;alts=["css=#login-btn","xpath=//button[@id='login']"]
    Fill Text    css=#search    hello
    # xlib:step=2;alts=["css=#q"]
`;

/**
 * No xlib markers at all.
 */
const NO_MARKERS = `*** Test Cases ***
Empty
    Log    nothing here
`;

/**
 * Marker at the very top of the file — no keyword line above it.
 */
const MARKER_AT_TOP = `# xlib:step=1
Click    css=#btn
# xlib:step=2
`;

/**
 * Multiple blank lines between keyword and marker.
 */
const BLANK_LINES_BETWEEN = `*** Test Cases ***
Example
    Click    css=#btn


    # xlib:step=1
    Fill Text    css=#input    value
    # xlib:step=2
`;

/**
 * Step numbers out of order in the source.
 */
const OUT_OF_ORDER = `*** Test Cases ***
Example
    Click    css=#b
    # xlib:step=5
    Fill Text    css=#a    x
    # xlib:step=1
`;

/**
 * Duplicate step numbers — first occurrence should win.
 */
const DUPLICATE_STEPS = `*** Test Cases ***
Example
    Click    css=#first
    # xlib:step=1
    Fill Text    css=#second    value
    # xlib:step=1
`;

// ─────────────────────────────────────────────────────────────────────────────
// parseSteps — Robot Framework
// ─────────────────────────────────────────────────────────────────────────────

describe('parseSteps — Robot Framework', () => {
  it('finds all 4 steps in source order', () => {
    const idx = parseSteps(RF_SOURCE);
    expect(idx.steps).toHaveLength(4);
    expect(idx.steps.map((s) => s.step)).toEqual([1, 2, 3, 4]);
  });

  it('byNumber map has all 4 entries', () => {
    const idx = parseSteps(RF_SOURCE);
    expect(idx.byNumber.size).toBe(4);
    for (let i = 1; i <= 4; i++) {
      expect(idx.byNumber.has(i)).toBe(true);
    }
  });

  it('step 1 keywordLine is the New Page call', () => {
    const idx = parseSteps(RF_SOURCE);
    const s1 = idx.byNumber.get(1);
    expect(s1).toBeDefined();
    expect(s1!.keywordLine).toContain('New Page');
  });

  it('step 2 keywordLine is Fill Text username', () => {
    const idx = parseSteps(RF_SOURCE);
    const s2 = idx.byNumber.get(2);
    expect(s2!.keywordLine).toContain('Fill Text');
    expect(s2!.keywordLine).toContain('#username');
  });

  it('step 4 keywordLine is Click', () => {
    const idx = parseSteps(RF_SOURCE);
    const s4 = idx.byNumber.get(4);
    expect(s4!.keywordLine).toContain('Click');
    expect(s4!.keywordLine).toContain('#login-btn');
  });

  it('markerLineIdx and keywordLineIdx are adjacent (marker follows keyword)', () => {
    const idx = parseSteps(RF_SOURCE);
    for (const s of idx.steps) {
      expect(s.markerLineIdx).toBeGreaterThan(s.keywordLineIdx);
      expect(s.markerLineIdx - s.keywordLineIdx).toBe(1);
    }
  });

  it('xlib payload step matches ParsedStep.step', () => {
    const idx = parseSteps(RF_SOURCE);
    for (const s of idx.steps) {
      expect(s.xlib.step).toBe(s.step);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSteps — SeleniumLibrary
// ─────────────────────────────────────────────────────────────────────────────

describe('parseSteps — SeleniumLibrary', () => {
  it('finds 4 steps', () => {
    const idx = parseSteps(SELENIUM_SOURCE);
    expect(idx.steps).toHaveLength(4);
  });

  it('step 1 keywordLine is Open Browser', () => {
    const s1 = parseSteps(SELENIUM_SOURCE).byNumber.get(1);
    expect(s1!.keywordLine).toContain('Open Browser');
  });

  it('step 4 keywordLine is Click Element', () => {
    const s4 = parseSteps(SELENIUM_SOURCE).byNumber.get(4);
    expect(s4!.keywordLine).toContain('Click Element');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSteps — Python
// ─────────────────────────────────────────────────────────────────────────────

describe('parseSteps — Python', () => {
  it('finds 4 steps', () => {
    const idx = parseSteps(PYTHON_SOURCE);
    expect(idx.steps).toHaveLength(4);
  });

  it('step 1 keywordLine is page.goto', () => {
    const s1 = parseSteps(PYTHON_SOURCE).byNumber.get(1);
    expect(s1!.keywordLine).toContain('page.goto');
  });

  it('step 3 keywordLine is page.fill for password', () => {
    const s3 = parseSteps(PYTHON_SOURCE).byNumber.get(3);
    expect(s3!.keywordLine).toContain('page.fill');
    expect(s3!.keywordLine).toContain('password');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSteps — TypeScript (// comment prefix)
// ─────────────────────────────────────────────────────────────────────────────

describe('parseSteps — TypeScript', () => {
  it('finds 4 steps from // comment markers', () => {
    const idx = parseSteps(TS_SOURCE);
    expect(idx.steps).toHaveLength(4);
  });

  it('step 1 keywordLine is page.goto', () => {
    const s1 = parseSteps(TS_SOURCE).byNumber.get(1);
    expect(s1!.keywordLine).toContain('page.goto');
  });

  it('step 4 keywordLine is page.click', () => {
    const s4 = parseSteps(TS_SOURCE).byNumber.get(4);
    expect(s4!.keywordLine).toContain('page.click');
    expect(s4!.keywordLine).toContain('login-btn');
  });

  it('alts are not present on plain markers', () => {
    const idx = parseSteps(TS_SOURCE);
    for (const s of idx.steps) {
      expect(s.xlib.alts).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSteps — alts payload
// ─────────────────────────────────────────────────────────────────────────────

describe('parseSteps — alts payload', () => {
  it('step 1 has two alts', () => {
    const idx = parseSteps(RF_WITH_ALTS);
    const s1 = idx.byNumber.get(1);
    expect(s1).toBeDefined();
    if (!s1) return;
    expect(s1.xlib.alts).toEqual(['css=#login-btn', "xpath=//button[@id='login']"]);
  });

  it('step 2 has one alt', () => {
    const s2 = parseSteps(RF_WITH_ALTS).byNumber.get(2);
    expect(s2!.xlib.alts).toEqual(['css=#q']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSteps — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('parseSteps — edge cases', () => {
  it('returns empty StepIndex when no markers present', () => {
    const idx = parseSteps(NO_MARKERS);
    expect(idx.steps).toHaveLength(0);
    expect(idx.byNumber.size).toBe(0);
  });

  it('returns empty StepIndex for empty string', () => {
    const idx = parseSteps('');
    expect(idx.steps).toHaveLength(0);
  });

  it('marker at top of file: keywordLineIdx falls back to markerLineIdx with empty keywordLine', () => {
    const idx = parseSteps(MARKER_AT_TOP);
    const s1 = idx.byNumber.get(1);
    expect(s1).toBeDefined();
    expect(s1!.keywordLine).toBe('');
    expect(s1!.keywordLineIdx).toBe(s1!.markerLineIdx);
  });

  it('marker at top finds keyword for step 2 (the line between the two markers)', () => {
    const idx = parseSteps(MARKER_AT_TOP);
    const s2 = idx.byNumber.get(2);
    expect(s2).toBeDefined();
    // Line 1 (0-indexed) is "Click    css=#btn"
    expect(s2!.keywordLine).toContain('Click');
  });

  it('skips blank lines between keyword and marker', () => {
    const idx = parseSteps(BLANK_LINES_BETWEEN);
    const s1 = idx.byNumber.get(1);
    expect(s1!.keywordLine.trim()).toBe('Click    css=#btn');
  });

  it('steps sorted in source order regardless of step number', () => {
    const idx = parseSteps(OUT_OF_ORDER);
    const first = idx.steps[0];
    const second = idx.steps[1];
    expect(first?.step).toBe(5);
    expect(second?.step).toBe(1);
  });

  it('duplicate step numbers: first occurrence wins', () => {
    const idx = parseSteps(DUPLICATE_STEPS);
    expect(idx.byNumber.size).toBe(1);
    const s1 = idx.byNumber.get(1);
    expect(s1).toBeDefined();
    // First occurrence: keyword is "Click    css=#first"
    expect(s1?.keywordLine).toContain('#first');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findStepsByContent
// ─────────────────────────────────────────────────────────────────────────────

describe('findStepsByContent', () => {
  const idx = parseSteps(RF_SOURCE);

  it('returns empty array for query with no matches', () => {
    expect(findStepsByContent(idx, 'NonExistentKeyword')).toHaveLength(0);
  });

  it('case-insensitive: "fill text" matches both Fill Text steps', () => {
    const matches = findStepsByContent(idx, 'fill text');
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.step)).toContain(2);
    expect(matches.map((m) => m.step)).toContain(3);
  });

  it('specific query "login-btn" matches exactly one step', () => {
    const matches = findStepsByContent(idx, 'login-btn');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.step).toBe(4);
  });

  it('returns keywordLine on each match', () => {
    const matches = findStepsByContent(idx, 'click');
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.keywordLine).toBeTruthy();
      expect(typeof m.keywordLine).toBe('string');
    }
  });

  it('query matching all steps returns all steps', () => {
    // Every step is inside a Test Cases block — "css=" appears on all 3 action steps
    const matches = findStepsByContent(idx, 'css=');
    // RF_SOURCE steps: 1=New Page (no css=), 2=Fill username, 3=Fill password, 4=Click login-btn
    // Actually step 1's keyword is "New Page https://example.com/login" — no css=
    // Steps 2,3,4 have css= selectors
    expect(matches.length).toBe(3);
  });

  it('returns matches in source order', () => {
    const matches = findStepsByContent(idx, 'fill text');
    const first = matches[0];
    const second = matches[1];
    expect(first?.step).toBeLessThan(second?.step ?? Infinity);
  });

  it('empty query matches all steps', () => {
    const allIdx = parseSteps(RF_SOURCE);
    const matches = findStepsByContent(allIdx, '');
    expect(matches).toHaveLength(allIdx.steps.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// StepIndex shape contract (for Tasks #10/#11)
// ─────────────────────────────────────────────────────────────────────────────

describe('StepIndex shape contract', () => {
  it('ParsedStep has all required fields', () => {
    const idx = parseSteps(RF_SOURCE);
    const s = idx.steps[0];

    expect(s).toBeDefined();
    if (!s) return;

    expect(typeof s.step).toBe('number');
    expect(typeof s.markerLineIdx).toBe('number');
    expect(typeof s.keywordLineIdx).toBe('number');
    expect(typeof s.keywordLine).toBe('string');
    expect(typeof s.xlib).toBe('object');
    expect(typeof s.xlib.step).toBe('number');
  });

  it('byNumber is a Map', () => {
    const idx = parseSteps(RF_SOURCE);
    expect(idx.byNumber).toBeInstanceOf(Map);
  });

  it('byNumber entries reference the same objects as steps array', () => {
    const idx = parseSteps(RF_SOURCE);
    for (const s of idx.steps) {
      expect(idx.byNumber.get(s.step)).toBe(s);
    }
  });
});
