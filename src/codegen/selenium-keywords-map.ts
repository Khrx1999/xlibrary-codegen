/**
 * Robot Framework SeleniumLibrary — Playwright Action → Keyword NAME map
 *
 * SeleniumLibrary uses a different keyword vocabulary than Browser Library:
 * `Click Element` instead of `Click`, `Input Text` instead of `Fill Text`,
 * `Open Browser` instead of `New Browser` + `New Context` + `New Page`, etc.
 *
 * Argument construction is the emitter's responsibility (see selenium.ts).
 *
 * @module selenium-keywords-map
 * @see https://robotframework.org/SeleniumLibrary/SeleniumLibrary.html
 */

import type { ActionName } from './keywords-map.js';

/**
 * Sentinel for actions that have no clean SeleniumLibrary equivalent.
 * The emitter checks for this and emits a `# TODO` instead.
 */
export const NO_SL_EQUIVALENT = '__no_selenium_library_equivalent__' as const;

export interface SeleniumKeywordMapping {
  keyword: string;
}

/**
 * Complete Action → SeleniumLibrary keyword mapping. Compare to
 * `ACTION_TO_KEYWORD` in keywords-map.ts which targets Browser Library.
 *
 * @see https://robotframework.org/SeleniumLibrary/SeleniumLibrary.html
 */
export const ACTION_TO_SL_KEYWORD: Record<ActionName, SeleniumKeywordMapping> = {
  // ── Page lifecycle ──────────────────────────────────────────────────────
  /**
   * `Open Browser    url    browser` — SeleniumLibrary opens the browser AND
   * navigates in a single call. The emitter collapses the recorder's
   * openPage(about:blank) + navigate(url) pair into one `Open Browser` line
   * to match how a human would write the test.
   */
  openPage: { keyword: 'Open Browser' },
  /** `Close Browser` — SeleniumLibrary has no per-tab close in the recorder context. */
  closePage: { keyword: 'Close Browser' },
  /** `Go To    url` — same name as Browser Library, conveniently. */
  navigate: { keyword: 'Go To' },

  // ── User interactions ───────────────────────────────────────────────────
  /**
   * `Click Element    locator`. For double-click the emitter swaps in
   * `Double Click Element` (SeleniumLibrary HAS this dedicated keyword).
   * Modifier keys are wrapped via `Press Keys    NONE    <mod>+click` — not
   * a perfect parallel to BL's Keyboard Key but close enough; the recorder
   * rarely captures modifier-clicks.
   */
  click: { keyword: 'Click Element' },
  /** `Input Text    locator    text` — equivalent to BL's `Fill Text`. */
  fill: { keyword: 'Input Text' },
  /** `Press Keys    locator    key` — same name as BL. */
  press: { keyword: 'Press Keys' },
  /** `Select Checkbox    locator`. */
  check: { keyword: 'Select Checkbox' },
  /** `Unselect Checkbox    locator`. */
  uncheck: { keyword: 'Unselect Checkbox' },
  /**
   * `Select From List By Value    locator    *values`. Playwright records the
   * HTML value attribute, not the visible label, so this is the correct
   * variant. SeleniumLibrary also has `Select From List By Label` and
   * `Select From List By Index` for other use cases.
   */
  select: { keyword: 'Select From List By Value' },
  /** `Mouse Over    locator` — SeleniumLibrary uses "Mouse Over" not "Hover". */
  hover: { keyword: 'Mouse Over' },
  /** `Choose File    locator    path` — one call per file (matches BL pattern). */
  setInputFiles: { keyword: 'Choose File' },

  // ── Assertions ──────────────────────────────────────────────────────────
  /** `Element Should Be Visible    locator`. */
  assertVisible: { keyword: 'Element Should Be Visible' },
  /**
   * `Element Text Should Be    locator    text` for exact match, or
   * `Element Should Contain    locator    text` for substring. The emitter
   * picks the variant based on `action.substring`.
   */
  assertText: { keyword: 'Element Text Should Be' },
  /** `Textfield Value Should Be    locator    value`. */
  assertValue: { keyword: 'Textfield Value Should Be' },
  /**
   * `Checkbox Should Be Selected    locator` or
   * `Checkbox Should Not Be Selected    locator` — emitter picks based on
   * `action.checked`.
   */
  assertChecked: { keyword: 'Checkbox Should Be Selected' },

  /**
   * ARIA snapshot assertion — no SeleniumLibrary equivalent.
   * Emitter checks NO_SL_EQUIVALENT and emits a `# TODO` comment.
   */
  assertSnapshot: { keyword: NO_SL_EQUIVALENT },
};
