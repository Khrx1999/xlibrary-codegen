/**
 * RobotFormatter — line-accumulator for Robot Framework `.robot` output.
 *
 * Used by every language generator (Browser Library, SeleniumLibrary, …) so
 * indentation and argument-separator widths stay consistent across emitters.
 *
 * Robot Framework parses its source by whitespace:
 *   - Section headers (`*** Settings ***`) start at column 0.
 *   - Test-case names start at column 0.
 *   - Keyword calls inside a test case are indented by ≥ 2 spaces; we use 4 to
 *     match the Robot Framework community convention.
 *   - Arguments are separated from the keyword (and from each other) by
 *     ≥ 2 spaces; we use 4 to match common formatter output.
 */

/** 4-space indent inside a test-case body. */
export const INDENT = '    ';

/** Argument separator between a keyword and its args (≥ 2 spaces required). */
export const ARG_SEP = '    ';

/**
 * Build a `.robot` document line by line.
 *
 * Every `keyword(...)` produces an indented test-case-body line. Undefined or
 * empty-string arguments are filtered out so callers can pass conditional
 * args inline without an explicit `if`. Call `format()` to get the final
 * newline-joined string (no trailing newline — the orchestrator owns that).
 */
export class RobotFormatter {
  private readonly _lines: string[] = [];

  /** `*** Section Name ***` — column 0. */
  section(name: string): this {
    this._lines.push(`*** ${name} ***`);
    return this;
  }

  /** Blank line. */
  blank(): this {
    this._lines.push('');
    return this;
  }

  /** Raw unindented line (e.g. `Library    Browser`, test-case name). */
  raw(line: string): this {
    this._lines.push(line);
    return this;
  }

  /**
   * Keyword call — indented for a test-case body.
   * `undefined` and empty-string args are dropped.
   */
  keyword(kw: string, ...args: (string | undefined)[]): this {
    const parts = [kw, ...args.filter((a): a is string => a !== undefined && a !== '')];
    this._lines.push(INDENT + parts.join(ARG_SEP));
    return this;
  }

  /** `    # comment` — indented for a test-case body. */
  comment(text: string): this {
    this._lines.push(`${INDENT}# ${text}`);
    return this;
  }

  /** Pre-built line — pushed verbatim (used for signal lines, errors). */
  rawLine(line: string): this {
    this._lines.push(line);
    return this;
  }

  /** Join all accumulated lines with `\n`. No trailing newline. */
  format(): string {
    return this._lines.join('\n');
  }
}
