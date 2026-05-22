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

describe('RF emitter — xlib:step markers (no alternatives)', () => {
  it('click action has # xlib:step=1', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const actions = loadFixture('click');
    const output = generateFull(gen, actions);
    expect(output).toContain('    # xlib:step=1');
  });

  it('step counter is monotonic across multiple actions', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const actions = loadFixture('full-flow');
    const output = generateFull(gen, actions);
    expect(output).toContain('# xlib:step=1');
    expect(output).toContain('# xlib:step=2');
    expect(output).toContain('# xlib:step=3');
    expect(output).toContain('# xlib:step=4');
    expect(output).toContain('# xlib:step=5');
    expect(output).not.toContain('# xlib:step=6');
  });

  it('generateHeader() resets the step counter', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const actions = loadFixture('click');

    // First render
    const first = generateFull(gen, actions);
    expect(first).toContain('# xlib:step=1');
    expect(first).not.toContain('# xlib:step=2');

    // Second render — header should reset to step=1
    const second = generateFull(gen, actions);
    expect(second).toContain('# xlib:step=1');
    expect(second).not.toContain('# xlib:step=2');
  });

  it('openPage(about:blank) does NOT consume a step number', () => {
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
    expect(blank).toBe(''); // openPage(about:blank) is skipped — no step consumed
    expect(nav).toContain('# xlib:step=1'); // navigate collapses to New Page, step=1
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
    expect(step).toContain('# xlib:step=1');
    expect(step).not.toContain(';alts=');
  });

  it('action with no alternatives field → step-only (graceful degrade)', () => {
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
    expect(step).toContain('# xlib:step=1');
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

  it('click action has # xlib:step=1', () => {
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
    expect(step).toContain('# xlib:step=1');
  });

  it('step counter increments correctly across multiple actions', () => {
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
    expect(a1).toContain('# xlib:step=1');
    expect(a2).toContain('# xlib:step=2');
  });

  it('generateHeader() resets Selenium step counter', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    gen.generateHeader(defaultOptions);
    const a1 = gen.generateAction({
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
    expect(a1).toContain('# xlib:step=1');

    // Reset via generateHeader — counter should restart from 1
    gen.generateHeader(defaultOptions);
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
    expect(a2).toContain('# xlib:step=1'); // reset to 1, not 2
  });
});
