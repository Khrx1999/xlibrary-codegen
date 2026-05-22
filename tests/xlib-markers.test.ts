/**
 * Snapshot tests for xlib:step=N marker emission in all emitters.
 *
 * Covers:
 *   - Robot Framework emitter: step markers in all action types
 *   - Robot Framework emitter: step + alts when alternatives[] present
 *   - SeleniumLibrary emitter: step markers and alts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RobotFrameworkLanguageGenerator } from '../src/codegen/robotframework.js';
import { SeleniumLibraryLanguageGenerator } from '../src/codegen/selenium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const defaultOptions = {
  browserName: 'chromium',
  launchOptions: {},
  contextOptions: {},
} as const;

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

function generateFull(
  generator: RobotFrameworkLanguageGenerator,
  actions: ActionInContext[],
): string {
  const header = generator.generateHeader(defaultOptions);
  const footer = generator.generateFooter(undefined);
  const actionTexts = actions.map((a) => generator.generateAction(a as never)).filter(Boolean);
  return [header, ...actionTexts, footer].join('\n').trimEnd() + '\n';
}

function renderSelenium(fixtureName: string): string {
  const gen = new SeleniumLibraryLanguageGenerator('Recorded Flow');
  const actions = loadFixture(fixtureName);
  const header = gen.generateHeader(defaultOptions);
  const body = actions
    .map((a) => gen.generateAction(a as unknown as Parameters<typeof gen.generateAction>[0]))
    .filter((s) => s !== '')
    .join('\n');
  const footer = gen.generateFooter();
  return (
    [header, body, footer]
      .filter((s) => s)
      .join('\n')
      .trimEnd() + '\n'
  );
}

// ---------------------------------------------------------------------------
// Robot Framework — step counter basics
// ---------------------------------------------------------------------------

describe('RF emitter — clean output without alternatives', () => {
  // v0.2.1 design change: bare `# xlib:step=N` lines were too noisy in practice.
  // The emitter now ONLY emits the xlib comment when there's a meaningful
  // `alts=[...]` payload (i.e. when JSONL-bridge mode populates alternatives).
  // Direct-mode output is clean — no marker clutter.

  it('click action with no alternatives → no xlib comment', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const actions = loadFixture('click');
    const output = generateFull(gen, actions);
    expect(output).not.toContain('# xlib:step');
    expect(output).toContain('Click'); // keyword still emitted
  });

  it('full flow with no alternatives → no xlib comments anywhere', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const actions = loadFixture('full-flow');
    const output = generateFull(gen, actions);
    expect(output).not.toContain('# xlib:step');
  });

  it('openPage(about:blank) is still skipped (no step consumed)', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const actions: ActionInContext[] = [
      {
        frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
        action: { name: 'openPage', url: 'about:blank', signals: [] },
        startTime: 0,
      },
      {
        frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
        action: { name: 'navigate', url: 'https://example.com', signals: [] },
        startTime: 0,
      },
    ];
    const header = gen.generateHeader(defaultOptions);
    const blank = gen.generateAction(actions[0] as never);
    const nav = gen.generateAction(actions[1] as never);

    void header;
    expect(blank).toBe(''); // openPage(about:blank) is skipped — no output
    expect(nav).toContain('New Page'); // navigate collapses to New Page
    expect(nav).not.toContain('# xlib:step'); // no marker (no alts)
  });
});

// ---------------------------------------------------------------------------
// Robot Framework — step + alts (snapshot tests)
// ---------------------------------------------------------------------------

describe('RF emitter — xlib:step + alts (with alternatives[])', () => {
  it('click-with-alts matches snapshot', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const output = generateFull(gen, loadFixture('click-with-alts'));
    expect(output).toBe(loadSnapshot('click-with-alts'));
  });

  it('fill-with-alts matches snapshot', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const output = generateFull(gen, loadFixture('fill-with-alts'));
    expect(output).toBe(loadSnapshot('fill-with-alts'));
  });

  it('alts comment contains JSON array of ranked selectors', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const actions = loadFixture('click-with-alts');
    const output = generateFull(gen, actions);
    expect(output).toContain(';alts=[');
    const altsMatch = /;alts=(\[.+\])/.exec(output);
    expect(altsMatch).not.toBeNull();
    if (altsMatch) {
      const parsed: unknown = JSON.parse(altsMatch[1]);
      expect(Array.isArray(parsed)).toBe(true);
      expect((parsed as unknown[]).length).toBeLessThanOrEqual(3);
    }
  });

  it('primary selector is NOT in the alts array', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const output = generateFull(gen, loadFixture('click-with-alts'));
    const altsMatch = /;alts=(\[.+\])/.exec(output);
    expect(altsMatch).not.toBeNull();
    if (altsMatch) {
      const alts = JSON.parse(altsMatch[1]) as string[];
      // The primary selector ranked first is excluded from alts (slice starts at 1)
      expect(alts).not.toContain('internal:role=button[name="Sign In" s]');
    }
  });

  it('action with only 1 alternative → step-only (no alts clause)', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const singleAltActions: ActionInContext[] = [
      {
        frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
        action: {
          name: 'click',
          selector: 'css=#btn',
          button: 'left',
          modifiers: 0,
          clickCount: 1,
          signals: [],
          alternatives: ['css=#btn'], // only 1 entry = primary, no alts
        },
        startTime: 0,
      },
    ];
    const header = gen.generateHeader(defaultOptions);
    const step = gen.generateAction(singleAltActions[0] as never);
    void header;
    // v0.2.1: single-candidate steps emit NO xlib comment (alts list is empty
    // after filtering the primary → nothing meaningful to record).
    expect(step).not.toContain('# xlib:step');
    expect(step).not.toContain(';alts=');
  });

  it('action with no alternatives field → no xlib comment (clean output)', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    gen.generateHeader(defaultOptions);
    const step = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#btn',
        button: 'left',
        modifiers: 0,
        clickCount: 1,
        signals: [],
        // no alternatives field
      },
      startTime: 0,
    } as never);
    expect(step).not.toContain('# xlib:step');
    expect(step).not.toContain(';alts=');
  });
});

// ---------------------------------------------------------------------------
// SeleniumLibrary — step + alts (snapshot tests)
// ---------------------------------------------------------------------------

describe('Selenium emitter — xlib:step markers', () => {
  it('click-with-alts matches snapshot', () => {
    const output = renderSelenium('click-with-alts');
    expect(output).toBe(loadSnapshot('click-with-alts.selenium'));
  });

  it('click action with no alternatives → no xlib comment (clean output)', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    gen.generateHeader(defaultOptions);
    const step = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#btn',
        button: 'left',
        modifiers: 0,
        clickCount: 1,
        signals: [],
      },
      startTime: 0,
    } as unknown as Parameters<typeof gen.generateAction>[0]);
    expect(step).not.toContain('# xlib:step');
  });

  it('multi-action flow with no alternatives produces no xlib comments', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    gen.generateHeader(defaultOptions);
    const a1 = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'navigate', url: 'https://example.com', signals: [] },
      startTime: 0,
    } as unknown as Parameters<typeof gen.generateAction>[0]);
    const a2 = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#btn',
        button: 'left',
        modifiers: 0,
        clickCount: 1,
        signals: [],
      },
      startTime: 0,
    } as unknown as Parameters<typeof gen.generateAction>[0]);
    expect(a1).not.toContain('# xlib:step');
    expect(a2).not.toContain('# xlib:step');
  });

  it('generateHeader() resets the captured-actions snapshot', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    gen.generateHeader(defaultOptions);
    gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#btn',
        button: 'left',
        modifiers: 0,
        clickCount: 1,
        signals: [],
      },
      startTime: 0,
    } as unknown as Parameters<typeof gen.generateAction>[0]);
    expect(gen.getCapturedActions()).toHaveLength(1);

    // generateHeader resets the captured-actions array AND the step counter.
    gen.generateHeader(defaultOptions);
    expect(gen.getCapturedActions()).toHaveLength(0);

    gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#btn',
        button: 'left',
        modifiers: 0,
        clickCount: 1,
        signals: [],
      },
      startTime: 0,
    } as unknown as Parameters<typeof gen.generateAction>[0]);
    // After reset + 1 new action, captured = 1 again (not 2)
    expect(gen.getCapturedActions()).toHaveLength(1);
  });
});
