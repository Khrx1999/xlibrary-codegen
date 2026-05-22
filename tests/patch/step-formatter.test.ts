/**
 * tests/patch/step-formatter.test.ts
 *
 * Pure unit tests for formatActionsForLang().
 * No browser, no filesystem access — completely deterministic.
 */
import { describe, it, expect } from 'vitest';
import { formatActionsForLang } from '../../src/patch/step-formatter.js';
import type { ActionInContext } from '../../src/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

function mkAction(partial: Record<string, unknown>): ActionInContext {
  return {
    frame: { pageGuid: 'g1', pageAlias: 'page', framePath: [] },
    action: { signals: [], ...partial } as unknown as ActionInContext['action'],
    startTime: 0,
  };
}

const navigateAction = mkAction({ name: 'navigate', url: 'https://example.com' });
const clickAction = mkAction({
  name: 'click',
  selector: 'css=#submit',
  button: 'left',
  clickCount: 1,
  modifiers: 0,
});
const fillAction = mkAction({
  name: 'fill',
  selector: 'css=#username',
  text: 'admin',
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: 'robot' language
// ─────────────────────────────────────────────────────────────────────────────

describe('formatActionsForLang — robot', () => {
  it('returns empty string for empty action list', () => {
    const result = formatActionsForLang([], { lang: 'robot', startingStepNumber: 1 });
    expect(result).toBe('');
  });

  it('formats a navigate action with xlib:step comment', () => {
    const result = formatActionsForLang([navigateAction], {
      lang: 'robot',
      startingStepNumber: 3,
    });
    expect(result).toContain('Go To');
    expect(result).toContain('https://example.com');
    expect(result).toContain('# xlib:step=3');
  });

  it('formats a click action', () => {
    const result = formatActionsForLang([clickAction], {
      lang: 'robot',
      startingStepNumber: 1,
    });
    expect(result).toContain('Click');
    expect(result).toContain('#submit');
    expect(result).toContain('# xlib:step=1');
  });

  it('formats a fill action', () => {
    const result = formatActionsForLang([fillAction], {
      lang: 'robot',
      startingStepNumber: 2,
    });
    expect(result).toContain('Fill Text');
    expect(result).toContain('admin');
    expect(result).toContain('# xlib:step=2');
  });

  it('increments step numbers across multiple actions', () => {
    const result = formatActionsForLang([navigateAction, clickAction, fillAction], {
      lang: 'robot',
      startingStepNumber: 5,
    });
    expect(result).toContain('# xlib:step=5');
    expect(result).toContain('# xlib:step=6');
    expect(result).toContain('# xlib:step=7');
  });

  it('indents keyword lines with 4 spaces', () => {
    const result = formatActionsForLang([clickAction], {
      lang: 'robot',
      startingStepNumber: 1,
    });
    const kwLine = result.split('\n').find((l) => l.includes('Click'));
    expect(kwLine).toBeDefined();
    expect(kwLine!.startsWith('    ')).toBe(true);
  });

  it('collapses openPage(about:blank) + navigate into a single New Page', () => {
    const openBlank = mkAction({ name: 'openPage', url: 'about:blank' });
    const navigate = mkAction({ name: 'navigate', url: 'https://example.com' });
    const result = formatActionsForLang([openBlank, navigate], {
      lang: 'robot',
      startingStepNumber: 1,
    });
    // openPage(about:blank) produces no output; navigate gets collapsed into New Page.
    // The step counter only increments when output is emitted (matches main's
    // RobotFrameworkLanguageGenerator behavior from Task #7), so the collapsed
    // New Page is step 1.
    expect(result).toContain('New Page');
    expect(result).toContain('https://example.com');
    expect(result).toContain('# xlib:step=1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: 'selenium' language
// ─────────────────────────────────────────────────────────────────────────────

describe('formatActionsForLang — selenium', () => {
  it('formats navigate as Open Browser (first nav) with # comment', () => {
    const openBlank = mkAction({ name: 'openPage', url: 'about:blank' });
    const nav = mkAction({ name: 'navigate', url: 'https://example.com' });
    const result = formatActionsForLang([openBlank, nav], {
      lang: 'selenium',
      startingStepNumber: 1,
    });
    expect(result).toContain('Open Browser');
    expect(result).toContain('https://example.com');
    expect(result).toContain('# xlib:step');
  });

  it('formats click with Click Element', () => {
    const result = formatActionsForLang([clickAction], {
      lang: 'selenium',
      startingStepNumber: 1,
    });
    expect(result).toContain('Click Element');
    expect(result).toContain('# xlib:step=1');
  });

  it('increments step numbers', () => {
    const result = formatActionsForLang([clickAction, fillAction], {
      lang: 'selenium',
      startingStepNumber: 10,
    });
    expect(result).toContain('# xlib:step=10');
    expect(result).toContain('# xlib:step=11');
  });

  it('uses # for comment prefix (not //)', () => {
    const result = formatActionsForLang([clickAction], {
      lang: 'selenium',
      startingStepNumber: 1,
    });
    expect(result).toContain('# xlib:step=1');
    expect(result).not.toContain('// xlib:step=1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: 'python' language
// ─────────────────────────────────────────────────────────────────────────────

describe('formatActionsForLang — python', () => {
  it('uses # for comment prefix', () => {
    const result = formatActionsForLang([clickAction], {
      lang: 'python',
      startingStepNumber: 1,
    });
    expect(result).toContain('# xlib:step=1');
    expect(result).not.toContain('// xlib:step=1');
  });

  it('produces same keyword output as robot (both use RobotFrameworkLanguageGenerator)', () => {
    const robotResult = formatActionsForLang([clickAction], {
      lang: 'robot',
      startingStepNumber: 1,
    });
    const pythonResult = formatActionsForLang([clickAction], {
      lang: 'python',
      startingStepNumber: 1,
    });
    // Both use the same emitter so keyword output is identical.
    const robotKwLine = robotResult.split('\n').find((l) => l.includes('Click'));
    const pythonKwLine = pythonResult.split('\n').find((l) => l.includes('Click'));
    expect(robotKwLine).toBe(pythonKwLine);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: 'ts' language
// ─────────────────────────────────────────────────────────────────────────────

describe('formatActionsForLang — ts', () => {
  it('produces await page.goto for navigate', () => {
    const result = formatActionsForLang([navigateAction], {
      lang: 'ts',
      startingStepNumber: 1,
    });
    expect(result).toContain('await page.goto');
    expect(result).toContain('https://example.com');
    expect(result).toContain('// xlib:step=1');
  });

  it('produces await page.locator().click for click', () => {
    const result = formatActionsForLang([clickAction], {
      lang: 'ts',
      startingStepNumber: 2,
    });
    expect(result).toContain('await page.locator');
    expect(result).toContain('.click()');
    expect(result).toContain('// xlib:step=2');
  });

  it('produces await page.locator().fill for fill', () => {
    const result = formatActionsForLang([fillAction], {
      lang: 'ts',
      startingStepNumber: 1,
    });
    expect(result).toContain('.fill(');
    expect(result).toContain('admin');
    expect(result).toContain('// xlib:step=1');
  });

  it('uses // for comment prefix (not #)', () => {
    const result = formatActionsForLang([clickAction], {
      lang: 'ts',
      startingStepNumber: 1,
    });
    expect(result).toContain('// xlib:step=1');
    expect(result).not.toContain('# xlib:step=1');
  });

  it('increments step numbers', () => {
    const result = formatActionsForLang([navigateAction, clickAction], {
      lang: 'ts',
      startingStepNumber: 3,
    });
    expect(result).toContain('// xlib:step=3');
    expect(result).toContain('// xlib:step=4');
  });

  it('skips closePage (returns no output line)', () => {
    const closePage = mkAction({ name: 'closePage' });
    const result = formatActionsForLang([closePage, clickAction], {
      lang: 'ts',
      startingStepNumber: 1,
    });
    // closePage produces no output but step counter increments.
    expect(result).not.toContain('// xlib:step=1');
    expect(result).toContain('// xlib:step=2');
  });

  it('produces dblclick for clickCount=2', () => {
    const dblClick = mkAction({
      name: 'click',
      selector: 'css=#btn',
      button: 'left',
      clickCount: 2,
      modifiers: 0,
    });
    const result = formatActionsForLang([dblClick], {
      lang: 'ts',
      startingStepNumber: 1,
    });
    expect(result).toContain('.dblclick()');
  });

  it('produces toBeVisible for assertVisible', () => {
    const assertVisible = mkAction({
      name: 'assertVisible',
      selector: 'css=#header',
    });
    const result = formatActionsForLang([assertVisible], {
      lang: 'ts',
      startingStepNumber: 1,
    });
    expect(result).toContain('toBeVisible');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: step numbering edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('formatActionsForLang — step numbering', () => {
  it('startingStepNumber=1 assigns xlib:step=1 to the first action', () => {
    const result = formatActionsForLang([clickAction], {
      lang: 'robot',
      startingStepNumber: 1,
    });
    expect(result).toContain('# xlib:step=1');
  });

  it('startingStepNumber=100 assigns xlib:step=100 to the first action', () => {
    const result = formatActionsForLang([clickAction], {
      lang: 'robot',
      startingStepNumber: 100,
    });
    expect(result).toContain('# xlib:step=100');
  });
});
