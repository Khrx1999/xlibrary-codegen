/**
 * step-formatter.ts
 *
 * Pure helper: takes an ActionInContext[] + target language + starting
 * xlib:step number and returns the formatted source-code lines for splicing
 * into an existing file.
 *
 * Design choices:
 *   - Delegates ALL keyword/line formatting to the existing emitter classes
 *     (RobotFrameworkLanguageGenerator, SeleniumLibraryLanguageGenerator).
 *     There is NO duplicate formatting logic here.
 *   - xlib:step=N comments use `#` for robot/python/selenium and `//` for ts.
 *   - Each action that produces output gets exactly one step comment appended.
 *   - Actions that produce empty output (e.g. closePage in SeleniumLibrary)
 *     are still counted in the step numbering so the splice position stays
 *     stable even when the generator skips them.
 */

import type { ActionInContext, LangTarget } from '../types.js';
import { RobotFrameworkLanguageGenerator } from '../codegen/robotframework.js';
import { SeleniumLibraryLanguageGenerator } from '../codegen/selenium.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public contract
// ─────────────────────────────────────────────────────────────────────────────

export interface FormatOptions {
  /** Target source language / library. Drives which emitter is used. */
  lang: LangTarget;
  /**
   * The xlib:step number to assign to the FIRST action in the list.
   * Subsequent actions get startingStepNumber + 1, + 2, etc.
   */
  startingStepNumber: number;
  /**
   * Used only for Robot Framework output — becomes the test-case name in
   * generated headers. Ignored for all other languages.
   */
  testName?: string;
}

/**
 * Format an action stream into source-code lines for splicing into an
 * existing file.
 *
 * Each action produces:
 *   <keyword-line(s) from the emitter>
 *   <xlib:step=N comment>
 *
 * Actions that the emitter skips (returns empty string) are counted in the
 * step numbering but produce NO output — the gap is intentional so that
 * external step indices remain stable.
 *
 * Returns the joined block as a single string (lines separated by `\n`).
 * Returns an empty string when `actions` is empty.
 */
export function formatActionsForLang(actions: ActionInContext[], options: FormatOptions): string {
  if (actions.length === 0) return '';

  const { lang, startingStepNumber, testName } = options;
  const commentPrefix = lang === 'ts' ? '//' : '#';
  const lines: string[] = [];

  switch (lang) {
    case 'robot': {
      const gen = new RobotFrameworkLanguageGenerator(testName ?? 'Recorded Flow');
      // Prime the generator so its internal state (pendingBlankPage, etc.)
      // is in a clean render-pass state.
      gen.generateHeader();

      let stepN = startingStepNumber;
      for (const action of actions) {
        const output = gen.generateAction(action);
        if (output.trim()) {
          for (const line of output.split('\n')) {
            if (line.trim()) lines.push(line);
          }
          lines.push(`    ${commentPrefix} xlib:step=${stepN}`);
        }
        // Always increment — even for skipped actions — so outer indices are
        // stable (operations.ts relies on step=N to locate lines).
        stepN++;
      }
      break;
    }

    case 'selenium': {
      const gen = new SeleniumLibraryLanguageGenerator(testName ?? 'Recorded Flow');
      gen.generateHeader();

      let stepN = startingStepNumber;
      for (const action of actions) {
        const output = gen.generateAction(action);
        if (output.trim()) {
          for (const line of output.split('\n')) {
            if (line.trim()) lines.push(line);
          }
          lines.push(`    ${commentPrefix} xlib:step=${stepN}`);
        }
        stepN++;
      }
      break;
    }

    case 'python': {
      // Python output: 4-space indented lines, # comments.
      // Re-use the Robot Framework emitter for action formatting since
      // python-flavoured .robot files use the same keyword syntax.
      const gen = new RobotFrameworkLanguageGenerator(testName ?? 'Recorded Flow');
      gen.generateHeader();

      let stepN = startingStepNumber;
      for (const action of actions) {
        const output = gen.generateAction(action);
        if (output.trim()) {
          for (const line of output.split('\n')) {
            if (line.trim()) lines.push(line);
          }
          lines.push(`    ${commentPrefix} xlib:step=${stepN}`);
        }
        stepN++;
      }
      break;
    }

    case 'ts': {
      // TypeScript / Playwright-TS output: pass-through raw action descriptions
      // with // xlib:step=N annotations.
      // Since we have no TS emitter in this repo, we produce a minimal
      // Playwright-style await comment block. This is intentionally simple
      // and can be upgraded when a TS emitter lands.
      let stepN = startingStepNumber;
      for (const action of actions) {
        const desc = describeTsAction(action);
        if (desc) {
          lines.push(desc);
          lines.push(`  ${commentPrefix} xlib:step=${stepN}`);
        }
        stepN++;
      }
      break;
    }

    default: {
      const _exhaustive: never = lang;
      void _exhaustive;
    }
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript action description (minimal, no external TS emitter yet)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produce a single Playwright-TS `await page.*` line for an action.
 * Returns an empty string for actions that should be skipped (closePage).
 *
 * This is intentionally minimal — a proper TS emitter can replace this
 * function without touching the rest of step-formatter.ts.
 */
function describeTsAction(aic: ActionInContext): string {
  const action = aic.action as ActionInContext['action'] & {
    url?: string;
    selector?: string;
    text?: string;
    key?: string;
    options?: string[];
    files?: string[];
    value?: string;
    checked?: boolean;
    clickCount?: number;
  };

  switch (action.name) {
    case 'openPage':
      if (!action.url || action.url === 'about:blank' || action.url === 'chrome://newtab/') {
        return '';
      }
      return `  await page.goto(${JSON.stringify(action.url)});`;

    case 'navigate':
      return `  await page.goto(${JSON.stringify(action.url)});`;

    case 'closePage':
      return '';

    case 'click':
      if (action.clickCount === 2) {
        return `  await page.locator(${JSON.stringify(action.selector)}).dblclick();`;
      }
      return `  await page.locator(${JSON.stringify(action.selector)}).click();`;

    case 'fill':
      return `  await page.locator(${JSON.stringify(action.selector)}).fill(${JSON.stringify(action.text ?? '')});`;

    case 'press':
      return `  await page.locator(${JSON.stringify(action.selector)}).press(${JSON.stringify(action.key ?? '')});`;

    case 'check':
      return `  await page.locator(${JSON.stringify(action.selector)}).check();`;

    case 'uncheck':
      return `  await page.locator(${JSON.stringify(action.selector)}).uncheck();`;

    case 'select':
      return `  await page.locator(${JSON.stringify(action.selector)}).selectOption(${JSON.stringify(action.options ?? [])});`;

    case 'hover':
      return `  await page.locator(${JSON.stringify(action.selector)}).hover();`;

    case 'setInputFiles': {
      const files = (action.files ?? []).map((f) => JSON.stringify(f)).join(', ');
      return `  await page.locator(${JSON.stringify(action.selector)}).setInputFiles([${files}]);`;
    }

    case 'assertVisible':
      return `  await expect(page.locator(${JSON.stringify(action.selector)})).toBeVisible();`;

    case 'assertText':
      return `  await expect(page.locator(${JSON.stringify(action.selector)})).toHaveText(${JSON.stringify(action.text ?? '')});`;

    case 'assertValue':
      return `  await expect(page.locator(${JSON.stringify(action.selector)})).toHaveValue(${JSON.stringify(action.value ?? '')});`;

    case 'assertChecked':
      return action.checked
        ? `  await expect(page.locator(${JSON.stringify(action.selector)})).toBeChecked();`
        : `  await expect(page.locator(${JSON.stringify(action.selector)})).not.toBeChecked();`;

    case 'assertSnapshot':
      return `  // TODO: assertSnapshot — no TS equivalent available`;

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      const stray = action as { name?: string };
      return `  // TODO: unsupported action "${stray.name ?? '?'}"`;
    }
  }
}
