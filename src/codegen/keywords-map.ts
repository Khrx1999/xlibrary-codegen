/**
 * Robot Framework Browser Library — Playwright Action → Keyword NAME map
 *
 * This file is the SINGLE SOURCE OF TRUTH for the *keyword name* an action
 * translates to. Argument construction lives in the emitter
 * (`robotframework.ts`) because it needs side-information the map should not
 * carry (selector translation, value escaping, modifier wrapping,
 * `clickCount=2` for double-click, signal pre/post lines, etc.).
 *
 * Rules:
 *  - One keyword name per ActionName entry. No conditional logic here.
 *  - `keyword === NO_BL_EQUIVALENT` means the emitter must emit a `# TODO`
 *    comment instead of a keyword call (currently only `assertSnapshot`).
 *
 * @module keywords-map
 * @see https://marketsquare.github.io/robotframework-browser/Browser.html
 */

// ── Action name union ────────────────────────────────────────────────────
//
// Re-exported from `src/types.ts` (single source of truth). Keeping the
// re-export means consumers can `import { ActionName }` from this module
// without reaching into the types module — the keyword map and the type
// union now travel together, mechanically guaranteed to agree.

export type { ActionName } from '../types.js';
import type { ActionName } from '../types.js';

// ── Mapping types ────────────────────────────────────────────────────────────

/**
 * Sentinel keyword value for actions that have no Browser Library equivalent.
 *
 * The emitter MUST check `mapping.keyword === NO_BL_EQUIVALENT` and emit a
 * `# TODO:` comment instead of a keyword call.
 *
 * Using an exported constant (rather than `null`) keeps the return type of
 * `ACTION_TO_KEYWORD` as a complete `Record<ActionName, KeywordMapping>` so
 * the emitter's simple `.keyword` lookup never fails at the type level.
 */
export const NO_BL_EQUIVALENT = '__no_browser_library_equivalent__' as const;

/**
 * A single keyword mapping entry.
 *
 * Argument construction is the emitter's responsibility (see
 * `_emitAction` in `robotframework.ts`) — it owns selector translation,
 * value escaping, modifier wrapping, etc.
 */
export interface KeywordMapping {
  /**
   * Exact Browser Library keyword name (case-sensitive), OR
   * `NO_BL_EQUIVALENT` if this action has no BL equivalent.
   */
  keyword: string;
}

// ── Mapping table ────────────────────────────────────────────────────────────

/**
 * Complete mapping from every Playwright `ActionName` to a Browser Library
 * keyword. All entries are non-null so the emitter can safely access
 * `.keyword` on any entry without null-checks.
 *
 * Notes per row are kept terse — full per-action documentation lives in
 * `docs/action-catalog.md`.
 *
 * @see https://marketsquare.github.io/robotframework-browser/Browser.html
 */
export const ACTION_TO_KEYWORD: Record<ActionName, KeywordMapping> = {
  // ── Page lifecycle ──────────────────────────────────────────────────────
  /** `New Page    url=None` — also used by the openPage/navigate collapse path. */
  openPage: { keyword: 'New Page' },
  /** `Close Page` — emitter currently always emits this; tests own the teardown. */
  closePage: { keyword: 'Close Page' },
  /** `Go To    url` — navigation on the active page. */
  navigate: { keyword: 'Go To' },

  // ── User interactions ───────────────────────────────────────────────────
  /**
   * `Click    selector    [clickCount=N]` — the emitter passes `clickCount=2`
   * for double-click and wraps modifier keys via `Keyboard Key down/up`.
   * Browser Library has no separate `Double Click` keyword.
   */
  click: { keyword: 'Click' },
  /** `Fill Text    selector    text` — clears then types instantly. */
  fill: { keyword: 'Fill Text' },
  /** `Press Keys    selector    *keys` — variadic key args. */
  press: { keyword: 'Press Keys' },
  /** `Check Checkbox    selector`. */
  check: { keyword: 'Check Checkbox' },
  /** `Uncheck Checkbox    selector`. */
  uncheck: { keyword: 'Uncheck Checkbox' },
  /**
   * `Select Options By    selector    value    *values` — the emitter passes
   * `value` strategy because Playwright records the HTML value attribute of
   * the chosen `<option>`, NOT the visible label/text.
   */
  select: { keyword: 'Select Options By' },
  /** `Hover    selector`. */
  hover: { keyword: 'Hover' },
  /**
   * `Upload File By Selector    selector    path` — emitter emits one call
   * per file in `SetInputFilesAction.files` for backward compatibility with
   * Browser Library versions that don't yet accept `*extra_paths`.
   */
  setInputFiles: { keyword: 'Upload File By Selector' },

  // ── Assertions ──────────────────────────────────────────────────────────
  /** `Get Element States    selector    *=    visible`. */
  assertVisible: { keyword: 'Get Element States' },
  /** `Get Text    selector    ==|*=    text`. */
  assertText: { keyword: 'Get Text' },
  /** `Get Property    selector    value    ==    expected`. */
  assertValue: { keyword: 'Get Property' },
  /** `Get Checkbox State    selector    ==    checked|unchecked`. */
  assertChecked: { keyword: 'Get Checkbox State' },

  /**
   * ARIA snapshot assertion — no Browser Library equivalent.
   * Emitter checks for `NO_BL_EQUIVALENT` and emits a `# TODO` comment.
   */
  assertSnapshot: { keyword: NO_BL_EQUIVALENT },
};
