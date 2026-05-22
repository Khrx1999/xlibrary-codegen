/**
 * xlib-comment.ts
 *
 * Pure helper: format and parse `# xlib:step=N;alts=[...]` inline comments.
 *
 * These comments are emitted after every recorded step in all 4 language
 * emitters (Robot Framework, SeleniumLibrary, TypeScript/Playwright-test,
 * Python/pytest).  They are the hook that Task #9's self-healing patch parser
 * uses to look up alternative selectors at replay time.
 *
 * Grammar (per ADR-0002):
 *
 *   # xlib:step=5
 *   # xlib:step=5;alts=["data-testid=login","[aria-label='Sign in']"]
 *
 * Rules:
 *   - ALWAYS emit `xlib:step=N` — even when there are no alternatives.
 *   - `alts=[...]` is appended only when there are >= 1 alternative selectors.
 *   - The `alts` array is JSON-parseable: double-quoted strings, escaped as
 *     needed by JSON.stringify.
 *   - Top-3 alternatives ONLY (caller is responsible for pre-ranking and slicing).
 *   - Comment prefix per language:
 *       `#`  for Robot Framework, SeleniumLibrary, Python
 *       `//` for TypeScript
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface XlibCommentOptions {
  /** 1-indexed step counter (monotonic within the file). */
  step: number;
  /**
   * Pre-ranked alternative selectors (top-3 max, primary excluded).
   * Omit or pass [] to emit only the `xlib:step=N` marker.
   */
  alts?: string[];
  /**
   * Comment prefix character(s).
   * Defaults to '#' (Robot Framework / Python / SeleniumLibrary).
   * Pass '//' for TypeScript output.
   */
  prefix?: '#' | '//';
}

export interface ParsedXlibComment {
  step: number;
  /** Present only when the comment contained an `alts=[...]` clause. */
  alts?: string[];
}

// ---------------------------------------------------------------------------
// formatXlibComment
// ---------------------------------------------------------------------------

/**
 * Format a single `xlib:step=N` or `xlib:step=N;alts=[...]` comment string.
 *
 * The returned string does NOT include surrounding whitespace — the caller
 * is responsible for adding leading spaces (e.g. the 4-space indent inside
 * a Robot Framework test case body).
 *
 * @example
 *   formatXlibComment({ step: 3 })
 *   // => '# xlib:step=3'
 *
 *   formatXlibComment({ step: 5, alts: ['#id', '[data-testid="x"]'] })
 *   // => '# xlib:step=5;alts=["#id","[data-testid=\\"x\\"]"]'
 *
 *   formatXlibComment({ step: 2, prefix: '//' })
 *   // => '// xlib:step=2'
 */
export function formatXlibComment(options: XlibCommentOptions): string {
  const { step, alts, prefix = '#' } = options;

  if (alts && alts.length > 0) {
    const altsJson = JSON.stringify(alts);
    return `${prefix} xlib:step=${step};alts=${altsJson}`;
  }

  return `${prefix} xlib:step=${step}`;
}

// ---------------------------------------------------------------------------
// parseXlibComment
// ---------------------------------------------------------------------------

/**
 * Parse a `xlib:step=N` or `xlib:step=N;alts=[...]` comment from a source line.
 *
 * Accepts both '#' and '//' prefixes.  The line may have leading whitespace.
 * Unrecognised lines return null.
 *
 * @example
 *   parseXlibComment('    # xlib:step=3')
 *   // => { step: 3 }
 *
 *   parseXlibComment('    # xlib:step=5;alts=["#id","[aria-label=\'x\']"]')
 *   // => { step: 5, alts: ['#id', "[aria-label='x']"] }
 *
 *   parseXlibComment('    Click    css=#btn')
 *   // => null
 */
export function parseXlibComment(line: string): ParsedXlibComment | null {
  // Strip leading whitespace, then match either # or // prefix
  const trimmed = line.trimStart();

  // Must start with the comment marker followed by ' xlib:'
  const markerMatch = /^(?:#|\/\/)\s+xlib:(.+)$/.exec(trimmed);
  if (!markerMatch) return null;

  const payload = markerMatch[1]; // e.g. 'step=3' or 'step=5;alts=[...]'

  // Extract step number — must be a sequence of digits immediately followed
  // by either end-of-string or a semicolon (not a decimal point or letter).
  const stepMatch = /^step=(\d+)(?:;|$)/.exec(payload);
  if (!stepMatch) return null;

  const step = parseInt(stepMatch[1], 10);
  if (!Number.isFinite(step) || step < 1) return null;

  // Detect any ;alts= clause — even if malformed. If it exists but is invalid,
  // we return null rather than silently ignoring the corruption.
  const hasAltsClause = payload.includes(';alts=');

  if (!hasAltsClause) {
    return { step };
  }

  // Extract alts value — must start with '[' (JSON array)
  const altsMatch = /;alts=(\[.+\])$/.exec(payload);
  if (!altsMatch) {
    // ;alts= present but not a JSON array literal → malformed
    return null;
  }

  let alts: string[];
  try {
    const parsed: unknown = JSON.parse(altsMatch[1]);
    if (!Array.isArray(parsed)) return null;
    // All elements must be strings
    if (!parsed.every((item): item is string => typeof item === 'string')) return null;
    alts = parsed;
  } catch {
    return null;
  }

  return { step, alts };
}
