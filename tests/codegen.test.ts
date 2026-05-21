/**
 * Snapshot tests for RobotFrameworkLanguageGenerator.
 *
 * Each test:
 *   1. Loads a fixture JSON from tests/fixtures/actions/<name>.json
 *   2. Feeds it through the generator (header + action lines + footer)
 *   3. Compares the full output to tests/snapshots/<name>.robot
 *
 * IMPORTANT: If tests in the "Action generation" groups fail, that is an EMITTER BUG.
 * Do NOT modify snapshots or src/ to silence failures.
 * File a task for the `robot-emitter` owner instead.
 *
 * Known discrepancies to investigate (filed for robot-emitter/browser-keyword owners):
 *   - select: emitter hardcodes 'text' strategy; keywords-map argTemplate uses 'value'.
 *     Snapshots use 'text' (what the emitter actually produces). Clarify correct strategy.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RobotFrameworkLanguageGenerator } from '../src/codegen/robotframework.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Minimal options passed to generateHeader() in tests
// (mirrors LanguageGeneratorOptions from vendor/playwright types.ts)
// ---------------------------------------------------------------------------

const defaultOptions = {
  browserName: 'chromium',
  launchOptions: {},
  contextOptions: {},
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ActionInContext shape — mirrors @recorder/actions without vendor import */
type ActionInContext = {
  frame: { pageGuid: string; pageAlias: string; framePath: string[] };
  action: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  description?: string;
};

function loadFixture(name: string): ActionInContext[] {
  const p = resolve(__dirname, 'fixtures/actions', `${name}.json`);
  const raw = readFileSync(p, 'utf8');
  return (JSON.parse(raw) as { actions: ActionInContext[] }).actions;
}

function loadSnapshot(name: string): string {
  const p = resolve(__dirname, 'snapshots', `${name}.robot`);
  return readFileSync(p, 'utf8');
}

/**
 * Simulate the generateCode() orchestration from vendor/playwright/language.ts:
 *   text = [header, ...actionTexts.filter(Boolean), footer].join('\n')
 *
 * filter(Boolean) mirrors language.ts:25 — actions returning '' are skipped.
 *
 * No extra '\n' is appended: when footer === '' the join already ends with '\n'
 * (because join puts '\n' before the trailing empty string).
 * Example: ['header', 'action', ''].join('\n') === 'header\naction\n'
 */
function generateFull(
  generator: RobotFrameworkLanguageGenerator,
  actions: ActionInContext[],
): string {
  const header = generator.generateHeader(defaultOptions);
  const footer = generator.generateFooter(undefined);
  const actionTexts = actions.map((a) => generator.generateAction(a as never)).filter(Boolean);
  // Ensure exactly one trailing newline regardless of whether footer is '' or non-empty.
  // When footer='': join produces '...action\n' (trailing \n before empty string).
  // When footer='    Close Browser': join produces '...Close Browser' (no trailing \n).
  // trimEnd() + '\n' normalises both cases.
  return [header, ...actionTexts, footer].join('\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// Generator structure tests
// ---------------------------------------------------------------------------

describe('RobotFrameworkLanguageGenerator — structure', () => {
  const gen = new RobotFrameworkLanguageGenerator();

  it('has correct id and group', () => {
    expect(gen.id).toBe('robotframework');
    expect(gen.groupName).toBe('Robot Framework');
    expect(gen.name).toBe('Browser Library');
  });

  it('generateHeader() emits *** Settings *** section with Browser import', () => {
    const header = gen.generateHeader(defaultOptions);
    expect(header).toContain('*** Settings ***');
    expect(header).toContain('Library    Browser');
  });

  it('generateHeader() emits *** Test Cases *** section', () => {
    const header = gen.generateHeader(defaultOptions);
    expect(header).toContain('*** Test Cases ***');
    expect(header).toContain('Recorded Flow');
  });

  it('generateFooter(undefined) emits Close Browser', () => {
    expect(gen.generateFooter(undefined)).toBe('    Close Browser');
  });

  it('generateFooter with saveStorage emits TODO comment + Close Browser', () => {
    const footer = gen.generateFooter('/tmp/state.json');
    expect(footer).toContain('TODO');
    expect(footer).toContain('Close Browser');
  });

  it('header snapshot — exact whitespace contract', () => {
    expect(gen.generateHeader(defaultOptions as never)).toBe(
      [
        '*** Settings ***',
        'Library    Browser',
        '',
        '*** Test Cases ***',
        'Recorded Flow',
        '    New Browser    chromium    headless=${False}    args=["--start-maximized"]',
        '    New Context    viewport=None',
      ].join('\n'),
    );
  });
});

// ---------------------------------------------------------------------------
// Action generation — navigation
// ---------------------------------------------------------------------------

describe('Action generation — navigation', () => {
  const gen = new RobotFrameworkLanguageGenerator();

  it('openPage → New Page <url>', () => {
    expect(generateFull(gen, loadFixture('openPage'))).toBe(loadSnapshot('openPage'));
  });

  it('closePage → Close Page keyword (emitter emits it)', () => {
    expect(generateFull(gen, loadFixture('closePage'))).toBe(loadSnapshot('closePage'));
  });

  it('navigate → Go To <url>', () => {
    expect(generateFull(gen, loadFixture('navigate'))).toBe(loadSnapshot('navigate'));
  });
});

// ---------------------------------------------------------------------------
// Action generation — interaction
// ---------------------------------------------------------------------------

describe('Action generation — interaction', () => {
  const gen = new RobotFrameworkLanguageGenerator();

  it('click (single) → Click <selector>', () => {
    expect(generateFull(gen, loadFixture('click'))).toBe(loadSnapshot('click'));
  });

  it('click (double, clickCount=2) → comment + Double Click <selector>', () => {
    // Emitter emits a clarifying comment then the Double Click keyword.
    expect(generateFull(gen, loadFixture('click-double'))).toBe(loadSnapshot('click-double'));
  });

  it('fill → Fill Text <selector> <text>', () => {
    expect(generateFull(gen, loadFixture('fill'))).toBe(loadSnapshot('fill'));
  });

  it('press → Press Keys <selector> <key>', () => {
    expect(generateFull(gen, loadFixture('press'))).toBe(loadSnapshot('press'));
  });

  it('hover → Hover <selector>', () => {
    expect(generateFull(gen, loadFixture('hover'))).toBe(loadSnapshot('hover'));
  });
});

// ---------------------------------------------------------------------------
// Action generation — form controls
// ---------------------------------------------------------------------------

describe('Action generation — form controls', () => {
  const gen = new RobotFrameworkLanguageGenerator();

  it('check → Check Checkbox <selector>', () => {
    expect(generateFull(gen, loadFixture('check'))).toBe(loadSnapshot('check'));
  });

  it('uncheck → Uncheck Checkbox <selector>', () => {
    expect(generateFull(gen, loadFixture('uncheck'))).toBe(loadSnapshot('uncheck'));
  });

  it('select → Select Options By <selector> text <option>', () => {
    // NOTE: emitter uses 'text' strategy; keywords-map argTemplate uses 'value'.
    // Snapshot reflects emitter output ('text'). Tracked as discrepancy for
    // robot-emitter + browser-keyword owners to resolve.
    expect(generateFull(gen, loadFixture('select'))).toBe(loadSnapshot('select'));
  });

  it('setInputFiles → Upload File By Selector <selector> <file>', () => {
    expect(generateFull(gen, loadFixture('setInputFiles'))).toBe(loadSnapshot('setInputFiles'));
  });
});

// ---------------------------------------------------------------------------
// Action generation — assertions
// ---------------------------------------------------------------------------

describe('Action generation — assertions', () => {
  const gen = new RobotFrameworkLanguageGenerator();

  it('assertVisible → Get Element States <selector> *= visible', () => {
    expect(generateFull(gen, loadFixture('assertVisible'))).toBe(loadSnapshot('assertVisible'));
  });

  it('assertText (exact, substring=false) → Get Text <selector> == <text>', () => {
    expect(generateFull(gen, loadFixture('assertText'))).toBe(loadSnapshot('assertText'));
  });

  it('assertText (contains, substring=true) → Get Text <selector> *= <text>', () => {
    expect(generateFull(gen, loadFixture('assertText-substring'))).toBe(
      loadSnapshot('assertText-substring'),
    );
  });

  it('assertValue → Get Property <selector> value == <value>', () => {
    expect(generateFull(gen, loadFixture('assertValue'))).toBe(loadSnapshot('assertValue'));
  });

  it('assertChecked (checked=true) → Get Checkbox State <selector> == checked', () => {
    expect(generateFull(gen, loadFixture('assertChecked'))).toBe(loadSnapshot('assertChecked'));
  });

  it('assertChecked (checked=false) → Get Checkbox State <selector> == unchecked', () => {
    expect(generateFull(gen, loadFixture('assertChecked-unchecked'))).toBe(
      loadSnapshot('assertChecked-unchecked'),
    );
  });

  it('assertSnapshot → emits # TODO comment block (no Browser Library equivalent)', () => {
    expect(generateFull(gen, loadFixture('assertSnapshot'))).toBe(loadSnapshot('assertSnapshot'));
  });
});

// ---------------------------------------------------------------------------
// Multi-action flow
// ---------------------------------------------------------------------------

describe('Action generation — multi-action flow', () => {
  const gen = new RobotFrameworkLanguageGenerator();

  it('full login flow produces correct multi-step .robot output', () => {
    expect(generateFull(gen, loadFixture('full-flow'))).toBe(loadSnapshot('full-flow'));
  });
});
