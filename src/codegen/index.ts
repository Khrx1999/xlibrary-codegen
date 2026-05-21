/**
 * xlibrary/codegen — public barrel for code-generation building blocks.
 *
 * Use this entry when you want the generators or their helpers WITHOUT
 * dragging in the recorder runtime (which depends on playwright-core launch).
 *
 *   import { RobotFrameworkLanguageGenerator } from 'xlibrary/codegen';
 *   import { translateSelector } from 'xlibrary/codegen';
 *
 * ⚠ EXPERIMENTAL: API may change in any 0.x release.
 */

// ── Generators ────────────────────────────────────────────────────────────
export { RobotFrameworkLanguageGenerator } from './robotframework.js';
export { SeleniumLibraryLanguageGenerator } from './selenium.js';

// ── Keyword maps ──────────────────────────────────────────────────────────
export { ACTION_TO_KEYWORD, NO_BL_EQUIVALENT } from './keywords-map.js';
export { ACTION_TO_SL_KEYWORD, NO_SL_EQUIVALENT } from './selenium-keywords-map.js';

// ── Selector + value translation ──────────────────────────────────────────
export { translateSelector, escapeRobotValue } from './locator-translator.js';
export { translateSelectorForSelenium } from './selenium-locator.js';

// ── Signal translation ────────────────────────────────────────────────────
export { signalLinesBefore, signalLinesAfter } from './signal-handler.js';

// ── Keyboard modifiers ────────────────────────────────────────────────────
export {
  decodeModifiers,
  toSeleniumModifier,
  formatKeyWithModifiers,
} from './keyboard-modifiers.js';
export type { ModifierName } from './keyboard-modifiers.js';

// ── Formatter ─────────────────────────────────────────────────────────────
export { RobotFormatter, INDENT, ARG_SEP } from './robot-formatter.js';

// ── Types ─────────────────────────────────────────────────────────────────
export type { ActionName, KeywordMapping } from './keywords-map.js';
