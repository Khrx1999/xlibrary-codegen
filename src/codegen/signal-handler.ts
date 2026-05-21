/**
 * Translates Playwright recording signals into Robot Framework / Browser Library keyword lines.
 *
 * Signals are side-effects that happen alongside an action:
 *   navigation  — the browser navigated to a new URL (triggered by click, submit, etc.)
 *   popup       — a new page/popup window opened
 *   download    — a file download started
 *   dialog      — a JavaScript alert/confirm/prompt appeared
 *
 * In Playwright's Python/JS codegen these generate `expect_popup()`, `expect_download()`,
 * etc. wrappers around the triggering action.  Browser Library handles navigation
 * automatically on actions like `Click`, so navigation signals require no extra keyword.
 * The others are emitted as `# TODO:` comment blocks so the developer can fill them in.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors vendor/playwright/packages/recorder/src/actions.d.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type NavigationSignal = {
  name: 'navigation';
  url: string;
};

export type PopupSignal = {
  name: 'popup';
  popupAlias: string;
};

export type DownloadSignal = {
  name: 'download';
  downloadAlias: string;
};

export type DialogSignal = {
  name: 'dialog';
  dialogAlias: string;
};

export type Signal = NavigationSignal | PopupSignal | DownloadSignal | DialogSignal;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return Robot Framework lines to emit **before** the triggering action keyword.
 *
 * @param signals  The `signals` array from an `Action`.
 * @param indent   The indentation prefix (e.g. `'    '` for 4-space test-case body).
 * @returns        An array of Robot Framework lines (may be empty).
 */
export function signalLinesBefore(signals: Signal[], indent: string): string[] {
  const lines: string[] = [];

  for (const signal of signals) {
    switch (signal.name) {
      case 'dialog':
        // Browser Library can handle dialogs via `Handle Alert` before the action.
        // Emit a reminder — the exact keyword depends on the dialog type.
        lines.push(
          `${indent}# TODO: Handle dialog signal "${signal.dialogAlias}"`,
          `${indent}# Handle Alert    action=dismiss`,
        );
        break;

      // popup / download are handled with `after` lines; nothing before.
      default:
        break;
    }
  }

  return lines;
}

/**
 * Return Robot Framework lines to emit **after** the triggering action keyword.
 *
 * @param signals  The `signals` array from an `Action`.
 * @param indent   The indentation prefix.
 * @returns        An array of Robot Framework lines (may be empty).
 */
export function signalLinesAfter(signals: Signal[], indent: string): string[] {
  const lines: string[] = [];

  for (const signal of signals) {
    switch (signal.name) {
      case 'navigation':
        // Browser Library automatically waits for navigation on `Click`, `Go To`, etc.
        // Emit as an informational comment only — no extra keyword needed.
        lines.push(`${indent}# Navigation to: ${signal.url}`);
        break;

      case 'popup': {
        // The action opened a new page.  Capture it via `New Page` context or
        // use `Wait For New Page` if available.  Emit a TODO for now.
        const alias = signal.popupAlias;
        lines.push(
          `${indent}# TODO: Capture popup page (alias: ${alias})`,
          `${indent}# ${alias}=    Wait For New Page`,
        );
        break;
      }

      case 'download': {
        const alias = signal.downloadAlias;
        lines.push(
          `${indent}# TODO: Handle download (alias: download${alias})`,
          `${indent}# download${alias}=    Wait For Download`,
        );
        break;
      }

      // dialog is handled in `before`
      default:
        break;
    }
  }

  return lines;
}
