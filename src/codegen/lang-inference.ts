/**
 * Language target inference for the -l/--lang CLI flag.
 *
 * Pure functions — no I/O, no Commander, no side effects — so they can be
 * unit-tested without importing cli.ts (which has Commander/process.exit side
 * effects at module level).
 *
 * Used by:
 *   - src/cli.ts  (codegen subcommand action)
 *   - tests/cli-lang.test.ts (unit tests)
 */

import type { LangTarget } from '../types.js';

/** Valid values accepted by `-l/--lang`. */
export const VALID_LANG_TARGETS: readonly LangTarget[] = ['robot', 'selenium', 'ts', 'python'];

/**
 * Infer the emitter target from an output file's extension.
 *
 * Extension priority (longest-suffix wins, checked first):
 *   .selenium.robot  → 'selenium'
 *   .spec.ts         → 'ts'
 *   .robot           → 'robot'
 *   .ts              → 'ts'
 *   .py              → 'python'
 *   (anything else)  → 'robot'  (default)
 *
 * This function is pure — no process.exit, no console output.
 */
export function inferLangFromOutput(outputPath: string | undefined): LangTarget {
  if (!outputPath) return 'robot';

  // Normalise to lowercase for case-insensitive matching; keep the full path
  // so multi-segment suffixes like ".selenium.robot" are detectable.
  const lower = outputPath.toLowerCase();

  if (lower.endsWith('.selenium.robot')) return 'selenium';
  if (lower.endsWith('.spec.ts')) return 'ts';
  if (lower.endsWith('.robot')) return 'robot';
  if (lower.endsWith('.ts')) return 'ts';
  if (lower.endsWith('.py')) return 'python';

  // Unknown extension — default to robot.
  return 'robot';
}

/**
 * Resolve the final `lang` value from the CLI flag and the output path.
 *
 * Rules:
 *   1. Explicit `-l <target>` always wins.
 *   2. If `-l` was given AND disagrees with what the extension implies, emit a
 *      warning to stderr (but proceed with the explicit flag).
 *   3. If no `-l` flag, infer from the output extension.
 *
 * Side effects:
 *   - Writes to `console.warn` on a mismatch.
 *   - Writes to `console.error` + calls `process.exit(1)` for an invalid flag value.
 *
 * Returns the resolved `LangTarget`.
 */
export function resolveLang(
  langFlag: string | undefined,
  outputPath: string | undefined,
): LangTarget {
  const fromExtension = inferLangFromOutput(outputPath);

  if (langFlag !== undefined) {
    // Validate the explicit value upfront so we give a clear error message.
    if (!(VALID_LANG_TARGETS as readonly string[]).includes(langFlag)) {
      console.error(
        `xlibrary: invalid --lang value "${langFlag}". ` +
          `Must be one of: ${VALID_LANG_TARGETS.join(' | ')}.`,
      );
      process.exit(1);
    }

    const explicit = langFlag as LangTarget;

    // Warn when explicit flag and file extension disagree.
    if (outputPath && explicit !== fromExtension) {
      console.warn(
        `xlibrary: warning — -l ${explicit} conflicts with the extension of "${outputPath}" ` +
          `(which implies "${fromExtension}"). Proceeding with -l ${explicit}.`,
      );
    }

    return explicit;
  }

  return fromExtension;
}
