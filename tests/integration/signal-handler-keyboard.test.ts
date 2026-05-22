/**
 * Integration tests for signal-handler and keyboard-modifiers modules.
 *
 * These modules have NO dedicated unit test coverage in the current test suite
 * (the existing snapshot tests implicitly exercise them but don't isolate edge
 * cases). This file covers the modules directly.
 *
 * Coverage targets:
 *   - src/codegen/signal-handler.ts
 *   - src/codegen/keyboard-modifiers.ts
 */

import { describe, it, expect } from 'vitest';
import {
  signalLinesBefore,
  signalLinesAfter,
  type Signal,
} from '../../src/codegen/signal-handler.js';
import {
  decodeModifiers,
  toSeleniumModifier,
  formatKeyWithModifiers,
} from '../../src/codegen/keyboard-modifiers.js';

const INDENT = '    ';

// ─────────────────────────────────────────────────────────────────────────────
// signalLinesBefore
// ─────────────────────────────────────────────────────────────────────────────

describe('signalLinesBefore', () => {
  it('returns empty array when signals is empty', () => {
    expect(signalLinesBefore([], INDENT)).toHaveLength(0);
  });

  it('dialog signal → emits Handle Alert comment lines BEFORE the action', () => {
    const signals: Signal[] = [{ name: 'dialog', dialogAlias: 'alert1' }];
    const lines = signalLinesBefore(signals, INDENT);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('Handle Alert'))).toBe(true);
    expect(lines.some((l) => l.includes('alert1') || l.includes('dialog'))).toBe(true);
  });

  it('dialog lines include the indent prefix', () => {
    const signals: Signal[] = [{ name: 'dialog', dialogAlias: 'confirmBox' }];
    const lines = signalLinesBefore(signals, INDENT);
    for (const line of lines) {
      expect(line.startsWith(INDENT)).toBe(true);
    }
  });

  it('navigation signal → no lines before (handled in after)', () => {
    const signals: Signal[] = [{ name: 'navigation', url: 'https://example.com/next' }];
    expect(signalLinesBefore(signals, INDENT)).toHaveLength(0);
  });

  it('popup signal → no lines before (handled in after)', () => {
    const signals: Signal[] = [{ name: 'popup', popupAlias: 'popup1' }];
    expect(signalLinesBefore(signals, INDENT)).toHaveLength(0);
  });

  it('download signal → no lines before (handled in after)', () => {
    const signals: Signal[] = [{ name: 'download', downloadAlias: 'download1' }];
    expect(signalLinesBefore(signals, INDENT)).toHaveLength(0);
  });

  it('multiple signals — only dialog contributes before-lines', () => {
    const signals: Signal[] = [
      { name: 'navigation', url: 'https://a.com' },
      { name: 'dialog', dialogAlias: 'd1' },
      { name: 'popup', popupAlias: 'p1' },
    ];
    const lines = signalLinesBefore(signals, INDENT);
    // Only dialog contributes before-lines
    expect(lines.some((l) => l.includes('Handle Alert'))).toBe(true);
    expect(lines.some((l) => l.includes('Navigation'))).toBe(false);
    expect(lines.some((l) => l.includes('popup'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signalLinesAfter
// ─────────────────────────────────────────────────────────────────────────────

describe('signalLinesAfter', () => {
  it('returns empty array when signals is empty', () => {
    expect(signalLinesAfter([], INDENT)).toHaveLength(0);
  });

  it('navigation signal → comment line with URL', () => {
    const signals: Signal[] = [{ name: 'navigation', url: 'https://example.com/dashboard' }];
    const lines = signalLinesAfter(signals, INDENT);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Navigation');
    expect(lines[0]).toContain('https://example.com/dashboard');
  });

  it('navigation line starts with indent prefix', () => {
    const signals: Signal[] = [{ name: 'navigation', url: 'https://x.com' }];
    const lines = signalLinesAfter(signals, INDENT);
    expect(lines[0].startsWith(INDENT)).toBe(true);
  });

  it('popup signal → TODO comment with alias', () => {
    const signals: Signal[] = [{ name: 'popup', popupAlias: 'popupPage' }];
    const lines = signalLinesAfter(signals, INDENT);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('popup') || l.includes('popupPage'))).toBe(true);
    expect(lines.some((l) => l.includes('TODO'))).toBe(true);
  });

  it('popup lines all start with indent prefix', () => {
    const signals: Signal[] = [{ name: 'popup', popupAlias: 'p1' }];
    const lines = signalLinesAfter(signals, INDENT);
    for (const line of lines) {
      expect(line.startsWith(INDENT)).toBe(true);
    }
  });

  it('download signal → TODO comment with alias', () => {
    const signals: Signal[] = [{ name: 'download', downloadAlias: 'file1' }];
    const lines = signalLinesAfter(signals, INDENT);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('TODO'))).toBe(true);
    expect(lines.some((l) => l.includes('download') || l.includes('file1'))).toBe(true);
  });

  it('dialog signal → no after-lines (handled in before)', () => {
    const signals: Signal[] = [{ name: 'dialog', dialogAlias: 'alert1' }];
    expect(signalLinesAfter(signals, INDENT)).toHaveLength(0);
  });

  it('multiple signals accumulate independently', () => {
    const signals: Signal[] = [
      { name: 'navigation', url: 'https://a.com' },
      { name: 'popup', popupAlias: 'p1' },
      { name: 'download', downloadAlias: 'd1' },
    ];
    const lines = signalLinesAfter(signals, INDENT);
    expect(lines.some((l) => l.includes('Navigation'))).toBe(true);
    expect(lines.some((l) => l.includes('popup') || l.includes('p1'))).toBe(true);
    expect(lines.some((l) => l.includes('download') || l.includes('d1'))).toBe(true);
  });

  it('custom indent prefix is applied to all lines', () => {
    const CUSTOM_INDENT = '  '; // 2-space
    const signals: Signal[] = [{ name: 'navigation', url: 'https://x.com' }];
    const lines = signalLinesAfter(signals, CUSTOM_INDENT);
    for (const line of lines) {
      expect(line.startsWith(CUSTOM_INDENT)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Signal integration with RobotFrameworkLanguageGenerator
// ─────────────────────────────────────────────────────────────────────────────

describe('Signal integration with generators', () => {
  it('navigation signal after click → comment line appended to click output', async () => {
    const { RobotFrameworkLanguageGenerator } = await import('../../src/codegen/robotframework.js');
    const gen = new RobotFrameworkLanguageGenerator();
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#submit',
        button: 'left',
        clickCount: 1,
        modifiers: 0,
        signals: [{ name: 'navigation', url: 'https://example.com/success' }],
      },
      startTime: 0,
    } as never);
    expect(out).toContain('Click');
    expect(out).toContain('Navigation');
    expect(out).toContain('https://example.com/success');
  });

  it('dialog signal before click → Handle Alert comment prepended', async () => {
    const { RobotFrameworkLanguageGenerator } = await import('../../src/codegen/robotframework.js');
    const gen = new RobotFrameworkLanguageGenerator();
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#confirm-btn',
        button: 'left',
        clickCount: 1,
        modifiers: 0,
        signals: [{ name: 'dialog', dialogAlias: 'confirmBox' }],
      },
      startTime: 0,
    } as never);
    // Handle Alert comes before Click in output
    const handleIdx = out.indexOf('Handle Alert');
    const clickIdx = out.indexOf('Click');
    expect(handleIdx).toBeGreaterThanOrEqual(0);
    expect(clickIdx).toBeGreaterThan(handleIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// decodeModifiers
// ─────────────────────────────────────────────────────────────────────────────

describe('decodeModifiers', () => {
  it('0 → []', () => {
    expect(decodeModifiers(0)).toEqual([]);
  });

  it('Alt=1', () => {
    expect(decodeModifiers(1)).toEqual(['Alt']);
  });

  it('Control=2', () => {
    expect(decodeModifiers(2)).toEqual(['Control']);
  });

  it('Meta=4', () => {
    expect(decodeModifiers(4)).toEqual(['Meta']);
  });

  it('Shift=8', () => {
    expect(decodeModifiers(8)).toEqual(['Shift']);
  });

  it('Alt+Control=3', () => {
    expect(decodeModifiers(3)).toEqual(['Alt', 'Control']);
  });

  it('Ctrl+Shift=10', () => {
    expect(decodeModifiers(10)).toEqual(['Control', 'Shift']);
  });

  it('all modifiers=15', () => {
    expect(decodeModifiers(15)).toEqual(['Alt', 'Control', 'Meta', 'Shift']);
  });

  it('output order is stable: Alt, Control, Meta, Shift', () => {
    // Reverse priority order input still yields canonical order
    expect(decodeModifiers(15)).toEqual(['Alt', 'Control', 'Meta', 'Shift']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toSeleniumModifier
// ─────────────────────────────────────────────────────────────────────────────

describe('toSeleniumModifier', () => {
  it('Alt → ALT', () => {
    expect(toSeleniumModifier('Alt')).toBe('ALT');
  });

  it('Control → CTRL (Selenium dialect)', () => {
    expect(toSeleniumModifier('Control')).toBe('CTRL');
  });

  it('Meta → META', () => {
    expect(toSeleniumModifier('Meta')).toBe('META');
  });

  it('Shift → SHIFT', () => {
    expect(toSeleniumModifier('Shift')).toBe('SHIFT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatKeyWithModifiers
// ─────────────────────────────────────────────────────────────────────────────

describe('formatKeyWithModifiers', () => {
  it('no modifiers → bare key', () => {
    expect(formatKeyWithModifiers('Enter', 0)).toBe('Enter');
  });

  it('Control+A → Control+A (Browser Library form)', () => {
    expect(formatKeyWithModifiers('A', 2)).toBe('Control+A');
  });

  it('Shift+Tab → Shift+Tab', () => {
    expect(formatKeyWithModifiers('Tab', 8)).toBe('Shift+Tab');
  });

  it('Ctrl+Shift+S → Control+Shift+S', () => {
    expect(formatKeyWithModifiers('S', 10)).toBe('Control+Shift+S');
  });

  it('with toSeleniumModifier transformer: Control → CTRL', () => {
    expect(formatKeyWithModifiers('s', 2, toSeleniumModifier)).toBe('CTRL+s');
  });

  it('with toSeleniumModifier: Alt+Shift+Enter → ALT+SHIFT+Enter', () => {
    expect(formatKeyWithModifiers('Enter', 9, toSeleniumModifier)).toBe('ALT+SHIFT+Enter');
  });

  it('all modifiers → stable canonical order in output', () => {
    const result = formatKeyWithModifiers('K', 15);
    // Order: Alt, Control, Meta, Shift → Alt+Control+Meta+Shift+K
    expect(result).toBe('Alt+Control+Meta+Shift+K');
  });

  it('Meta+key', () => {
    expect(formatKeyWithModifiers('V', 4)).toBe('Meta+V');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Modifier integration in generator output
// ─────────────────────────────────────────────────────────────────────────────

describe('Modifier integration with RobotFrameworkLanguageGenerator', () => {
  it('click with Control modifier → Keyboard Key down/up wraps Click', async () => {
    const { RobotFrameworkLanguageGenerator } = await import('../../src/codegen/robotframework.js');
    const gen = new RobotFrameworkLanguageGenerator();
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'click',
        selector: 'css=#link',
        button: 'left',
        clickCount: 1,
        modifiers: 2, // Control
        signals: [],
      },
      startTime: 0,
    } as never);
    // Should have Keyboard Key down before click, Keyboard Key up after
    expect(out).toContain('Keyboard Key');
    expect(out).toContain('down');
    expect(out).toContain('up');
    expect(out).toContain('Control');
    const downIdx = out.indexOf('down');
    const clickIdx = out.indexOf('Click    ');
    const upIdx = out.indexOf('up');
    expect(downIdx).toBeLessThan(clickIdx);
    expect(clickIdx).toBeLessThan(upIdx);
  });

  it('press with Shift modifier → Shift+Enter composite key', async () => {
    const { RobotFrameworkLanguageGenerator } = await import('../../src/codegen/robotframework.js');
    const gen = new RobotFrameworkLanguageGenerator();
    const out = gen.generateAction({
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      action: {
        name: 'press',
        selector: 'css=#editor',
        key: 'Enter',
        modifiers: 8, // Shift
        signals: [],
      },
      startTime: 0,
    } as never);
    expect(out).toContain('Press Keys');
    expect(out).toContain('Shift+Enter');
  });
});
