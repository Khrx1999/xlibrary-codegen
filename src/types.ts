/**
 * Shared types for xlibrary.
 *
 * Action* types derived from:
 *   vendor/playwright/packages/recorder/src/actions.d.ts
 *
 * LanguageGenerator interface derived from:
 *   vendor/playwright/packages/playwright-core/src/server/codegen/types.ts:31-39
 *
 * LanguageGeneratorOptions derived from:
 *   vendor/playwright/packages/playwright-core/src/server/codegen/types.ts:22-29
 */

// ─── CLI / project options ────────────────────────────────────────────────────

/**
 * Target language / emitter for the recorder session.
 *
 * | Value      | Playwright language ID  | Output                            |
 * |------------|-------------------------|-----------------------------------|
 * | `robot`    | `robotframework` / `jsonl` | Robot Framework + Browser Library |
 * | `selenium` | `selenium`              | Robot Framework + SeleniumLibrary |
 * | `ts`       | `playwright-test`       | TypeScript Playwright Test file   |
 * | `python`   | `python-pytest`         | Python pytest-playwright file     |
 */
export type RecorderLang = 'robot' | 'selenium' | 'ts' | 'python';

export interface RobotCodegenOptions {
  url?: string;
  output?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headed?: boolean;
  testName?: string;
  libraryImportLine?: string;
  /**
   * Target language / emitter for this recording session.
   * Defaults to `'robot'` (Browser Library output).
   */
  lang?: RecorderLang;
  /** Suppress the live keyword preview printed to stdout during recording. */
  quiet?: boolean;
  /**
   * After recording ends, automatically open the output `.robot` file in the
   * user's default editor (VS Code preferred; falls back to OS default).
   */
  open?: boolean;
  /**
   * Launch an auxiliary browser window that shows the `.robot` output
   * syntax-highlighted and updated live via WebSocket.
   * Defaults to `true`; pass `--no-viewer` on the CLI to disable.
   */
  viewer?: boolean;
  /**
   * Auto-open the viewer-server URL in the OS default browser.
   * Defaults to `false` — the Playwright Inspector window gets an injected
   * "📊 Open Live Preview" button instead, so the user can pop the viewer
   * open only when they need it. Pass `--open-viewer` to restore the old
   * auto-open behaviour.
   */
  openViewer?: boolean;
}

export interface RobotSection {
  settings: string[];
  variables: string[];
  testCases: string[];
  keywords: string[];
}

// ─── Playwright Action types (copied from actions.d.ts) ───────────────────────
// Source: vendor/playwright/packages/recorder/src/actions.d.ts

type Point = { x: number; y: number };

export type ActionName =
  | 'check'
  | 'click'
  | 'hover'
  | 'closePage'
  | 'fill'
  | 'navigate'
  | 'openPage'
  | 'press'
  | 'select'
  | 'uncheck'
  | 'setInputFiles'
  | 'assertText'
  | 'assertValue'
  | 'assertChecked'
  | 'assertVisible'
  | 'assertSnapshot';

export type ActionBase = {
  name: ActionName;
  signals: Signal[];
  ariaSnapshot?: string;
  preconditionSelector?: string;
};

export type ActionWithSelector = ActionBase & {
  selector: string;
  ref?: string;
};

export type ClickAction = ActionWithSelector & {
  name: 'click';
  button: 'left' | 'middle' | 'right';
  modifiers: number; // bitmask: Alt=1, Control=2, Meta=4, Shift=8
  clickCount: number;
  position?: Point;
};

export type HoverAction = ActionWithSelector & {
  name: 'hover';
  position?: Point;
};

export type CheckAction = ActionWithSelector & {
  name: 'check';
};

export type UncheckAction = ActionWithSelector & {
  name: 'uncheck';
};

export type FillAction = ActionWithSelector & {
  name: 'fill';
  text: string;
};

export type NavigateAction = ActionBase & {
  name: 'navigate';
  url: string;
};

export type OpenPageAction = ActionBase & {
  name: 'openPage';
  url: string;
};

export type ClosesPageAction = ActionBase & {
  name: 'closePage';
};

export type PressAction = ActionWithSelector & {
  name: 'press';
  key: string;
  modifiers: number;
};

export type SelectAction = ActionWithSelector & {
  name: 'select';
  options: string[];
};

export type SetInputFilesAction = ActionWithSelector & {
  name: 'setInputFiles';
  files: string[];
};

export type AssertTextAction = ActionWithSelector & {
  name: 'assertText';
  text: string;
  substring: boolean;
};

export type AssertValueAction = ActionWithSelector & {
  name: 'assertValue';
  value: string;
};

export type AssertCheckedAction = ActionWithSelector & {
  name: 'assertChecked';
  checked: boolean;
};

export type AssertVisibleAction = ActionWithSelector & {
  name: 'assertVisible';
};

export type AssertSnapshotAction = ActionWithSelector & {
  name: 'assertSnapshot';
  ariaSnapshot: string;
};

export type Action =
  | ClickAction
  | HoverAction
  | CheckAction
  | ClosesPageAction
  | OpenPageAction
  | UncheckAction
  | FillAction
  | NavigateAction
  | PressAction
  | SelectAction
  | SetInputFilesAction
  | AssertTextAction
  | AssertValueAction
  | AssertCheckedAction
  | AssertVisibleAction
  | AssertSnapshotAction;

export type AssertAction =
  | AssertCheckedAction
  | AssertValueAction
  | AssertTextAction
  | AssertVisibleAction
  | AssertSnapshotAction;

// ─── Signals (side-effects attached to actions) ───────────────────────────────
// Source: vendor/playwright/packages/recorder/src/actions.d.ts:134-159

export type NavigationSignal = { name: 'navigation'; url: string };
export type PopupSignal = { name: 'popup'; popupAlias: string };
export type DownloadSignal = { name: 'download'; downloadAlias: string };
export type DialogSignal = { name: 'dialog'; dialogAlias: string };
export type Signal = NavigationSignal | PopupSignal | DownloadSignal | DialogSignal;

// ─── Frame context ─────────────────────────────────────────────────────────────
// Source: vendor/playwright/packages/recorder/src/actions.d.ts:161-173

export type FrameDescription = {
  pageGuid: string;
  pageAlias: string;
  framePath: string[]; // empty = main frame; non-empty = iframe path
};

export type ActionInContext = {
  frame: FrameDescription;
  description?: string;
  action: Action;
  startTime: number;
  endTime?: number;
};

// ─── LanguageGenerator interface ──────────────────────────────────────────────

/**
 * Syntax highlighter hint for the recorder UI.
 * Use 'python' for Robot Framework (closest available highlighter).
 * Source: vendor/playwright/packages/isomorphic/locatorGenerators.ts:23
 */
export type HighlighterLanguage = 'javascript' | 'python' | 'java' | 'csharp' | 'jsonl';

/**
 * Options that may be passed to generateHeader() for Playwright-recorder-compatible
 * generators.  When building output via the JSONL bridge (our default approach),
 * these options are not needed — generateHeader() is called without arguments.
 *
 * Source: vendor/playwright/packages/playwright-core/src/server/codegen/types.ts:22-29
 */
export interface LanguageGeneratorOptions {
  browserName: string;
  launchOptions: {
    headless?: boolean;
    [key: string]: unknown;
  };
  contextOptions: {
    recordHar?: { path: string; urlFilter?: string };
    [key: string]: unknown;
  };
  deviceName?: string;
  saveStorage?: string;
  generateAutoExpect?: boolean;
}

/**
 * The interface implemented by RobotFrameworkLanguageGenerator.
 *
 * Design notes
 * ────────────
 * • generateHeader() and generateFooter() take NO required parameters.
 *   The constructor accepts `testName` and other static options.
 *   This keeps the interface simple for the JSONL-bridge usage pattern
 *   (runner.ts parses JSONL and calls generateAction() per action; it owns
 *   the overall section structure via formatter.ts).
 *
 * • generateAction() receives a full ActionInContext (reconstructed from JSONL)
 *   and returns a ready-to-join Robot Framework keyword-call string, including
 *   4-space indentation.  Empty string means "skip this action".
 *
 * Reference: vendor/playwright/packages/playwright-core/src/server/codegen/types.ts:31-39
 */
export interface LanguageGenerator {
  id: string;
  groupName: string;
  name: string;
  highlighter: HighlighterLanguage;

  /**
   * Emit the `*** Settings ***` and `*** Test Cases ***` header sections,
   * including browser/context lifecycle setup keywords when `options` is provided.
   *
   * @param options  Recorder options used to render `New Browser` and `New Context`
   *                 calls.  Pass `undefined` (or no argument) to emit a minimal
   *                 header without lifecycle setup — useful for unit testing.
   *
   * Expected format when options = { browserName: 'chromium', launchOptions: {}, contextOptions: {} }:
   * ```
   * *** Settings ***
   * Library    Browser
   *
   * *** Test Cases ***
   * Recorded Flow
   *     New Browser    chromium    headless=${False}
   *     New Context
   * ```
   */
  generateHeader(options?: LanguageGeneratorOptions): string;

  /**
   * Translate one recorded action into a Robot Framework keyword call line.
   *
   * Returns an empty string for actions that should be skipped (e.g. closePage).
   * The returned string already contains 4-space indentation.
   */
  generateAction(actionInContext: ActionInContext): string;

  /**
   * Emit teardown lines after the last action, typically `    Close Browser`.
   *
   * @param saveStorage  Optional path to save browser storage state.
   *                     When provided, a `# TODO:` comment is emitted before
   *                     the `Close Browser` call.
   */
  generateFooter(saveStorage?: string): string;
}
