/**
 * xlib-post-processor.ts
 *
 * Post-processing pass that injects `xlib:step=N` (and optionally `alts=[...]`)
 * markers into TypeScript (Playwright-test) and Python (pytest) output files
 * produced by Playwright's own built-in language generators.
 *
 * Why post-processing instead of a native generator:
 *   Playwright's `playwright-test` and `python-pytest` language generators are
 *   bundled inside coreBundle.js and cannot be replaced — only the Robot
 *   Framework generator is registered via our bundle-patcher hook. When the user
 *   selects TS or Python from the Inspector "Target:" dropdown, Playwright writes
 *   the output directly. We inject the xlib markers as a second pass.
 *
 * Strategy:
 *   Walk the output file line-by-line. For each "step line" (heuristic below),
 *   append an inline comment at the end of that line. A step counter is
 *   incremented for each matched line (1-indexed, monotonic).
 *
 * Step-line heuristics:
 *   - TypeScript: lines containing `await page.` (Playwright action calls)
 *   - Python:     lines containing `page.` followed by a method call
 *
 * Guard against double-tagging:
 *   If a line already contains a `// xlib:step=` or `# xlib:step=` marker,
 *   it is skipped — idempotent processing.
 *
 * Graceful degrade:
 *   `actionAlts` maps step index (0-based) to a list of alternative selectors.
 *   When the map is absent or the step has no entry, only `xlib:step=N` is
 *   appended (no alts clause). This mirrors the graceful-degrade decision for
 *   direct mode (see robot-emitter patch notes).
 */

import { formatXlibComment } from './xlib-comment.js';
import { rankCandidates } from './locator-grader.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PostProcessLanguage = 'typescript' | 'python';

export interface PostProcessOptions {
  /** Raw file content to process. */
  content: string;
  /** Target language — determines step-line detection heuristic and comment prefix. */
  language: PostProcessLanguage;
  /**
   * Optional map of 0-based action-index -> alternatives[].
   * When provided, the top-3 ranked alts (after the primary) are appended as
   * `alts=[...]` in the xlib comment.
   */
  actionAlts?: Map<number, string[]>;
}

export interface PostProcessResult {
  /** Processed content with xlib markers injected. */
  content: string;
  /** How many lines received a new xlib marker. */
  linesTagged: number;
}

// ---------------------------------------------------------------------------
// Step-line detection
// ---------------------------------------------------------------------------

/**
 * TypeScript step line: any line that calls a Playwright page/locator method.
 * We match `await page.` as the primary signal.
 * Also matches locator chains: `await page.locator(...)`, `await page.getBy...`.
 *
 * Lines that already carry a xlib:step= marker are excluded by ALREADY_TAGGED_RE.
 */
const TS_STEP_LINE_RE = /^\s+await\s+(?:page|context)\.[a-zA-Z]/;

/**
 * Python step line: `page.` method calls (Playwright/pytest-playwright pattern).
 * Lines like `    page.goto(...)`, `    page.click(...)`, etc.
 *
 * Lines that already carry a xlib:step= marker are excluded by ALREADY_TAGGED_RE.
 */
const PY_STEP_LINE_RE = /^\s+(?:page|context)\.[a-zA-Z]/;

/** Already-tagged guard — matches both TS (//) and Robot/Python (#) prefixes. */
const ALREADY_TAGGED_RE = /(?:\/\/|#)\s*xlib:step=\d/;

/**
 * Extract the step number embedded in an already-tagged line.
 * Works for both inline comments (`await page.goto(...)  // xlib:step=1`)
 * and standalone comment lines (`    # xlib:step=1`).
 * Returns 0 if no step number is found.
 */
function extractTaggedStepNumber(line: string): number {
  const m = line.match(/(?:\/\/|#)\s*xlib:step=(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10);
}

function isStepLine(line: string, language: PostProcessLanguage): boolean {
  if (ALREADY_TAGGED_RE.test(line)) return false;
  if (language === 'typescript') return TS_STEP_LINE_RE.test(line);
  return PY_STEP_LINE_RE.test(line);
}

// ---------------------------------------------------------------------------
// injectXlibMarkers
// ---------------------------------------------------------------------------

/**
 * Inject `xlib:step=N` markers into Playwright-generated TS/Python output.
 *
 * @param options  Content + language + optional alts map.
 * @returns        Processed content + count of lines tagged.
 *
 * @example
 * ```ts
 * const { content } = injectXlibMarkers({
 *   content: tsFileContent,
 *   language: 'typescript',
 * });
 * ```
 */
export function injectXlibMarkers(options: PostProcessOptions): PostProcessResult {
  const { content, language, actionAlts } = options;
  const prefix = language === 'typescript' ? '//' : '#';

  const lines = content.split('\n');
  const result: string[] = [];
  let stepCounter = 0;
  let actionIndex = 0; // 0-based index into the action stream
  let linesTagged = 0;

  for (const line of lines) {
    // If this line already carries a xlib:step=N marker, sync our counter so
    // a subsequent pass correctly continues numbering from where we left off.
    // This makes injectXlibMarkers idempotent.
    if (ALREADY_TAGGED_RE.test(line)) {
      const existing = extractTaggedStepNumber(line);
      if (existing > stepCounter) stepCounter = existing;
      result.push(line);
      continue;
    }

    if (isStepLine(line, language)) {
      stepCounter += 1;

      // Build alts from the action stream map (if provided).
      let xlibAlts: string[] | undefined;
      if (actionAlts) {
        const alts = actionAlts.get(actionIndex);
        if (alts && alts.length > 1) {
          // alts[0] is primary — the selector already in the line; alts[1..3] are candidates
          const ranked = rankCandidates(alts.map((s) => ({ selector: s })));
          xlibAlts = ranked.slice(1, 4).map((r) => r.selector);
        }
        actionIndex += 1;
      }

      const comment = formatXlibComment({ step: stepCounter, alts: xlibAlts, prefix });

      // Append inline — use two-space gap before the comment token.
      const separator = '  ';
      result.push(line + separator + comment);
      linesTagged += 1;
    } else {
      result.push(line);
    }
  }

  return {
    content: result.join('\n'),
    linesTagged,
  };
}
