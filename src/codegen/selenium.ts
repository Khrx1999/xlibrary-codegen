/**
 * SeleniumLibraryLanguageGenerator
 *
 * Generates Robot Framework `.robot` files that use **SeleniumLibrary**
 * (Selenium WebDriver) instead of Browser Library (Playwright).
 *
 * This is registered alongside RobotFrameworkLanguageGenerator so the
 * Playwright Inspector "Target:" dropdown offers BOTH variants — pick whichever
 * library fits the test team's stack.
 *
 * Interface contract (must match Playwright's `LanguageGenerator`):
 *   - `id`, `groupName`, `name`, `highlighter`
 *   - `generateHeader(options) → string`
 *   - `generateAction(actionInContext) → string`
 *   - `generateFooter(saveStorage?) → string`
 *
 * Snapshot contract (golden .robot files):
 *   tests/snapshots/selenium/<action>.robot
 */

import type { LaunchOptions, BrowserContextOptions } from 'playwright-core';
import { ACTION_TO_SL_KEYWORD, NO_SL_EQUIVALENT } from './selenium-keywords-map.js';
import type { ActionName } from './keywords-map.js';
import { translateSelectorForSelenium } from './selenium-locator.js';
import { escapeRobotValue } from './locator-translator.js';
import { signalLinesBefore, signalLinesAfter } from './signal-handler.js';
import { formatKeyWithModifiers, toSeleniumModifier } from './keyboard-modifiers.js';
import { RobotFormatter, INDENT } from './robot-formatter.js';
import { formatXlibComment } from './xlib-comment.js';
import { rankCandidates } from './locator-grader.js';
import type { Action, ActionInContext } from '../types.js';

export type { ActionInContext };

/** Matches LanguageGeneratorOptions from playwright-core. */
export type LanguageGeneratorOptions = {
  browserName: string;
  launchOptions: LaunchOptions;
  contextOptions: BrowserContextOptions;
  deviceName?: string;
  saveStorage?: string;
  generateAutoExpect?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SeleniumLibrary's `Press Keys` uses upper-cased key names (`ENTER`, `TAB`).
 * Modifiers follow the Selenium dialect (`CTRL` not `Control`), supplied via
 * the `toSeleniumModifier` transformer in `keyboard-modifiers.ts`.
 */
function formatKey(key: string, modifiers: number): string {
  return formatKeyWithModifiers(key.toUpperCase(), modifiers, toSeleniumModifier);
}

// ─────────────────────────────────────────────────────────────────────────────
// Selector pipeline helper
// ─────────────────────────────────────────────────────────────────────────────

function safeSelector(selector: string): string {
  return escapeRobotValue(translateSelectorForSelenium(selector));
}

// ─────────────────────────────────────────────────────────────────────────────
// SeleniumLibraryLanguageGenerator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates Robot Framework `.robot` content driven by SeleniumLibrary.
 *
 * Differences from RobotFrameworkLanguageGenerator (Browser Library):
 *   - Header carries only `Library    SeleniumLibrary` — there is no explicit
 *     `New Browser` / `New Context` step; SeleniumLibrary opens the browser
 *     as part of `Open Browser <url>` on the first navigation.
 *   - Action keywords use the SeleniumLibrary names (see
 *     selenium-keywords-map.ts).
 *   - Selectors are translated via translateSelectorForSelenium() which
 *     maps role/text/label to XPath (SeleniumLibrary has no native role= /
 *     text= strategies).
 */
export class SeleniumLibraryLanguageGenerator {
  readonly id = 'selenium';
  readonly groupName = 'Robot Framework';
  readonly name = 'SeleniumLibrary';
  readonly highlighter = 'python' as const;

  private readonly _testName: string;
  private readonly _libraryLine: string;
  private readonly _defaultBrowser: string;

  constructor(testName = 'Recorded Flow', libraryLine = 'Library    SeleniumLibrary') {
    this._testName = testName;
    this._libraryLine = libraryLine;
    this._defaultBrowser = 'chrome';
  }

  // ── State for openPage/navigate collapse ────────────────────────────────
  //
  // SeleniumLibrary opens the browser AND navigates in a SINGLE `Open Browser`
  // call. The recorder, however, emits two actions for a fresh tab + URL:
  //   1. openPage(url='about:blank')
  //   2. navigate(url=<actual url>)
  //
  // We collapse the pair so the output reads:
  //   Open Browser    <actual url>    chrome
  // …instead of:
  //   Open Browser    about:blank     chrome
  //   Go To           <actual url>
  //
  // `_browserOpened` flips to `true` after we emit the first `Open Browser`
  // line, so subsequent navigates become `Go To`.
  private _pendingBlankPage = false;
  private _browserOpened = false;
  private _currentBrowserName = 'chrome';

  // ── Step counter for xlib:step=N markers ─────────────────────────────────
  //
  // Monotonic 1-indexed counter — incremented only for actions that produce
  // output. Reset to 0 in generateHeader() at the start of each render pass.
  private _stepCounter = 0;

  // ── Action capture for Replay ────────────────────────────────────────────
  //
  // Every call to generateAction() that produces output appends the action
  // to this array. The runner reads `getCapturedActions()` to drive the
  // viewer's Replay button — same contract as RobotFrameworkLanguageGenerator.
  private _capturedActions: ActionInContext[] = [];

  /**
   * Return the full action list captured during this render pass.
   * Returns a defensive copy — mirrors RobotFrameworkLanguageGenerator's
   * contract so callers can't mutate the emitter's internal state.
   */
  getCapturedActions(): ActionInContext[] {
    return [...this._capturedActions];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // generateHeader
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Emit `.robot` boilerplate. Unlike Browser Library, there is no
   * `New Browser`/`New Context`/`New Page` here — SeleniumLibrary opens the
   * browser as part of `Open Browser` which fires on the first navigation
   * (handled in generateAction).
   */
  generateHeader(options?: LanguageGeneratorOptions): string {
    // Reset captured actions and step counter — start of a fresh render pass.
    this._capturedActions = [];
    this._stepCounter = 0;
    this._currentBrowserName = mapBrowserName(options?.browserName);

    return new RobotFormatter()
      .section('Settings')
      .raw(this._libraryLine)
      .blank()
      .section('Test Cases')
      .raw(this._testName)
      .format();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // generateAction
  // ───────────────────────────────────────────────────────────────────────────

  generateAction(actionInContext: ActionInContext): string {
    const { action } = actionInContext;
    const fmt = new RobotFormatter();

    // Capture EVERY action (including skipped ones) — matches the RF emitter's
    // contract so the Replay engine sees identical action lists across langs.
    // Push BEFORE early-return paths; consumers decide what to filter.
    this._capturedActions.push(actionInContext);

    for (const line of signalLinesBefore(action.signals, INDENT)) {
      fmt.rawLine(line);
    }

    const emitted = this._emitAction(fmt, action);

    if (action.name !== 'openPage' && action.name !== 'navigate') {
      this._pendingBlankPage = false;
    }

    if (!emitted) return '';

    // Increment step counter — only for actions that produce output.
    this._stepCounter += 1;

    // Build the xlib self-healing comment (graceful degrade: alts only when
    // alternatives[] is populated by the JSONL-bridge patch).
    const alternatives =
      'alternatives' in action && Array.isArray(action.alternatives)
        ? action.alternatives
        : undefined;

    let xlibAlts: string[] | undefined;
    if (alternatives && alternatives.length > 1) {
      // Exclude the primary selector from the alts (it's already in the
      // keyword call — alts are distinct fallbacks). NavigateAction has no
      // selector field, so type-narrow before reading.
      const primarySelector = 'selector' in action ? action.selector : undefined;
      const ranked = rankCandidates(alternatives.map((s: string) => ({ selector: s })));
      xlibAlts = ranked
        .map((r) => r.selector)
        .filter((s) => s !== primarySelector)
        .slice(0, 3);
    }

    // Emit the xlib comment ONLY when there are alternatives worth recording.
    // Bare `# xlib:step=N` lines were noise — patch command falls back to
    // fuzzy content match when markers are absent.
    if (xlibAlts && xlibAlts.length > 0) {
      const xlibComment = INDENT + formatXlibComment({ step: this._stepCounter, alts: xlibAlts });
      fmt.rawLine(xlibComment);
    }

    for (const line of signalLinesAfter(action.signals, INDENT)) {
      fmt.rawLine(line);
    }

    return fmt.format();
  }

  /**
   * Per-action emission. Returns `true` when at least one line was added.
   */
  private _emitAction(fmt: RobotFormatter, action: Action): boolean {
    const kw = (name: ActionName): string => ACTION_TO_SL_KEYWORD[name].keyword;

    switch (action.name) {
      // ── openPage ─────────────────────────────────────────────────────────
      case 'openPage': {
        const url = action.url;
        if (!url || url === 'about:blank' || url === 'chrome://newtab/') {
          this._pendingBlankPage = true;
          return false;
        }
        // Real URL on a fresh page → open the browser and navigate at once.
        this._pendingBlankPage = false;
        if (!this._browserOpened) {
          this._browserOpened = true;
          fmt.keyword(kw('openPage'), escapeRobotValue(url), this._currentBrowserName);
        } else {
          fmt.keyword(kw('navigate'), escapeRobotValue(url));
        }
        return true;
      }

      // ── closePage ────────────────────────────────────────────────────────
      // SeleniumLibrary has no per-tab close in the recorder's flow; we let
      // the footer handle teardown via `Close Browser`. Returning false here
      // matches the recorder's "close = end of session" intent.
      case 'closePage':
        this._pendingBlankPage = false;
        return false;

      // ── navigate ─────────────────────────────────────────────────────────
      case 'navigate': {
        if (this._pendingBlankPage || !this._browserOpened) {
          this._pendingBlankPage = false;
          this._browserOpened = true;
          fmt.keyword(kw('openPage'), escapeRobotValue(action.url), this._currentBrowserName);
          return true;
        }
        fmt.keyword(kw('navigate'), escapeRobotValue(action.url));
        return true;
      }

      // ── click ────────────────────────────────────────────────────────────
      // Double-click has its own SL keyword. Modifier-click is rare in the
      // recorder; we approximate via `Press Keys + Click` rather than try
      // to faithfully reproduce the modifier-down/up dance.
      case 'click': {
        const sel = safeSelector(action.selector);

        if (action.clickCount === 2) {
          fmt.keyword('Double Click Element', sel);
        } else {
          fmt.keyword(kw('click'), sel);
        }
        return true;
      }

      // ── hover ────────────────────────────────────────────────────────────
      case 'hover':
        fmt.keyword(kw('hover'), safeSelector(action.selector));
        return true;

      // ── fill ─────────────────────────────────────────────────────────────
      case 'fill':
        fmt.keyword(kw('fill'), safeSelector(action.selector), escapeRobotValue(action.text));
        return true;

      // ── press ────────────────────────────────────────────────────────────
      case 'press':
        fmt.keyword(
          kw('press'),
          safeSelector(action.selector),
          formatKey(action.key, action.modifiers),
        );
        return true;

      // ── check / uncheck ──────────────────────────────────────────────────
      case 'check':
        fmt.keyword(kw('check'), safeSelector(action.selector));
        return true;

      case 'uncheck':
        fmt.keyword(kw('uncheck'), safeSelector(action.selector));
        return true;

      // ── select ───────────────────────────────────────────────────────────
      case 'select': {
        const sel = safeSelector(action.selector);
        for (const value of action.options) {
          fmt.keyword(kw('select'), sel, escapeRobotValue(value));
        }
        return true;
      }

      // ── setInputFiles ────────────────────────────────────────────────────
      case 'setInputFiles': {
        const sel = safeSelector(action.selector);
        for (const file of action.files) {
          fmt.keyword(kw('setInputFiles'), sel, escapeRobotValue(file));
        }
        return true;
      }

      // ── assertVisible ────────────────────────────────────────────────────
      case 'assertVisible':
        fmt.keyword(kw('assertVisible'), safeSelector(action.selector));
        return true;

      // ── assertText ───────────────────────────────────────────────────────
      case 'assertText': {
        if (action.substring) {
          fmt.keyword(
            'Element Should Contain',
            safeSelector(action.selector),
            escapeRobotValue(action.text),
          );
        } else {
          fmt.keyword(
            kw('assertText'),
            safeSelector(action.selector),
            escapeRobotValue(action.text),
          );
        }
        return true;
      }

      // ── assertValue ──────────────────────────────────────────────────────
      case 'assertValue':
        fmt.keyword(
          kw('assertValue'),
          safeSelector(action.selector),
          escapeRobotValue(action.value),
        );
        return true;

      // ── assertChecked ────────────────────────────────────────────────────
      case 'assertChecked':
        if (action.checked) {
          fmt.keyword(kw('assertChecked'), safeSelector(action.selector));
        } else {
          fmt.keyword('Checkbox Should Not Be Selected', safeSelector(action.selector));
        }
        return true;

      // ── assertSnapshot ───────────────────────────────────────────────────
      case 'assertSnapshot': {
        void NO_SL_EQUIVALENT; // referenced to keep the constant alive at use site
        const inline = action.ariaSnapshot.replace(/\n/g, '\\n');
        fmt.comment(
          `TODO: assertSnapshot not supported in SeleniumLibrary — ariaSnapshot: ${inline}`,
        );
        return true;
      }

      // ── Exhaustiveness check ─────────────────────────────────────────────
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
   * Emit `Close Browser` to release the WebDriver session. If
   * `Open Browser` was never emitted (e.g. recording closed before any
   * navigation) we skip the footer entirely — `Close Browser` with no
   * open session would error at runtime.
   */
  generateFooter(saveStorage?: string): string {
    const fmt = new RobotFormatter();
    if (saveStorage) {
      fmt.comment(
        `TODO: saveStorage → ${saveStorage} (SeleniumLibrary has no built-in storage-state save)`,
      );
    }
    if (this._browserOpened) {
      fmt.keyword('Close Browser');
    }
    return fmt.format();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser-name mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SeleniumLibrary's `Open Browser` accepts driver names: `chrome`,
 * `firefox`, `safari`, `edge`, `ie`, `htmlunit` etc. Playwright uses
 * `chromium`, `firefox`, `webkit` — translate to the closest SL equivalent.
 */
function mapBrowserName(pwName: string | undefined): string {
  switch (pwName) {
    case 'chromium':
      return 'chrome';
    case 'firefox':
      return 'firefox';
    case 'webkit':
      return 'safari'; // closest match — WebKit on macOS
    default:
      return 'chrome';
  }
}
