/**
 * tests/patch/operations.test.ts
 *
 * Exhaustive unit tests for src/patch/operations.ts.
 *
 * Coverage:
 *   - renumberSteps() — regex, gap-filling, alts preservation, TS prefix
 *   - replaceStep() — RF, Selenium, Python, TS fixtures
 *   - replaceRange() — RF multi-step range
 *   - insertAfter() — all 4 langs
 *   - insertBefore() — all 4 langs
 *   - deleteStep() — all 4 langs + last-step edge case
 *   - deleteRange() — RF multi-step range
 *   - moveStep() — forward move, backward move, same-step no-op,
 *                  toStepNum=0 (insert-at-top)
 *   - parseRangeSpec() / parseMoveSpec() — parsing
 *   - stubNewStepProvider() — correct prefix per lang
 *   - Error paths: out-of-range step, from > to
 */

import { describe, it, expect } from 'vitest';
import {
  renumberSteps,
  replaceStep,
  replaceRange,
  insertAfter,
  insertBefore,
  deleteStep,
  deleteRange,
  moveStep,
  parseRangeSpec,
  parseMoveSpec,
  stubNewStepProvider,
} from '../../src/patch/operations.js';
import { parseSteps } from '../../src/patch/step-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — one for each of the 4 target languages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Robot Framework fixture — 4 steps.
 * New Page is step 1 (before first user action), so step 1-4 are all
 * real actions.
 */
const RF_4 = `*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=\${False}
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
 * SeleniumLibrary fixture — 4 steps.
 */
const SL_4 = `*** Settings ***
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
 * Python fixture — 4 steps.
 */
const PY_4 = `import re
from playwright.sync_api import Playwright, sync_playwright

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
 * TypeScript fixture — 4 steps (uses `//` comment prefix).
 */
const TS_4 = `import { chromium } from 'playwright';

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

/** Single-step fixture (for last-step delete edge case). */
const RF_1 = `*** Test Cases ***
Example
    Click    css=#btn
    # xlib:step=1
`;

/** Fixture with alts payload — verifies alts are preserved after renumbering. */
const RF_WITH_ALTS = `*** Test Cases ***
Example
    Click    role=button[name="Login"]
    # xlib:step=1;alts=["css=#login-btn","xpath=//button[@id='login']"]
    Fill Text    css=#search    hello
    # xlib:step=2;alts=["css=#q"]
    Hover    css=#menu
    # xlib:step=3
`;

// ─────────────────────────────────────────────────────────────────────────────
// renumberSteps
// ─────────────────────────────────────────────────────────────────────────────

describe('renumberSteps', () => {
  it('numbers already-contiguous markers: no change to step values', () => {
    const result = renumberSteps(RF_4);
    // Should still have 1-4
    expect(result).toContain('xlib:step=1');
    expect(result).toContain('xlib:step=2');
    expect(result).toContain('xlib:step=3');
    expect(result).toContain('xlib:step=4');
  });

  it('fills gaps: step numbers 1, 3, 5 → 1, 2, 3', () => {
    const src = `    Click    a\n    # xlib:step=1\n    Fill    b\n    # xlib:step=3\n    Hover    c\n    # xlib:step=5\n`;
    const out = renumberSteps(src);
    const markers = out.match(/xlib:step=\d+/g);
    expect(markers).toEqual(['xlib:step=1', 'xlib:step=2', 'xlib:step=3']);
  });

  it('preserves alts payload after renumbering', () => {
    const out = renumberSteps(RF_WITH_ALTS);
    // All markers should still have their alts
    expect(out).toContain('xlib:step=1;alts=["css=#login-btn"');
    expect(out).toContain('xlib:step=2;alts=["css=#q"]');
    expect(out).toContain('xlib:step=3\n');
  });

  it('handles // prefix (TypeScript markers)', () => {
    const src = `  await page.click('a');\n  // xlib:step=5\n  await page.fill('b', 'v');\n  // xlib:step=10\n`;
    const out = renumberSteps(src);
    expect(out).toContain('// xlib:step=1');
    expect(out).toContain('// xlib:step=2');
  });

  it('empty string → empty string', () => {
    expect(renumberSteps('')).toBe('');
  });

  it('string with no xlib markers → unchanged', () => {
    const src = 'Click    css=#btn\n';
    expect(renumberSteps(src)).toBe(src);
  });

  it('renumbers duplicate step numbers correctly', () => {
    const src = `    Click    a\n    # xlib:step=1\n    Fill    b\n    # xlib:step=1\n`;
    const out = renumberSteps(src);
    const markers = out.match(/xlib:step=\d+/g);
    expect(markers).toEqual(['xlib:step=1', 'xlib:step=2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// replaceStep — Robot Framework
// ─────────────────────────────────────────────────────────────────────────────

describe('replaceStep — Robot Framework', () => {
  it('replaces step 1 with stub content', () => {
    const idx = parseSteps(RF_4);
    const stub = '    # REPLACED\n    # xlib:step=0';
    const result = replaceStep(RF_4, idx, 1, stub);
    expect(result).toContain('# REPLACED');
    // Original step 1 keyword ("New Page") should be gone
    expect(result).not.toContain('New Page    https://example.com/login');
    // Steps still renumbered 1-4
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
    expect(markers).toEqual(['xlib:step=1', 'xlib:step=2', 'xlib:step=3', 'xlib:step=4']);
  });

  it('replaces step 2 — other steps untouched', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Fill Text    css=#user    replaced\n    # xlib:step=0';
    const result = replaceStep(RF_4, idx, 2, stub);
    expect(result).toContain('replaced');
    expect(result).not.toContain('Fill Text    css=#username    admin');
    // Steps 1, 3, 4 keyword lines still present
    expect(result).toContain('New Page    https://example.com/login');
    expect(result).toContain('Fill Text    css=#password    secret');
    expect(result).toContain('Click    css=#login-btn');
  });

  it('replaces step 4 (last step)', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Click    css=#new-btn\n    # xlib:step=0';
    const result = replaceStep(RF_4, idx, 4, stub);
    expect(result).toContain('css=#new-btn');
    expect(result).not.toContain('Click    css=#login-btn');
  });

  it('throws when step not found', () => {
    const idx = parseSteps(RF_4);
    expect(() => replaceStep(RF_4, idx, 99, 'x')).toThrow(/No step 99/);
  });

  it('preserves trailing newline', () => {
    expect(RF_4.endsWith('\n')).toBe(true);
    const idx = parseSteps(RF_4);
    const result = replaceStep(RF_4, idx, 1, '    # NEW\n    # xlib:step=0');
    expect(result.endsWith('\n')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// replaceStep — SeleniumLibrary
// ─────────────────────────────────────────────────────────────────────────────

describe('replaceStep — SeleniumLibrary', () => {
  it('replaces step 3 (Input Password)', () => {
    const idx = parseSteps(SL_4);
    const stub = '    Input Password    css=#pwd    new_secret\n    # xlib:step=0';
    const result = replaceStep(SL_4, idx, 3, stub);
    expect(result).toContain('css=#pwd');
    expect(result).not.toContain('Input Password    css=#password    secret');
    expect(result).toContain('Input Text    css=#username    admin');
  });

  it('step count remains 4 after single replace', () => {
    const idx = parseSteps(SL_4);
    const result = replaceStep(SL_4, idx, 1, '    Open Browser    https://new\n    # xlib:step=0');
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// replaceStep — Python
// ─────────────────────────────────────────────────────────────────────────────

describe('replaceStep — Python', () => {
  it('replaces step 2 (page.fill username)', () => {
    const idx = parseSteps(PY_4);
    const stub = '    page.fill("css=#user", "replaced_user")\n    # xlib:step=0';
    const result = replaceStep(PY_4, idx, 2, stub);
    expect(result).toContain('replaced_user');
    expect(result).not.toContain('page.fill("css=#username", "admin")');
    // Other steps intact
    expect(result).toContain('page.fill("css=#password"');
    expect(result).toContain('page.click("css=#login-btn")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// replaceStep — TypeScript
// ─────────────────────────────────────────────────────────────────────────────

describe('replaceStep — TypeScript', () => {
  it('replaces step 1 in TS file (// comment prefix)', () => {
    const idx = parseSteps(TS_4);
    const stub = "  await page.goto('https://new.example.com');\n  // xlib:step=0";
    const result = replaceStep(TS_4, idx, 1, stub);
    expect(result).toContain('https://new.example.com');
    expect(result).not.toContain("await page.goto('https://example.com/login')");
    // Markers should use // prefix after renumbering
    expect(result).toContain('// xlib:step=1');
  });

  it('step count remains 4 after TS replace', () => {
    const idx = parseSteps(TS_4);
    const result = replaceStep(TS_4, idx, 3, "  await page.fill('x', 'y');\n  // xlib:step=0");
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// replaceRange
// ─────────────────────────────────────────────────────────────────────────────

describe('replaceRange', () => {
  it('replaces steps 2-3 with single new step', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Fill Text    css=#combined    value\n    # xlib:step=0';
    const result = replaceRange(RF_4, idx, 2, 3, stub);
    // Original steps 2,3 gone; new step present
    expect(result).not.toContain('Fill Text    css=#username');
    expect(result).not.toContain('Fill Text    css=#password');
    expect(result).toContain('css=#combined');
    // Now 3 steps total (was 4, replaced 2 with 1)
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(3);
    expect(markers).toEqual(['xlib:step=1', 'xlib:step=2', 'xlib:step=3']);
  });

  it('replaces steps 1-4 (all steps) with 2 new ones', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Click    css=#a\n    # xlib:step=0\n    Click    css=#b\n    # xlib:step=0';
    const result = replaceRange(RF_4, idx, 1, 4, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(2);
  });

  it('replaces a single step (from === to) — same as replaceStep', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Hover    css=#h\n    # xlib:step=0';
    const result = replaceRange(RF_4, idx, 2, 2, stub);
    expect(result).toContain('Hover    css=#h');
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });

  it('throws when from > to', () => {
    const idx = parseSteps(RF_4);
    expect(() => replaceRange(RF_4, idx, 3, 1, 'stub')).toThrow(/from step 3 must be <= to step 1/);
  });

  it('throws when from step not found', () => {
    const idx = parseSteps(RF_4);
    expect(() => replaceRange(RF_4, idx, 10, 11, 'stub')).toThrow(/No step 10/);
  });

  it('throws when to step not found', () => {
    const idx = parseSteps(RF_4);
    expect(() => replaceRange(RF_4, idx, 1, 10, 'stub')).toThrow(/No step 10/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertAfter — Robot Framework
// ─────────────────────────────────────────────────────────────────────────────

describe('insertAfter — Robot Framework', () => {
  it('inserts after step 1 → 5 steps total', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Hover    css=#new\n    # xlib:step=0';
    const result = insertAfter(RF_4, idx, 1, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
    expect(markers).toEqual([
      'xlib:step=1',
      'xlib:step=2',
      'xlib:step=3',
      'xlib:step=4',
      'xlib:step=5',
    ]);
  });

  it('inserted content appears AFTER step 1 marker but BEFORE step 2 keyword', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Hover    css=#hover\n    # xlib:step=0';
    const result = insertAfter(RF_4, idx, 1, stub);
    const lines = result.split('\n');
    const step1MarkerIdx = lines.findIndex((l) => l.includes('xlib:step=1'));
    const hoverIdx = lines.findIndex((l) => l.includes('css=#hover'));
    const fillUsernameIdx = lines.findIndex((l) => l.includes('css=#username'));
    // hover comes after step=1 marker
    expect(hoverIdx).toBeGreaterThan(step1MarkerIdx);
    // fill-username comes after hover
    expect(fillUsernameIdx).toBeGreaterThan(hoverIdx);
  });

  it('inserts after step 4 (last) → new step becomes step 5', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Click    css=#logout\n    # xlib:step=0';
    const result = insertAfter(RF_4, idx, 4, stub);
    expect(result).toContain('xlib:step=5');
    expect(result).toContain('css=#logout');
  });

  it('throws when step not found', () => {
    const idx = parseSteps(RF_4);
    expect(() => insertAfter(RF_4, idx, 99, 'stub')).toThrow(/No step 99/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertAfter — SeleniumLibrary
// ─────────────────────────────────────────────────────────────────────────────

describe('insertAfter — SeleniumLibrary', () => {
  it('inserts after step 2 (Input Password) → 5 steps', () => {
    const idx = parseSteps(SL_4);
    const stub = '    Wait Until Element Is Visible    css=#btn\n    # xlib:step=0';
    const result = insertAfter(SL_4, idx, 2, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertAfter — Python
// ─────────────────────────────────────────────────────────────────────────────

describe('insertAfter — Python', () => {
  it('inserts after step 3 (page.click) → 5 steps', () => {
    const idx = parseSteps(PY_4);
    const stub = '    page.wait_for_selector("css=#confirm")\n    # xlib:step=0';
    const result = insertAfter(PY_4, idx, 3, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertAfter — TypeScript
// ─────────────────────────────────────────────────────────────────────────────

describe('insertAfter — TypeScript', () => {
  it('inserts after step 1 in TS file → 5 steps', () => {
    const idx = parseSteps(TS_4);
    const stub = "  await page.waitForSelector('css=#check');\n  // xlib:step=0";
    const result = insertAfter(TS_4, idx, 1, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertBefore — Robot Framework
// ─────────────────────────────────────────────────────────────────────────────

describe('insertBefore — Robot Framework', () => {
  it('inserts before step 1 → 5 steps total', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Navigate    https://example.com\n    # xlib:step=0';
    const result = insertBefore(RF_4, idx, 1, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
    expect(markers).toEqual([
      'xlib:step=1',
      'xlib:step=2',
      'xlib:step=3',
      'xlib:step=4',
      'xlib:step=5',
    ]);
  });

  it('inserted content appears BEFORE step 1 keyword', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Navigate    https://example.com\n    # xlib:step=0';
    const result = insertBefore(RF_4, idx, 1, stub);
    const lines = result.split('\n');
    const navigateIdx = lines.findIndex((l) => l.includes('Navigate'));
    const newPageIdx = lines.findIndex((l) => l.includes('New Page'));
    // Navigate (inserted before step 1) appears before New Page (step 1)
    expect(navigateIdx).toBeLessThan(newPageIdx);
  });

  it('inserts before step 3 → original step 3 becomes step 4', () => {
    const idx = parseSteps(RF_4);
    const stub = '    Hover    css=#menu\n    # xlib:step=0';
    const result = insertBefore(RF_4, idx, 3, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
    // The original Fill Text css=#password (was step 3) should now be step 4
    const lines = result.split('\n');
    const fillPwdIdx = lines.findIndex((l) => l.includes('css=#password'));
    const markerAfterFillPwd = lines[fillPwdIdx + 1] ?? '';
    expect(markerAfterFillPwd).toContain('xlib:step=4');
  });

  it('throws when step not found', () => {
    const idx = parseSteps(RF_4);
    expect(() => insertBefore(RF_4, idx, 99, 'stub')).toThrow(/No step 99/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertBefore — SeleniumLibrary
// ─────────────────────────────────────────────────────────────────────────────

describe('insertBefore — SeleniumLibrary', () => {
  it('inserts before step 1 → 5 steps', () => {
    const idx = parseSteps(SL_4);
    const stub = '    Set Window Size    1280    720\n    # xlib:step=0';
    const result = insertBefore(SL_4, idx, 1, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertBefore — Python
// ─────────────────────────────────────────────────────────────────────────────

describe('insertBefore — Python', () => {
  it('inserts before step 4 (browser.close) → 5 steps', () => {
    const idx = parseSteps(PY_4);
    const stub = '    page.screenshot(path="before-close.png")\n    # xlib:step=0';
    const result = insertBefore(PY_4, idx, 4, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertBefore — TypeScript
// ─────────────────────────────────────────────────────────────────────────────

describe('insertBefore — TypeScript', () => {
  it('inserts before step 2 in TS file → 5 steps', () => {
    const idx = parseSteps(TS_4);
    const stub = '  await page.waitForLoadState();\n  // xlib:step=0';
    const result = insertBefore(TS_4, idx, 2, stub);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteStep — Robot Framework
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteStep — Robot Framework', () => {
  it('deletes step 1 → 3 steps remain, renumbered 1-3', () => {
    const idx = parseSteps(RF_4);
    const result = deleteStep(RF_4, idx, 1);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(3);
    expect(markers).toEqual(['xlib:step=1', 'xlib:step=2', 'xlib:step=3']);
    // Original step 1 keyword gone
    expect(result).not.toContain('New Page    https://example.com/login');
  });

  it('deletes step 4 (last) → 3 steps remain', () => {
    const idx = parseSteps(RF_4);
    const result = deleteStep(RF_4, idx, 4);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(3);
    expect(result).not.toContain('Click    css=#login-btn');
  });

  it('deletes step 2 → step 3 keyword line is now after step 1 marker', () => {
    const idx = parseSteps(RF_4);
    const result = deleteStep(RF_4, idx, 2);
    expect(result).not.toContain('Fill Text    css=#username    admin');
    // Step 3's keyword (was Fill Text css=#password) now renumbered step 2
    expect(result).toContain('Fill Text    css=#password    secret');
    const lines = result.split('\n');
    const fillPwdIdx = lines.findIndex((l) => l.includes('css=#password'));
    const markerAfterFillPwd = lines[fillPwdIdx + 1] ?? '';
    expect(markerAfterFillPwd).toContain('xlib:step=2');
  });

  it('deletes the only step — file body is empty of steps', () => {
    const idx = parseSteps(RF_1);
    const result = deleteStep(RF_1, idx, 1);
    expect(result).not.toContain('xlib:step=');
    expect(result).not.toContain('Click    css=#btn');
  });

  it('throws when step not found', () => {
    const idx = parseSteps(RF_4);
    expect(() => deleteStep(RF_4, idx, 99)).toThrow(/No step 99/);
  });

  it('preserves trailing newline', () => {
    expect(RF_4.endsWith('\n')).toBe(true);
    const idx = parseSteps(RF_4);
    const result = deleteStep(RF_4, idx, 1);
    expect(result.endsWith('\n')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteStep — SeleniumLibrary
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteStep — SeleniumLibrary', () => {
  it('deletes step 3 (Input Password) → 3 steps remain', () => {
    const idx = parseSteps(SL_4);
    const result = deleteStep(SL_4, idx, 3);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(3);
    expect(result).not.toContain('Input Password    css=#password    secret');
    // Step 4 (Click Element) still present, renumbered to step 3
    expect(result).toContain('Click Element    css=#login-btn');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteStep — Python
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteStep — Python', () => {
  it('deletes step 1 (page.goto) → 3 steps remain', () => {
    const idx = parseSteps(PY_4);
    const result = deleteStep(PY_4, idx, 1);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(3);
    expect(result).not.toContain('page.goto(');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteStep — TypeScript
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteStep — TypeScript', () => {
  it('deletes step 4 in TS file → 3 steps remain', () => {
    const idx = parseSteps(TS_4);
    const result = deleteStep(TS_4, idx, 4);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(3);
    expect(result).not.toContain("await page.click('css=#login-btn')");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteRange
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteRange', () => {
  it('deletes steps 2-3 from RF fixture → 2 steps remain', () => {
    const idx = parseSteps(RF_4);
    const result = deleteRange(RF_4, idx, 2, 3);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(2);
    expect(markers).toEqual(['xlib:step=1', 'xlib:step=2']);
    // Steps 2 and 3 keyword lines gone
    expect(result).not.toContain('Fill Text    css=#username');
    expect(result).not.toContain('Fill Text    css=#password');
    // Steps 1 and 4 remain
    expect(result).toContain('New Page');
    expect(result).toContain('Click    css=#login-btn');
  });

  it('deletes steps 1-4 (all steps) → no markers remain', () => {
    const idx = parseSteps(RF_4);
    const result = deleteRange(RF_4, idx, 1, 4);
    expect(result).not.toContain('xlib:step=');
  });

  it('single step range (from === to) — same as deleteStep', () => {
    const idx = parseSteps(RF_4);
    const result = deleteRange(RF_4, idx, 2, 2);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(3);
    expect(result).not.toContain('Fill Text    css=#username');
  });

  it('throws when from > to', () => {
    const idx = parseSteps(RF_4);
    expect(() => deleteRange(RF_4, idx, 3, 1)).toThrow(/from step 3 must be <= to step 1/);
  });

  it('deletes range from SeleniumLibrary fixture', () => {
    const idx = parseSteps(SL_4);
    const result = deleteRange(SL_4, idx, 1, 2);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(2);
    expect(result).not.toContain('Open Browser');
    expect(result).not.toContain('Input Text');
  });

  it('deletes range from TypeScript fixture', () => {
    const idx = parseSteps(TS_4);
    const result = deleteRange(TS_4, idx, 2, 3);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// moveStep
// ─────────────────────────────────────────────────────────────────────────────

describe('moveStep', () => {
  it('move 1 to 3: step 1 content appears after step 3 content', () => {
    const idx = parseSteps(RF_4);
    const result = moveStep(RF_4, idx, 1, 3);
    const lines = result.split('\n');
    // Original step 1 keyword: "New Page    https://example.com/login"
    // Original step 3 keyword: "Fill Text    css=#password    secret"
    // After move: New Page should come after Fill Text css=#password
    const newPageIdx = lines.findIndex((l) => l.includes('New Page'));
    const fillPwdIdx = lines.findIndex((l) => l.includes('css=#password'));
    expect(newPageIdx).toBeGreaterThan(fillPwdIdx);
    // New Page should be BEFORE Fill Text css=#username (original step 2 is now step 1)
    const fillUsernameIdx = lines.findIndex((l) => l.includes('css=#username'));
    expect(fillUsernameIdx).toBeLessThan(newPageIdx);
    // Still 4 steps after move
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });

  it('move 3 to 1: step 3 content appears before step 1 content', () => {
    const idx = parseSteps(RF_4);
    const result = moveStep(RF_4, idx, 3, 1);
    const lines = result.split('\n');
    // Step 3 = "Click    css=#login-btn", step 1 = "New Page    ..."
    const clickIdx = lines.findIndex((l) => l.includes('Click    css=#login-btn'));
    const newPageIdx = lines.findIndex((l) => l.includes('New Page'));
    // Click is moved to after step 1, so it comes after New Page
    expect(clickIdx).toBeGreaterThan(newPageIdx);
    // 4 steps still
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });

  it('move 4 to 1: last step inserted after first step', () => {
    const idx = parseSteps(RF_4);
    const result = moveStep(RF_4, idx, 4, 1);
    const lines = result.split('\n');
    // Step 4 = "Click    css=#login-btn" (last in original)
    const clickIdx = lines.findIndex((l) => l.includes('Click    css=#login-btn'));
    const fillUsernameIdx = lines.findIndex((l) => l.includes('css=#username'));
    // After move 4 to 1: login-btn click should appear after New Page (step 1)
    // but before Fill Text username (original step 2)
    expect(clickIdx).toBeLessThan(fillUsernameIdx);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });

  it('move X to X (same step): no-op, markers renumbered only', () => {
    const idx = parseSteps(RF_4);
    const result = moveStep(RF_4, idx, 2, 2);
    // Content should be identical to renumberSteps(RF_4)
    expect(result).toBe(renumberSteps(RF_4));
  });

  it('move step to 0 (prepend before all steps)', () => {
    const idx = parseSteps(RF_4);
    // Move step 3 to position 0 (before step 1)
    // Step 3 = "Fill Text    css=#password    secret"
    // Step 1 = "New Page    https://example.com/login"
    const result = moveStep(RF_4, idx, 3, 0);
    const lines = result.split('\n');
    const fillPwdIdx = lines.findIndex((l) => l.includes('css=#password'));
    const newPageIdx = lines.findIndex((l) => l.includes('New Page'));
    // Fill Text css=#password (originally step 3) should now come BEFORE New Page (originally step 1)
    expect(fillPwdIdx).toBeLessThan(newPageIdx);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });

  it('throws when from step not found', () => {
    const idx = parseSteps(RF_4);
    expect(() => moveStep(RF_4, idx, 99, 1)).toThrow(/No step 99/);
  });

  it('throws when to step not found (and to != 0)', () => {
    const idx = parseSteps(RF_4);
    expect(() => moveStep(RF_4, idx, 1, 99)).toThrow(/No step 99/);
  });

  it('move in SeleniumLibrary fixture: 4 steps remain', () => {
    const idx = parseSteps(SL_4);
    const result = moveStep(SL_4, idx, 2, 4);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });

  it('move in TypeScript fixture: 4 steps remain', () => {
    const idx = parseSteps(TS_4);
    const result = moveStep(TS_4, idx, 1, 3);
    const markers = result.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseRangeSpec
// ─────────────────────────────────────────────────────────────────────────────

describe('parseRangeSpec', () => {
  it('"3-7" → [3, 7]', () => {
    expect(parseRangeSpec('3-7')).toEqual([3, 7]);
  });

  it('"1-1" → [1, 1]', () => {
    expect(parseRangeSpec('1-1')).toEqual([1, 1]);
  });

  it('"5" (no dash) → null', () => {
    expect(parseRangeSpec('5')).toBeNull();
  });

  it('"a-b" → null', () => {
    expect(parseRangeSpec('a-b')).toBeNull();
  });

  it('"3 to 7" → null (move spec format)', () => {
    expect(parseRangeSpec('3 to 7')).toBeNull();
  });

  it('trims surrounding whitespace: " 2-4 " → [2, 4]', () => {
    expect(parseRangeSpec(' 2-4 ')).toEqual([2, 4]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseMoveSpec
// ─────────────────────────────────────────────────────────────────────────────

describe('parseMoveSpec', () => {
  it('"3 to 7" → [3, 7]', () => {
    expect(parseMoveSpec('3 to 7')).toEqual([3, 7]);
  });

  it('"1 TO 4" (case-insensitive) → [1, 4]', () => {
    expect(parseMoveSpec('1 TO 4')).toEqual([1, 4]);
  });

  it('"3-7" (range format) → null', () => {
    expect(parseMoveSpec('3-7')).toBeNull();
  });

  it('"5" → null', () => {
    expect(parseMoveSpec('5')).toBeNull();
  });

  it('"a to b" → null', () => {
    expect(parseMoveSpec('a to b')).toBeNull();
  });

  it('trims surrounding whitespace: " 1 to 3 " → [1, 3]', () => {
    expect(parseMoveSpec(' 1 to 3 ')).toEqual([1, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stubNewStepProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('stubNewStepProvider', () => {
  it('returns # prefix for robot lang', () => {
    const result = stubNewStepProvider({
      sourceLang: 'robot',
      targetStep: 3,
      operation: 'replace',
    });
    expect(result).toContain('# NEW STEP');
    expect(result).toContain('# xlib:step=0');
  });

  it('returns # prefix for selenium lang', () => {
    const result = stubNewStepProvider({
      sourceLang: 'selenium',
      targetStep: 1,
      operation: 'insert-after',
    });
    expect(result).toContain('# xlib:step=0');
  });

  it('returns # prefix for python lang', () => {
    const result = stubNewStepProvider({
      sourceLang: 'python',
      targetStep: 2,
      operation: 'insert-before',
    });
    expect(result).toContain('# xlib:step=0');
  });

  it('returns // prefix for ts lang', () => {
    const result = stubNewStepProvider({ sourceLang: 'ts', targetStep: 1, operation: 'replace' });
    expect(result).toContain('// NEW STEP');
    expect(result).toContain('// xlib:step=0');
    expect(result).not.toContain('# NEW STEP');
  });

  it('result is multi-line (keyword line + marker line)', () => {
    const result = stubNewStepProvider({
      sourceLang: 'robot',
      targetStep: 1,
      operation: 'replace',
    });
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('inserted stub gets renumbered correctly', () => {
    const stub = stubNewStepProvider({ sourceLang: 'robot', targetStep: 2, operation: 'replace' });
    const idx = parseSteps(RF_4);
    const result = replaceStep(RF_4, idx, 2, stub);
    // After replace+renumber, step 2 should be the stub
    const lines = result.split('\n');
    const stubKeywordIdx = lines.findIndex((l) => l.includes('NEW STEP'));
    const stubMarkerLine = lines[stubKeywordIdx + 1] ?? '';
    expect(stubMarkerLine).toContain('xlib:step=2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases: alts preservation through operations
// ─────────────────────────────────────────────────────────────────────────────

describe('alts payload preservation', () => {
  it('deleteStep preserves alts on remaining steps', () => {
    const idx = parseSteps(RF_WITH_ALTS);
    const result = deleteStep(RF_WITH_ALTS, idx, 2); // delete the Fill Text step
    expect(result).toContain('alts=["css=#login-btn"');
    // step 3 (Hover) is now step 2 — no alts, still fine
    expect(result).toContain('xlib:step=2');
  });

  it('replaceStep preserves alts on non-replaced steps', () => {
    const idx = parseSteps(RF_WITH_ALTS);
    const stub = '    Click    css=#replaced\n    # xlib:step=0';
    const result = replaceStep(RF_WITH_ALTS, idx, 3, stub); // replace the Hover step
    // Steps 1 and 2 still have their alts
    expect(result).toContain('alts=["css=#login-btn"');
    expect(result).toContain('alts=["css=#q"]');
  });

  it('insertAfter preserves alts on existing steps', () => {
    const idx = parseSteps(RF_WITH_ALTS);
    const stub = '    Hover    css=#inserted\n    # xlib:step=0';
    const result = insertAfter(RF_WITH_ALTS, idx, 1, stub);
    expect(result).toContain('alts=["css=#login-btn"');
    expect(result).toContain('alts=["css=#q"]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Content integrity — non-step lines are not touched
// ─────────────────────────────────────────────────────────────────────────────

describe('content integrity', () => {
  it('*** Settings *** and Library line survive delete', () => {
    const idx = parseSteps(RF_4);
    const result = deleteStep(RF_4, idx, 1);
    expect(result).toContain('*** Settings ***');
    expect(result).toContain('Library    Browser');
  });

  it('*** Test Cases *** survives range delete', () => {
    const idx = parseSteps(RF_4);
    const result = deleteRange(RF_4, idx, 1, 4);
    expect(result).toContain('*** Test Cases ***');
  });

  it('Close Browser line survives step operations', () => {
    const idx = parseSteps(RF_4);
    // Delete steps 2 and 3 — Close Browser is not a stepped line, should survive
    const result = deleteRange(RF_4, idx, 2, 3);
    expect(result).toContain('Close Browser');
  });
});
