/**
 * cli-extract.ts
 *
 * Action handler for `xlibrary extract <file> [options]`.
 *
 * Standalone Test Data Wizard for existing files — detects literal values that
 * can be extracted as variables, shows a diff preview, prompts to confirm, and
 * rewrites the file (with a `.bak` backup).
 *
 * Source is a target-language file (.robot / .spec.ts / .py).
 * Language is inferred from the file extension (reuses `inferLangFromOutput`).
 *
 * Sidecar lookup
 * ──────────────
 * Actions are sourced from a sidecar `.jsonl` file:
 *   - Default: `<source>.jsonl`  (same directory, same name + `.jsonl`)
 *   - Override: `--actions <path>`
 *
 * If no sidecar is found, an actionable error is shown pointing at
 * `--save-actions` and `--actions <file>`.
 *
 * CLI surface (registered in cli.ts):
 *   xlibrary extract <file>
 *     -o, --output <file>        Write to this path (default: in-place with .bak)
 *     --yes                      Skip confirmation prompt
 *     -l, --lang <target>        Override language inference from extension
 *     --actions <jsonl-path>     Override sidecar .jsonl lookup
 */

import type { LangTarget } from './types.js';
import { orchestrateExtraction } from './wizard/extract-orchestrator.js';
import { VALID_LANG_TARGETS } from './codegen/lang-inference.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractOptions {
  /** Path to the source file to extract variables from. */
  file: string;
  /**
   * Output file path.
   * When omitted, edits the source file in-place (with a `.bak` backup).
   */
  output?: string;
  /** Skip the interactive confirm prompt and apply immediately. */
  yes?: boolean;
  /**
   * Language target override.
   * When omitted, inferred from the source file extension.
   */
  lang?: string;
  /**
   * Path to the `.jsonl` actions sidecar.
   * When omitted, looks for `<file>.jsonl` next to the source file.
   */
  actionsFile?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate the --lang flag value.
 *
 * Returns the `LangTarget` if valid.
 * Calls `process.exit(1)` with a clear message if invalid.
 */
function validateLangFlag(lang: string): LangTarget {
  if ((VALID_LANG_TARGETS as readonly string[]).includes(lang)) {
    return lang as LangTarget;
  }
  console.error(
    `xlibrary extract: invalid --lang value "${lang}". ` +
      `Must be one of: ${VALID_LANG_TARGETS.join(' | ')}.`,
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main extract handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the Test Data Wizard for an existing source file.
 *
 * Reads the recorded actions from the sidecar `.jsonl`, detects extractable
 * variables, shows a diff preview, prompts the user to confirm (skipped with
 * `--yes`), and writes the updated file.
 *
 * Throws on any hard error (the CLI wrapper in cli.ts catches and formats).
 *
 * @param options  Resolved CLI options for `xlibrary extract`.
 */
export async function runExtract(options: ExtractOptions): Promise<void> {
  const { file, output, yes = false, actionsFile } = options;

  // Validate --lang if provided
  const lang = options.lang !== undefined ? validateLangFlag(options.lang) : undefined;

  await orchestrateExtraction({
    sourceFile: file,
    output,
    yes,
    lang,
    actionsFile,
    // actions: undefined → orchestrator will look up the sidecar file
  });
}
