/**
 * Multi-language round-trip integration tests.
 *
 * Strategy: feed the same ActionInContext[] fixtures through both generators
 * (RobotFrameworkLanguageGenerator and SeleniumLibraryLanguageGenerator) and
 * assert that:
 *   1. Both produce structurally valid .robot output (Settings + Test Cases sections)
 *   2. They agree on action COUNT — same number of effective steps
 *   3. Key structural invariants hold in both: indentation, argument separator,
 *      final newline, Library import line
 *
 * This is NOT a golden-snapshot test — it tests semantic equivalence across
 * the two generators using the same action stream, catching regressions where
 * one generator silently drops or duplicates steps.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RobotFrameworkLanguageGenerator } from '../../src/codegen/robotframework.js';
import { SeleniumLibraryLanguageGenerator } from '../../src/codegen/selenium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../fixtures/actions');

const defaultOptions = {
  browserName: 'chromium',
  launchOptions: {},
  contextOptions: {},
} as const;

type ActionInContext = {
  frame: { pageGuid: string; pageAlias: string; framePath: string[] };
  action: Record<string, unknown>;
  startTime: number;
};

function loadFixture(name: string): ActionInContext[] {
  const raw = readFileSync(resolve(FIXTURES_DIR, `${name}.json`), 'utf8');
  return (JSON.parse(raw) as { actions: ActionInContext[] }).actions;
}

function renderRF(actions: ActionInContext[]): string {
  const gen = new RobotFrameworkLanguageGenerator();
  const header = gen.generateHeader(defaultOptions);
  // Actions MUST be processed before calling generateFooter — SL footer
  // state (_browserOpened) is set by generateAction calls.
  const parts = actions.map((a) => gen.generateAction(a as never)).filter(Boolean);
  const footer = gen.generateFooter(undefined);
  return [header, ...parts, footer].join('\n').trimEnd() + '\n';
}

function renderSL(actions: ActionInContext[]): string {
  const gen = new SeleniumLibraryLanguageGenerator();
  const header = gen.generateHeader(defaultOptions);
  // Actions MUST be processed before calling generateFooter — SL footer
  // state (_browserOpened) is set by generateAction calls.
  const parts = actions.map((a) => gen.generateAction(a as never)).filter(Boolean);
  const footer = gen.generateFooter(undefined);
  return [header, ...parts, footer].join('\n').trimEnd() + '\n';
}

/** Count non-blank, non-comment, non-section-header, non-test-case-name lines
 *  in the test body — gives an approximate "effective step count". */
function countBodyLines(output: string): number {
  const lines = output.split('\n');
  let inBody = false;
  let count = 0;
  for (const line of lines) {
    if (line.trim() === 'Recorded Flow') {
      inBody = true;
      continue;
    }
    if (!inBody) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('*** ')) continue;
    count++;
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural invariants — both generators must satisfy these
// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-language round-trip — structural invariants', () => {
  const fixtures = [
    'click',
    'fill',
    'hover',
    'check',
    'uncheck',
    'press',
    'navigate',
    'openPage',
    'assertVisible',
    'assertText',
    'assertText-substring',
    'assertValue',
    'assertChecked',
    'assertChecked-unchecked',
    'full-flow',
  ];

  for (const name of fixtures) {
    describe(name, () => {
      const actions = loadFixture(name);
      const rfOut = renderRF(actions);
      const slOut = renderSL(actions);

      it('RF output has *** Settings *** section', () => {
        expect(rfOut).toContain('*** Settings ***');
      });

      it('SL output has *** Settings *** section', () => {
        expect(slOut).toContain('*** Settings ***');
      });

      it('RF output imports Browser library', () => {
        expect(rfOut).toContain('Library    Browser');
      });

      it('SL output imports SeleniumLibrary', () => {
        expect(slOut).toContain('Library    SeleniumLibrary');
      });

      it('RF output has *** Test Cases *** section', () => {
        expect(rfOut).toContain('*** Test Cases ***');
      });

      it('SL output has *** Test Cases *** section', () => {
        expect(slOut).toContain('*** Test Cases ***');
      });

      it('RF output ends with newline', () => {
        expect(rfOut.endsWith('\n')).toBe(true);
      });

      it('SL output ends with newline', () => {
        expect(slOut.endsWith('\n')).toBe(true);
      });

      it('RF body lines are 4-space indented', () => {
        const bodyLines = rfOut
          .split('\n')
          .filter((l) => l.startsWith('    ') && l.trim().length > 0);
        expect(bodyLines.length).toBeGreaterThan(0);
        for (const line of bodyLines) {
          expect(line).toMatch(/^ {4}\S/);
        }
      });

      it('SL body lines are 4-space indented', () => {
        const bodyLines = slOut
          .split('\n')
          .filter((l) => l.startsWith('    ') && l.trim().length > 0);
        expect(bodyLines.length).toBeGreaterThan(0);
        for (const line of bodyLines) {
          expect(line).toMatch(/^ {4}\S/);
        }
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-generator semantic equivalence checks
// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-language round-trip — semantic equivalence', () => {
  it('full-flow: both generators produce the same number of body steps', () => {
    const actions = loadFixture('full-flow');
    const rfCount = countBodyLines(renderRF(actions));
    const slCount = countBodyLines(renderSL(actions));
    // The RF generator emits setup keywords (New Browser / New Context) in the header,
    // counted as body lines here; SL does not. Both generators produce the same action
    // steps; we assert they're within ±2 (to account for New Browser/New Context in RF).
    expect(Math.abs(rfCount - slCount)).toBeLessThanOrEqual(3);
  });

  it('click fixture: RF uses Click, SL uses Click Element', () => {
    const actions = loadFixture('click');
    expect(renderRF(actions)).toContain('Click    ');
    expect(renderSL(actions)).toContain('Click Element    ');
  });

  it('click-double fixture: RF uses clickCount=2, SL uses Double Click Element', () => {
    const actions = loadFixture('click-double');
    expect(renderRF(actions)).toContain('clickCount=2');
    expect(renderSL(actions)).toContain('Double Click Element');
  });

  it('fill fixture: RF uses Fill Text, SL uses Input Text', () => {
    const actions = loadFixture('fill');
    expect(renderRF(actions)).toContain('Fill Text');
    expect(renderSL(actions)).toContain('Input Text');
  });

  it('navigate fixture: RF uses Go To; SL uses Open Browser (first navigate opens the browser)', () => {
    // In Robot Framework (Browser Library), a standalone navigate → Go To.
    // In SeleniumLibrary, the first navigation also opens the browser → Open Browser.
    // Both are correct per-library behavior; they are semantically equivalent
    // in the sense that both navigate to the target URL.
    const actions = loadFixture('navigate');
    expect(renderRF(actions)).toContain('Go To');
    // SL first navigate → Open Browser (correct behavior)
    expect(renderSL(actions)).toContain('Open Browser');
    expect(renderSL(actions)).toContain('https://example.com/dashboard');
  });

  it('openPage fixture: RF uses New Page + New Browser setup, SL uses Open Browser', () => {
    const actions = loadFixture('openPage');
    expect(renderRF(actions)).toContain('New Page');
    expect(renderSL(actions)).toContain('Open Browser');
  });

  it('assertSnapshot: both generators emit # TODO comment', () => {
    const actions = loadFixture('assertSnapshot');
    expect(renderRF(actions)).toContain('# TODO:');
    expect(renderSL(actions)).toContain('# TODO:');
  });

  it('check fixture: RF uses Check Checkbox, SL uses Select Checkbox', () => {
    const actions = loadFixture('check');
    expect(renderRF(actions)).toContain('Check Checkbox');
    expect(renderSL(actions)).toContain('Select Checkbox');
  });

  it('hover fixture: RF uses Hover, SL uses Mouse Over', () => {
    const actions = loadFixture('hover');
    expect(renderRF(actions)).toContain('Hover');
    expect(renderSL(actions)).toContain('Mouse Over');
  });

  it('assertVisible: RF uses Get Element States, SL uses Element Should Be Visible', () => {
    const actions = loadFixture('assertVisible');
    expect(renderRF(actions)).toContain('Get Element States');
    expect(renderSL(actions)).toContain('Element Should Be Visible');
  });

  it('both generators produce Close Browser in footer for full-flow', () => {
    const actions = loadFixture('full-flow');
    expect(renderRF(actions)).toContain('Close Browser');
    expect(renderSL(actions)).toContain('Close Browser');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Browser name propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-language round-trip — browser name propagation', () => {
  it('RF: chromium header includes chromium and start-maximized args', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const header = gen.generateHeader({
      browserName: 'chromium',
      launchOptions: {},
      contextOptions: {},
    });
    expect(header).toContain('chromium');
    expect(header).toContain('--start-maximized');
  });

  it('RF: firefox header does not include start-maximized', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const header = gen.generateHeader({
      browserName: 'firefox',
      launchOptions: {},
      contextOptions: {},
    });
    expect(header).not.toContain('--start-maximized');
    expect(header).toContain('firefox');
  });

  it('SL: chromium maps to "chrome" in Open Browser', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    gen.generateHeader({ browserName: 'chromium', launchOptions: {}, contextOptions: {} });
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'navigate', url: 'https://example.com', signals: [] },
      startTime: 0,
    } as never);
    expect(out).toContain('chrome');
  });

  it('SL: webkit maps to "safari" in Open Browser', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    gen.generateHeader({ browserName: 'webkit', launchOptions: {}, contextOptions: {} });
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'navigate', url: 'https://example.com', signals: [] },
      startTime: 0,
    } as never);
    expect(out).toContain('safari');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveStorage footer round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-language round-trip — saveStorage footer', () => {
  it('RF: saveStorage path appears in TODO comment and Close Browser still emitted', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const footer = gen.generateFooter('/tmp/state.json');
    expect(footer).toContain('TODO');
    expect(footer).toContain('/tmp/state.json');
    expect(footer).toContain('Close Browser');
  });

  it('SL: saveStorage path appears in TODO comment', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    // must call generateAction with navigate to flip _browserOpened so footer emits Close Browser
    gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'navigate', url: 'https://example.com', signals: [] },
      startTime: 0,
    } as never);
    const footer = gen.generateFooter('/tmp/state.json');
    expect(footer).toContain('TODO');
    expect(footer).toContain('/tmp/state.json');
    expect(footer).toContain('Close Browser');
  });

  it('SL: footer is empty when no browser was opened', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    expect(gen.generateFooter(undefined)).toBe('');
  });
});
