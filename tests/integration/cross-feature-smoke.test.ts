/**
 * Cross-feature smoke tests.
 *
 * These tests exercise scenarios that combine multiple modules together,
 * simulating realistic use-cases the runner executes in production.
 *
 * Scenarios covered:
 *   1. JSONL content → parse → render → full .robot output (the JSONL bridge path)
 *   2. Generator captured actions → replay engine ActionInContext[] compatibility
 *   3. viewer-server broadcast + generator output: same content sent to WS clients
 *   4. Locator escaping round-trip: selector with RF-sensitive chars passes safely
 *      through the full generator → output pipeline
 *   5. signal-handler + generator + formatter: signals produce properly indented
 *      multi-line output that matches the 4-space body convention
 *   6. getCapturedActions() — generator accumulates actions per render pass,
 *      reset by generateHeader()
 *   7. Selenium openPage(blank)+navigate collapse mirrors RF collapse behavior
 *   8. preview-printer: printKeywordPreview does not throw on empty or populated input
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RobotFrameworkLanguageGenerator } from '../../src/codegen/robotframework.js';
import { SeleniumLibraryLanguageGenerator } from '../../src/codegen/selenium.js';
import { parseJsonlContent, jsonlEntryToStepLines } from '../../src/recorder/jsonl-bridge.js';
import { startViewerServer } from '../../src/recorder/viewer-server.js';
import { printKeywordPreview } from '../../src/recorder/preview-printer.js';
import { escapeRobotValue } from '../../src/codegen/locator-translator.js';
import type { ActionInContext } from '../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../fixtures/actions');

function loadFixture(name: string): ActionInContext[] {
  const raw = readFileSync(resolve(FIXTURES_DIR, `${name}.json`), 'utf8');
  return (JSON.parse(raw) as { actions: ActionInContext[] }).actions;
}

const defaultOptions = {
  browserName: 'chromium',
  launchOptions: {},
  contextOptions: {},
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: JSONL bridge path — content → parse → render → .robot output
// ─────────────────────────────────────────────────────────────────────────────

describe('Smoke: JSONL bridge → .robot output', () => {
  const HEADER = JSON.stringify({ browserName: 'chromium' });

  it('login flow via JSONL produces valid .robot structure', () => {
    const actions = [
      { name: 'openPage', url: 'about:blank', signals: [] },
      { name: 'navigate', url: 'https://app.example.com/login', signals: [] },
      { name: 'fill', selector: 'css=#email', text: 'user@example.com', signals: [] },
      { name: 'fill', selector: 'css=#password', text: 'hunter2', signals: [] },
      {
        name: 'click',
        selector: 'css=#login-btn',
        button: 'left',
        clickCount: 1,
        modifiers: 0,
        signals: [],
      },
    ];
    const content = [HEADER, ...actions.map((a) => JSON.stringify(a))].join('\n');
    const entries = parseJsonlContent(content);
    expect(entries).toHaveLength(actions.length);

    const gen = new RobotFrameworkLanguageGenerator();
    const header = gen.generateHeader(defaultOptions);
    const footer = gen.generateFooter(undefined);
    const stepLines: string[] = [];
    for (const entry of entries) {
      stepLines.push(...jsonlEntryToStepLines(entry, gen));
    }
    const robotOutput = [header, ...stepLines, footer].join('\n').trimEnd() + '\n';

    expect(robotOutput).toContain('*** Settings ***');
    expect(robotOutput).toContain('Library    Browser');
    expect(robotOutput).toContain('*** Test Cases ***');
    expect(robotOutput).toContain('Close Browser');
    // Navigate or New Page is present
    expect(robotOutput.includes('Go To') || robotOutput.includes('New Page')).toBe(true);
    expect(robotOutput).toContain('Fill Text');
    expect(robotOutput).toContain('user@example.com');
    expect(robotOutput).toContain('Click');
  });

  it('JSONL bridge output ends with a single trailing newline', () => {
    const content = [
      HEADER,
      JSON.stringify({ name: 'navigate', url: 'https://x.com', signals: [] }),
    ].join('\n');
    const entries = parseJsonlContent(content);
    const gen = new RobotFrameworkLanguageGenerator();
    const header = gen.generateHeader(defaultOptions);
    const footer = gen.generateFooter(undefined);
    const stepLines: string[] = [];
    for (const entry of entries) {
      stepLines.push(...jsonlEntryToStepLines(entry, gen));
    }
    const output = [header, ...stepLines, footer].join('\n').trimEnd() + '\n';
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: getCapturedActions() + replay engine compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe('Smoke: getCapturedActions() compatibility with replay engine', () => {
  it('getCapturedActions() returns the actions fed to generateAction()', () => {
    const actions = loadFixture('full-flow');
    const gen = new RobotFrameworkLanguageGenerator();
    gen.generateHeader(defaultOptions);
    for (const a of actions) {
      gen.generateAction(a);
    }
    const captured = gen.getCapturedActions();
    expect(captured.length).toBe(actions.length);
    // First action name matches
    expect(captured[0].action.name).toBe(actions[0].action.name);
  });

  it('getCapturedActions() is reset by generateHeader()', () => {
    const actions = loadFixture('click');
    const gen = new RobotFrameworkLanguageGenerator();
    gen.generateHeader(defaultOptions);
    for (const a of actions) gen.generateAction(a);
    expect(gen.getCapturedActions().length).toBeGreaterThan(0);

    // Second render pass — header resets capture
    gen.generateHeader(defaultOptions);
    expect(gen.getCapturedActions()).toHaveLength(0);
  });

  it('captured actions have valid frame and action fields for replay engine', () => {
    const actions = loadFixture('full-flow');
    const gen = new RobotFrameworkLanguageGenerator();
    gen.generateHeader(defaultOptions);
    for (const a of actions) gen.generateAction(a);
    for (const captured of gen.getCapturedActions()) {
      expect(captured.frame).toBeDefined();
      expect(captured.frame.pageAlias).toBeTruthy();
      expect(captured.action).toBeDefined();
      expect(typeof captured.action.name).toBe('string');
      expect(typeof captured.startTime).toBe('number');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: viewer-server + generator output round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Smoke: viewer-server receives generator output', () => {
  it('broadcast delivers the generated .robot content to a connected client', async () => {
    const { WebSocket } = await import('ws');
    const server = await startViewerServer(0);

    const actions = loadFixture('full-flow');
    const gen = new RobotFrameworkLanguageGenerator();
    const header = gen.generateHeader(defaultOptions);
    const parts = actions.map((a) => gen.generateAction(a as never)).filter(Boolean);
    const footer = gen.generateFooter(undefined); // called after actions to respect generator state
    const robotOutput = [header, ...parts, footer].join('\n').trimEnd() + '\n';

    const received: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      ws.once('open', () => {
        server.broadcast(robotOutput);
      });
      ws.on('message', (raw) => {
        const text = Buffer.isBuffer(raw)
          ? raw.toString('utf8')
          : Buffer.from(raw as ArrayBuffer).toString('utf8');
        const msg = JSON.parse(text) as { type: string; content?: string };
        if (msg.type === 'update' && msg.content) {
          received.push(msg.content);
          ws.close();
          server.close();
          resolve();
        }
      });
      ws.once('error', reject);
      setTimeout(() => reject(new Error('timeout')), 5000);
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toContain('*** Settings ***');
    expect(received[0]).toContain('Library    Browser');
  }, 10_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Locator escaping round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Smoke: locator escaping through generator pipeline', () => {
  it('selector containing ${var} is escaped in generator output', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=[data-id="${userId}"]',
        button: 'left',
        clickCount: 1,
        modifiers: 0,
        signals: [],
      },
      startTime: 0,
    } as never);
    // escapeRobotValue replaces `${` with `\${`.
    // After escaping, every `${` must be preceded by a backslash.
    // Verify the escaped form is present:
    expect(out).toContain('\\${userId}');
    // Verify no bare (unescaped) `${` exists by removing all escaped `\${`
    // occurrences first, then checking no `${` remains.
    const withoutEscapedRF = out.replace(/\\\$\{/g, '__ESCAPED__');
    expect(withoutEscapedRF.includes('${userId}')).toBe(false);
  });

  it('fill text containing @{list} is escaped in output', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'fill',
        selector: 'css=#input',
        text: 'value is @{myList}',
        signals: [],
      },
      startTime: 0,
    } as never);
    // escapeRobotValue replaces `@{` with `\@{`.
    // The output should contain the escaped form \@{myList}
    expect(out).toContain('\\@{myList}');
    // Verify no bare (unescaped) `@{` remains by removing escaped occurrences first.
    const withoutEscapedAt = out.replace(/\\@\{/g, '__ESCAPED__');
    expect(withoutEscapedAt.includes('@{myList}')).toBe(false);
  });

  it('URL containing %{env} is escaped in navigate output', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'navigate',
        url: 'https://example.com/%{BASE_PATH}/login',
        signals: [],
      },
      startTime: 0,
    } as never);
    expect(out).toContain('\\%{BASE_PATH}');
  });

  it('escapeRobotValue: multi-space inside value replaced with backslash-space pairs', () => {
    const result = escapeRobotValue('two  spaces');
    // The 2 spaces should become '\ \ ' (each space preceded by backslash)
    expect(result).toContain('\\ ');
    expect(result).not.toContain('  '); // no unescaped double spaces
  });

  it('escapeRobotValue: plain selectors without RF chars pass through unchanged', () => {
    expect(escapeRobotValue('css=#submit-btn')).toBe('css=#submit-btn');
    expect(escapeRobotValue('role=button[name="Click me"]')).toBe('role=button[name="Click me"]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: signal + formatter → 4-space body convention
// ─────────────────────────────────────────────────────────────────────────────

describe('Smoke: signal-handler output satisfies formatter invariants', () => {
  it('action with navigation signal produces multi-line output, all 4-space indented', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#submit',
        button: 'left',
        clickCount: 1,
        modifiers: 0,
        signals: [{ name: 'navigation', url: 'https://example.com/result' }],
      },
      startTime: 0,
    } as never);
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(1); // keyword + navigation comment
    for (const line of lines) {
      expect(line).toMatch(/^ {4}\S/);
    }
  });

  it('action with dialog signal produces Handle Alert comment before Click', () => {
    const gen = new RobotFrameworkLanguageGenerator();
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#delete',
        button: 'left',
        clickCount: 1,
        modifiers: 0,
        signals: [{ name: 'dialog', dialogAlias: 'confirmDelete' }],
      },
      startTime: 0,
    } as never);
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.some((l) => l.includes('Handle Alert'))).toBe(true);
    expect(lines.some((l) => l.includes('Click'))).toBe(true);
    // Handle Alert must come before Click
    const handleIdx = lines.findIndex((l) => l.includes('Handle Alert'));
    const clickIdx = lines.findIndex((l) => l.includes('Click'));
    expect(handleIdx).toBeLessThan(clickIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: SeleniumLibrary openPage+navigate collapse matches RF behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('Smoke: Selenium openPage+navigate collapse', () => {
  it('SL openPage(blank) + navigate → single Open Browser (mirrors RF behavior)', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    gen.generateHeader(defaultOptions);
    const blank = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'openPage', url: 'about:blank', signals: [] },
      startTime: 0,
    } as never);
    const nav = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'navigate', url: 'https://example.com/', signals: [] },
      startTime: 0,
    } as never);
    expect(blank).toBe(''); // collapsed
    expect(nav).toContain('Open Browser');
    expect(nav).toContain('https://example.com/');
  });

  it('SL second navigate after browser opened → Go To', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    gen.generateHeader(defaultOptions);
    gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'navigate', url: 'https://example.com/', signals: [] },
      startTime: 0,
    } as never);
    const secondNav = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'navigate', url: 'https://example.com/page2', signals: [] },
      startTime: 0,
    } as never);
    expect(secondNav).toContain('Go To');
    expect(secondNav).not.toContain('Open Browser');
  });

  it('RF and SL produce the same URL in their respective navigation keywords', () => {
    const url = 'https://my-app.example.com/dashboard';
    const rfGen = new RobotFrameworkLanguageGenerator();
    const slGen = new SeleniumLibraryLanguageGenerator();

    const rfOut = rfGen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'navigate', url, signals: [] },
      startTime: 0,
    } as never);

    slGen.generateHeader(defaultOptions); // initializes _currentBrowserName
    const slOut = slGen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: { name: 'navigate', url, signals: [] },
      startTime: 0,
    } as never);

    expect(rfOut).toContain(url);
    expect(slOut).toContain(url);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7: preview-printer smoke
// ─────────────────────────────────────────────────────────────────────────────

describe('Smoke: preview-printer', () => {
  it('printKeywordPreview does not throw on empty array', () => {
    expect(() => printKeywordPreview([])).not.toThrow();
  });

  it('printKeywordPreview does not throw on populated lines', () => {
    expect(() =>
      printKeywordPreview([
        '    New Browser    chromium',
        '    Go To    https://example.com',
        '    Click    css=#btn',
      ]),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8: Full fixture-set passes through both generators without errors
// ─────────────────────────────────────────────────────────────────────────────

describe('Smoke: all action fixtures render without throwing', () => {
  const fixtures = [
    'openPage',
    'closePage',
    'navigate',
    'click',
    'click-double',
    'fill',
    'press',
    'hover',
    'check',
    'uncheck',
    'select',
    'setInputFiles',
    'assertVisible',
    'assertText',
    'assertText-substring',
    'assertValue',
    'assertChecked',
    'assertChecked-unchecked',
    'assertSnapshot',
    'full-flow',
  ];

  for (const name of fixtures) {
    it(`RF generator does not throw on ${name} fixture`, () => {
      const actions = loadFixture(name);
      const gen = new RobotFrameworkLanguageGenerator();
      const header = gen.generateHeader(defaultOptions);
      const footer = gen.generateFooter(undefined);
      const parts: string[] = [];
      expect(() => {
        for (const a of actions) parts.push(gen.generateAction(a));
      }).not.toThrow();
      expect([header, ...parts.filter(Boolean), footer].join('\n').length).toBeGreaterThan(0);
    });

    it(`SL generator does not throw on ${name} fixture`, () => {
      const actions = loadFixture(name);
      const gen = new SeleniumLibraryLanguageGenerator();
      const header = gen.generateHeader(defaultOptions);
      const footer = gen.generateFooter(undefined);
      const parts: string[] = [];
      expect(() => {
        for (const a of actions) parts.push(gen.generateAction(a));
      }).not.toThrow();
      expect([header, ...parts.filter(Boolean), footer].join('\n').length).toBeGreaterThan(0);
    });
  }
});
