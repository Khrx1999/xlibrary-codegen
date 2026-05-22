/**
 * Regression tests for the openPage(blank) + navigate collapse logic.
 *
 * Background:
 *   When Playwright's recorder is launched with a URL (via CLI argument or
 *   page.goto inside the runner), the JSONL stream is:
 *     {"name":"openPage","url":"about:blank",...}
 *     {"name":"navigate","url":"<actual url>",...}
 *
 *   Without collapse this produces `Go To <url>` with no `New Page` keyword,
 *   surprising the test reader. The fix tracks `_pendingBlankPage` in the
 *   generator and merges the pair into `New Page <url>`.
 */

import { describe, it, expect } from 'vitest';
import { RobotFrameworkLanguageGenerator } from '../src/codegen/robotframework.js';
import type { ActionInContext } from '../src/types.js';

function ctx(name: string, fields: Record<string, unknown> = {}): ActionInContext {
  return {
    frame: { pageGuid: 'page@x', pageAlias: 'page', framePath: [] },
    action: { name, signals: [], ...fields } as unknown as ActionInContext['action'],
    startTime: 0,
  };
}

describe('openPage+navigate collapse', () => {
  it('collapses openPage(about:blank) + navigate → single New Page', () => {
    const g = new RobotFrameworkLanguageGenerator();
    const blank = g.generateAction(ctx('openPage', { url: 'about:blank' }));
    const nav = g.generateAction(ctx('navigate', { url: 'https://playwright.dev/' }));

    expect(blank).toBe('');
    expect(nav).toContain('    New Page    https://playwright.dev/');
  });

  it('collapses openPage(chrome://newtab) + navigate → single New Page', () => {
    const g = new RobotFrameworkLanguageGenerator();
    g.generateAction(ctx('openPage', { url: 'chrome://newtab/' }));
    const nav = g.generateAction(ctx('navigate', { url: 'https://example.com/' }));
    expect(nav).toContain('    New Page    https://example.com/');
  });

  it('plain navigate (no prior openPage) stays Go To', () => {
    const g = new RobotFrameworkLanguageGenerator();
    const nav = g.generateAction(ctx('navigate', { url: 'https://example.com/dashboard' }));
    expect(nav).toContain('    Go To    https://example.com/dashboard');
  });

  it('navigate following a click on a blank page does NOT collapse', () => {
    const g = new RobotFrameworkLanguageGenerator();
    g.generateAction(ctx('openPage', { url: 'about:blank' }));
    const click = g.generateAction(
      ctx('click', { selector: 'css=#btn', clickCount: 1, button: 'left', modifiers: 0 }),
    );
    const nav = g.generateAction(ctx('navigate', { url: 'https://example.com/' }));

    expect(click).toContain('    Click    css=#btn');
    expect(nav).toContain('    Go To    https://example.com/'); // genuine Go To, not collapsed
  });

  it('openPage with real URL emits New Page directly, no pending state', () => {
    const g = new RobotFrameworkLanguageGenerator();
    const open = g.generateAction(ctx('openPage', { url: 'https://direct.example/' }));
    const nav = g.generateAction(ctx('navigate', { url: 'https://later.example/' }));

    expect(open).toContain('    New Page    https://direct.example/');
    expect(nav).toContain('    Go To    https://later.example/');
  });

  it('second openPage(blank) after collapse re-arms the pending state', () => {
    const g = new RobotFrameworkLanguageGenerator();
    g.generateAction(ctx('openPage', { url: 'about:blank' }));
    g.generateAction(ctx('navigate', { url: 'https://first.example/' }));
    g.generateAction(ctx('openPage', { url: 'about:blank' })); // new tab opens blank
    const nav2 = g.generateAction(ctx('navigate', { url: 'https://second.example/' }));

    expect(nav2).toContain('    New Page    https://second.example/');
  });
});

describe('generateHeader defaults — args=[--start-maximized] + viewport=None', () => {
  it('chromium header includes both new defaults', () => {
    const g = new RobotFrameworkLanguageGenerator();
    const header = g.generateHeader({
      browserName: 'chromium',
      launchOptions: {},
      contextOptions: {},
    });
    expect(header).toContain(
      'New Browser    chromium    headless=${False}    args=["--start-maximized"]',
    );
    expect(header).toContain('New Context    viewport=None');
  });

  it('firefox header omits --start-maximized (chromium-only flag)', () => {
    const g = new RobotFrameworkLanguageGenerator();
    const header = g.generateHeader({
      browserName: 'firefox',
      launchOptions: {},
      contextOptions: {},
    });
    expect(header).not.toContain('--start-maximized');
    expect(header).toContain('New Browser    firefox    headless=${False}');
    expect(header).toContain('New Context    viewport=None');
  });

  it('explicit viewport overrides the default viewport=None', () => {
    const g = new RobotFrameworkLanguageGenerator();
    const header = g.generateHeader({
      browserName: 'chromium',
      launchOptions: {},
      contextOptions: { viewport: { width: 1024, height: 768 } },
    });
    expect(header).not.toContain('viewport=None');
    expect(header).toContain("viewport={'width': 1024, 'height': 768}");
  });
});
