/**
 * RobotFrameworkLanguageGenerator
 *
 * Implements Playwright's `LanguageGenerator` interface so the recorder can call us
 * the same way it calls JavaScriptLanguageGenerator or PythonLanguageGenerator.
 *
 * Interface source:
 *   vendor/playwright/packages/playwright-core/src/server/codegen/types.ts
 *
 * Reference implementation:
 *   vendor/playwright/packages/playwright-core/src/server/codegen/python.ts
 *
 * Snapshot contract (golden .robot files that tests verify against):
 *   tests/snapshots/<action>.robot
 */

import type { LaunchOptions, BrowserContextOptions } from 'playwright-core';
import { ACTION_TO_KEYWORD, type ActionName } from './keywords-map.js';
import { translateSelector, escapeRobotValue } from './locator-translator.js';
import { signalLinesBefore, signalLinesAfter } from './signal-handler.js';
import { decodeModifiers, formatKeyWithModifiers } from './keyboard-modifiers.js';
import { RobotFormatter, INDENT } from './robot-formatter.js';
import type { Action, ActionInContext } from '../types.js';

// Re-export ActionInContext for callers that already import it from this module.
// The canonical Action / ActionInContext types live in src/types.ts.
export type { ActionInContext };

/** Matches LanguageGeneratorOptions from playwright-core/src/server/codegen/types.ts */
export type LanguageGeneratorOptions = {
  browserName: string;
  launchOptions: LaunchOptions;
  contextOptions: BrowserContextOptions;
  deviceName?: string;
  saveStorage?: string;
  generateAutoExpect?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Selector pipeline helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translate a Playwright internal selector to Browser Library syntax AND
 * escape any Robot Framework variable-reference sequences (`${...}`, `@{...}`,
 * etc.) that could otherwise be interpreted at test runtime.
 *
 * Without escaping, a recorded selector like
 *   `internal:role=button[name="${user}"]`
 * would silently resolve `${user}` against the Robot Framework variable scope
 * — turning a deterministic record into a runtime variable lookup bug.
 */
function safeSelector(selector: string): string {
  return escapeRobotValue(translateSelector(selector));
}

// ─────────────────────────────────────────────────────────────────────────────
// RobotFrameworkLanguageGenerator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates Robot Framework `.robot` file content from Playwright `ActionInContext` objects.
 *
 * Implements the `LanguageGenerator` interface (structural TypeScript typing):
 *
 *   id          — unique identifier used by the recorder's language registry
 *   groupName   — shown in the recorder's language picker group label
 *   name        — shown as the option name inside the group
 *   highlighter — syntax-highlighter hint for the recorder UI
 *
 * Output contract (see tests/snapshots/*.robot for golden files):
 *   - `generateHeader()` → Settings + Test Cases boilerplate + New Browser + New Context
 *   - `generateAction()` → single indented keyword call (or '' to skip)
 *   - `generateFooter()` → `    Close Browser`
 */
export class RobotFrameworkLanguageGenerator {
  readonly id = 'robotframework';
  readonly groupName = 'Robot Framework';
  readonly name = 'Browser Library';
  readonly highlighter = 'python' as const;

  private readonly _testName: string;
  private readonly _libraryLine: string;

  // ── Captured actions for replay ──────────────────────────────────────────
  //
  // Playwright's recorder calls `generateHeader` then `generateAction` for
  // every action in the current list on every re-render. We treat the
  // header call as the "start of render" boundary and reset our capture,
  // then accumulate each ActionInContext until the next header. After a
  // render, `getCapturedActions()` reflects the full action list — used by
  // the replay engine to walk through the recording in a fresh browser.
  private _capturedActions: ActionInContext[] = [];

  constructor(testName = 'Recorded Flow', libraryLine = 'Library    Browser') {
    this._testName = testName;
    this._libraryLine = libraryLine;
  }

  /**
   * Snapshot of every `ActionInContext` Playwright fed to `generateAction`
   * during the most recent render. The replay engine consumes this — see
   * runner.ts's command handler for the viewer's Replay button.
   */
  getCapturedActions(): ActionInContext[] {
    return [...this._capturedActions];
  }

  // ── Pending-blank-page collapse state ──────────────────────────────────────
  //
  // Playwright's recorder emits two actions when a context+page is launched
  // with a URL:
  //   1. openPage  — url="about:blank" (the implicit first tab)
  //   2. navigate  — url=<actual URL>
  //
  // Without collapse this becomes `Go To <url>` and the test reader has no
  // "New Page" keyword for the initial page. We collapse the pair into a
  // single `New Page <actual url>` by remembering when (1) is "pending" and,
  // if (2) arrives next, emitting the merged keyword.
  //
  // Any other action between (1) and (2) (e.g. click, fill) cancels the
  // pending state — the user did real work on the blank page so the navigate
  // is a genuine `Go To` later.
  private _pendingBlankPage = false;

  // ───────────────────────────────────────────────────────────────────────────
  // generateHeader
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Emit the `.robot` boilerplate with browser-lifecycle setup:
   *
   *   *** Settings ***
   *   Library    Browser
   *
   *   *** Test Cases ***
   *   Recorded Flow
   *       New Browser    chromium    headless=${False}    args=["--start-maximized"]
   *       New Context    viewport=None
   *
   * `options.browserName` drives the browser name in `New Browser`.
   * `options.launchOptions.headless === true` selects `headless=${True}`;
   * otherwise (undefined/false) produces `headless=${False}`.
   *
   * Default launch tweaks (chromium only):
   *   - `args=["--start-maximized"]` — open the browser window full-screen so
   *     the recording reflects the real user viewport.
   *   - `viewport=None`              — let the page fill the actual window
   *     instead of being clipped to Playwright's default 1280×720.
   *
   * Explicit `contextOptions.viewport` overrides the default `viewport=None`.
   * Other context options (locale, deviceName, etc.) are forwarded as-is.
   *
   * The `options` parameter is optional so that tests can call without arguments;
   * the defaults produce `chromium / headless=${False} / args=[…] / viewport=None`.
   */
  generateHeader(options?: LanguageGeneratorOptions): string {
    // Reset action capture — this header call marks the start of a render pass.
    this._capturedActions = [];

    const browser = options?.browserName ?? 'chromium';
    const headless = options?.launchOptions?.headless === true ? '${True}' : '${False}';

    // ── New Browser args: start-maximized for chromium-family ────────────────
    // Firefox/WebKit ignore Chromium command-line flags, so we emit the arg
    // only for chromium. Users with their own launchOptions.args can extend
    // via the public API later — for now this is the recorder default.
    const browserArgs: string[] = [`headless=${headless}`];
    if (browser === 'chromium') {
      browserArgs.push('args=["--start-maximized"]');
    }

    // ── New Context args: viewport=None unless explicitly overridden ────────
    const ctxArgs = buildContextArgs(options?.contextOptions, options?.deviceName);
    const hasExplicitViewport = ctxArgs.some((a) => a.startsWith('viewport='));
    if (!hasExplicitViewport) {
      ctxArgs.unshift('viewport=None');
    }

    return new RobotFormatter()
      .section('Settings')
      .raw(this._libraryLine)
      .blank()
      .section('Test Cases')
      .raw(this._testName)
      .keyword('New Browser', browser, ...browserArgs)
      .keyword('New Context', ...ctxArgs)
      .format();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // generateAction
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Translate a single `ActionInContext` into one or more Robot Framework lines.
   *
   * Returns `''` (empty string) for actions that should be skipped:
   *   - `openPage` with no navigable URL (`about:blank`, `chrome://newtab/`)
   *
   * Returns a `# TODO:` comment for actions with no Browser Library equivalent
   * (`assertSnapshot`).
   */
  generateAction(actionInContext: ActionInContext): string {
    // Accumulate every action in this render so the replay engine can walk
    // through the recording later. Idempotent within a render — reset
    // happens in generateHeader().
    this._capturedActions.push(actionInContext);

    const { action } = actionInContext;
    const fmt = new RobotFormatter();

    // Signal lines BEFORE the action (e.g. dialog dismiss)
    for (const line of signalLinesBefore(action.signals, INDENT)) {
      fmt.rawLine(line);
    }

    // Emit the action keyword; bail out early if no output needed
    const emitted = this._emitAction(fmt, action);

    // Any action other than openPage / navigate (which manage the flag
    // themselves) cancels the pending-blank-page collapse window — once the
    // user interacts with the blank page, the next navigate is a genuine
    // `Go To`, not a tab opener.
    if (action.name !== 'openPage' && action.name !== 'navigate') {
      this._pendingBlankPage = false;
    }

    if (!emitted) return '';

    // Signal lines AFTER the action (e.g. navigation comment, popup note)
    for (const line of signalLinesAfter(action.signals, INDENT)) {
      fmt.rawLine(line);
    }

    return fmt.format();
  }

  /**
   * Core per-action dispatch.
   *
   * Returns `true` if at least one line was added to `fmt`.
   * Returns `false` if the action should produce no output (caller returns '').
   */
  private _emitAction(fmt: RobotFormatter, action: Action): boolean {
    // Keyword name lookup helper.
    // The non-null assertion is safe: ACTION_TO_KEYWORD is a complete Record<ActionName, …>
    // with every ActionName key present; TS 5.9 widens the indexed return type to include
    // null in certain lambda contexts, so we assert non-null explicitly.
    const kw = (name: ActionName): string => ACTION_TO_KEYWORD[name].keyword;

    switch (action.name) {
      // ── openPage ─────────────────────────────────────────────────────────
      case 'openPage': {
        const url = action.url;
        if (!url || url === 'about:blank' || url === 'chrome://newtab/') {
          // Don't emit a `New Page` for the implicit blank tab — wait to see
          // if the next action is a navigate we can collapse into.
          this._pendingBlankPage = true;
          return false;
        }
        this._pendingBlankPage = false;
        fmt.keyword(kw('openPage'), escapeRobotValue(url));
        return true;
      }

      // ── closePage ────────────────────────────────────────────────────────
      case 'closePage':
        this._pendingBlankPage = false;
        fmt.keyword(kw('closePage'));
        return true;

      // ── navigate ─────────────────────────────────────────────────────────
      case 'navigate': {
        if (this._pendingBlankPage) {
          // Collapse: previous openPage(about:blank) + this navigate →
          // single `New Page <url>` (matches openPage.robot snapshot contract).
          this._pendingBlankPage = false;
          fmt.keyword(kw('openPage'), escapeRobotValue(action.url));
          return true;
        }
        fmt.keyword(kw('navigate'), escapeRobotValue(action.url));
        return true;
      }

      // ── click ─────────────────────────────────────────────────────────────
      // Browser Library has NO `Double Click` keyword — clickCount=2 is passed
      // as a named arg to the regular `Click`. Modifiers (Ctrl/Shift/Alt/Meta)
      // are wrapped around the click via `Keyboard Key down/up` so semantics
      // like Ctrl+Click (open in new tab) are preserved.
      case 'click': {
        const sel = safeSelector(action.selector);
        const modKeys = decodeModifiers(action.modifiers);

        for (const mod of modKeys) {
          fmt.keyword('Keyboard Key', 'down', mod);
        }

        if (action.clickCount === 2) {
          fmt.keyword(kw('click'), sel, 'clickCount=2');
        } else {
          fmt.keyword(kw('click'), sel);
        }

        // Release modifiers in reverse order (LIFO — matches how keyboards stack).
        for (const mod of [...modKeys].reverse()) {
          fmt.keyword('Keyboard Key', 'up', mod);
        }
        return true;
      }

      // ── hover ─────────────────────────────────────────────────────────────
      case 'hover':
        fmt.keyword(kw('hover'), safeSelector(action.selector));
        return true;

      // ── fill ──────────────────────────────────────────────────────────────
      case 'fill':
        fmt.keyword(kw('fill'), safeSelector(action.selector), escapeRobotValue(action.text));
        return true;

      // ── press ─────────────────────────────────────────────────────────────
      case 'press':
        fmt.keyword(
          kw('press'),
          safeSelector(action.selector),
          formatKeyWithModifiers(action.key, action.modifiers),
        );
        return true;

      // ── check / uncheck ───────────────────────────────────────────────────
      case 'check':
        fmt.keyword(kw('check'), safeSelector(action.selector));
        return true;

      case 'uncheck':
        fmt.keyword(kw('uncheck'), safeSelector(action.selector));
        return true;

      // ── select ────────────────────────────────────────────────────────────
      // Playwright records the HTML `value` attribute of each chosen <option>,
      // NOT the visible text. Use `value` strategy to match exactly — `text`
      // would silently mis-select whenever value ≠ visible label (the common
      // case for <option value="us">United States</option>).
      case 'select':
        fmt.keyword(
          kw('select'),
          safeSelector(action.selector),
          'value',
          ...action.options.map(escapeRobotValue),
        );
        return true;

      // ── setInputFiles ─────────────────────────────────────────────────────
      // Older Browser Library versions accept only one path per
      // `Upload File By Selector` call. Emit one call per file for the widest
      // version compatibility (and obvious failure-line attribution at runtime).
      case 'setInputFiles': {
        const sel = safeSelector(action.selector);
        for (const file of action.files) {
          fmt.keyword(kw('setInputFiles'), sel, escapeRobotValue(file));
        }
        return true;
      }

      // ── assertVisible ─────────────────────────────────────────────────────
      case 'assertVisible':
        fmt.keyword(kw('assertVisible'), safeSelector(action.selector), '*=', 'visible');
        return true;

      // ── assertText ────────────────────────────────────────────────────────
      case 'assertText': {
        const op = action.substring ? '*=' : '==';
        fmt.keyword(
          kw('assertText'),
          safeSelector(action.selector),
          op,
          escapeRobotValue(action.text),
        );
        return true;
      }

      // ── assertValue ───────────────────────────────────────────────────────
      case 'assertValue':
        fmt.keyword(
          kw('assertValue'),
          safeSelector(action.selector),
          'value',
          '==',
          escapeRobotValue(action.value),
        );
        return true;

      // ── assertChecked ─────────────────────────────────────────────────────
      case 'assertChecked':
        fmt.keyword(
          kw('assertChecked'),
          safeSelector(action.selector),
          '==',
          action.checked ? 'checked' : 'unchecked',
        );
        return true;

      // ── assertSnapshot ────────────────────────────────────────────────────
      // No Browser Library equivalent — emit a single # TODO comment.
      // Real newlines in ariaSnapshot are replaced with the literal two-char sequence \n.
      case 'assertSnapshot': {
        const inline = action.ariaSnapshot.replace(/\n/g, '\\n');
        fmt.comment(`TODO: assertSnapshot not supported — ariaSnapshot: ${inline}`);
        return true;
      }

      // ── Exhaustiveness sentinel ───────────────────────────────────────────
      // If a new ActionName is added to src/types.ts but not handled above,
      // TypeScript will fail this assignment at compile time — the codebase
      // can no longer drift silently. The runtime branch keeps the .robot
      // file readable for the human looking at the diff.
      default: {
        const _exhaustive: never = action;
        void _exhaustive;
        const stray = action as { name?: string };
        fmt.comment(`TODO: unsupported action "${stray.name ?? '?'}" — ${JSON.stringify(action)}`);
        return true;
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // generateFooter
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Emit browser lifecycle teardown.
   *
   * Always includes `Close Browser`.  When `saveStorage` is provided, a
   * `# TODO` reminder is prepended for the developer to wire up storage-state
   * saving (Browser Library's keyword may vary by version).
   *
   * Returns a string without trailing newline (the orchestrator adds one via
   * `[header, ...actions, footer].join('\n').trimEnd() + '\n'`).
   */
  generateFooter(saveStorage?: string): string {
    const fmt = new RobotFormatter();
    if (saveStorage) {
      fmt.comment(`TODO: Save storage state to: ${escapeRobotValue(saveStorage)}`);
      fmt.comment(`      Use: Save Storage State    ${escapeRobotValue(saveStorage)}`);
    }
    fmt.keyword('Close Browser');
    return fmt.format();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context-options helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert relevant `BrowserContextOptions` + optional device name to positional
 * keyword arguments for the `New Context` Browser Library call.
 *
 * Returns an empty array when no options are given (produces bare `New Context`).
 */
function buildContextArgs(options?: BrowserContextOptions, deviceName?: string): string[] {
  const args: string[] = [];

  if (deviceName) {
    args.push(`device=${deviceName}`);
  }

  if (options?.viewport) {
    const { width, height } = options.viewport;
    args.push(`viewport={'width': ${width}, 'height': ${height}}`);
  }

  if (options?.locale) {
    args.push(`locale=${options.locale}`);
  }

  if (options?.timezoneId) {
    args.push(`timezone=${options.timezoneId}`);
  }

  return args;
}
