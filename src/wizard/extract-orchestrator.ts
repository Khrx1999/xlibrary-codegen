/**
 * wizard/extract-orchestrator.ts
 *
 * Shared orchestration logic for the Test Data Wizard.
 *
 * Two entry points feed into this module:
 *   1. `xlibrary extract <file>` standalone subcommand — reads a source file + sidecar
 *      `.jsonl`, detects variables, shows diff preview, prompts to confirm, applies.
 *   2. `xlibrary codegen ... --extract-data` — called from runner.ts post-record;
 *      uses the in-memory `latestActions` instead of a sidecar file.
 *
 * Task #14 injection point
 * ────────────────────────
 * `VariableEmitter` is the strategy interface Task #14 must implement.
 * Concrete emitters for robot / selenium / ts / python each implement
 * `applyExtraction()`. This module ships a no-op stub until Task #14 lands;
 * only `getEmitterForLang()` changes when #14 merges.
 *
 * Diff preview
 * ─────────────
 * Uses chalk for colour when chalk is available.  The preview is printed to
 * stdout before the confirm prompt; skipped entirely when `--yes` is passed.
 */

import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { detectVariables } from './detector.js';
import type { DetectionResult, ExtractedVariable } from './detector.js';
import type { ActionInContext, LangTarget } from '../types.js';
import { inferLangFromOutput } from '../codegen/lang-inference.js';
import { parseJsonlContent, jsonlEntryToActionInContext } from '../recorder/jsonl-bridge.js';
import { getEmitterForLang } from './emitters/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Task #14 injection point — VariableEmitter strategy interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strategy interface for per-language variable section emit.
 *
 * Task #14 implements concrete strategies for robot / selenium / ts / python.
 * Each implementation must:
 *   1. Parse the source content to find the appropriate variable block location.
 *   2. Insert / extend the variables section with the detected variables.
 *   3. Replace each literal occurrence (identified by `result.substitutions`)
 *      with the corresponding Robot Framework / TS / Python variable reference.
 *   4. Return the fully rewritten content (does NOT write to disk — the
 *      orchestrator owns file I/O).
 */
export interface VariableEmitter {
  /**
   * Apply a DetectionResult to a source file's content and return the rewritten content.
   *
   * @param sourceContent - The full text of the source file before extraction.
   * @param result        - Detection output from `detectVariables()`.
   * @returns The rewritten content with variables inserted + literals replaced.
   *
   * Must NOT throw on empty `result.variables` — return `sourceContent` unchanged.
   */
  applyExtraction(sourceContent: string, result: DetectionResult): string;
}

/**
 * Return the VariableEmitter for the given language target.
 *
 * Task #14 implements the concrete emitters in `./emitters/`.
 * This re-exports the factory so callers don't need to know about the
 * internal emitter module layout.
 */
export { getEmitterForLang } from './emitters/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Diff preview renderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal diff preview string for the detected variables.
 *
 * Shows each detected variable and a `+ ${VAR_NAME}    value` line in the
 * diff section — does NOT attempt to generate a real unified diff, since the
 * full substitution is Task #14's responsibility.
 */
function buildDiffPreview(variables: ExtractedVariable[], chalk: ChalkLike): string {
  const lines: string[] = [];

  // ── Header: variable list ─────────────────────────────────────────────────
  const bar = chalk.dim('─'.repeat(42));
  lines.push(
    chalk.bold(
      `${bar} Detected ${variables.length} variable${variables.length === 1 ? '' : 's'} ${bar}`,
    ),
  );

  for (const v of variables) {
    const nameField = `\${${v.name}}`.padEnd(24);
    const valueField = `"${v.value}"`;
    const siteLabel = v.occurrences === 1 ? '(1 site)' : `(${v.occurrences} sites)`;
    lines.push(
      `  ${chalk.cyan(nameField)} = ${chalk.yellow(valueField.padEnd(24))} ${chalk.dim(siteLabel)}`,
    );
  }

  lines.push('');

  // ── Diff preview: the *** Variables *** section that will be inserted ─────
  lines.push(chalk.bold(`${bar} Diff preview ${bar}`));
  lines.push(chalk.dim('  *** Variables ***'));
  for (const v of variables) {
    const namePart = `\${${v.name}}`.padEnd(24);
    lines.push(chalk.green(`+ ${namePart}    ${v.value}`));
  }
  lines.push(chalk.dim('  ...'));

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal chalk-compatible interface (avoid hard dependency on chalk)
// ─────────────────────────────────────────────────────────────────────────────

interface ChalkLike {
  bold(text: string): string;
  dim(text: string): string;
  green(text: string): string;
  cyan(text: string): string;
  yellow(text: string): string;
}

/**
 * Load chalk dynamically; fall back to a plain-text stub when unavailable.
 */
async function loadChalk(): Promise<ChalkLike> {
  try {
    const mod = await import('chalk');
    const chalk = (mod.default ?? mod) as unknown as ChalkLike;
    // Verify it's usable
    if (typeof chalk.bold === 'function') {
      return chalk;
    }
  } catch {
    // chalk not installed — plain text is fine
  }
  // Plain-text fallback
  const id = (s: string): string => s;
  return { bold: id, dim: id, green: id, cyan: id, yellow: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive confirm prompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask the user "Apply? [Y/n]" and return their answer.
 *
 * Returns `true` for Enter / Y / y, `false` for n / N / anything else.
 */
async function confirmPrompt(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question('Apply? [Y/n] ', (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed === 'y');
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// In-place edit with .bak backup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write `newContent` to `filePath`, first copying the original to `filePath.bak`.
 * Consistent with `xlibrary patch` backup behaviour (spec §3.5).
 */
async function writeWithBackup(filePath: string, newContent: string): Promise<void> {
  await copyFile(filePath, `${filePath}.bak`);
  await writeFile(filePath, newContent, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Read actions from a sidecar .jsonl file
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and parse recorded actions from a sidecar `.jsonl` file.
 *
 * The sidecar MUST be an xlibrary artifact (line 0 = xlibrary header).
 * Throws with a user-friendly message when the sidecar is missing or invalid.
 *
 * @param sidecarPath - Absolute or relative path to the `.jsonl` sidecar.
 * @returns Ordered array of reconstructed `ActionInContext` objects.
 */
async function loadActionsFromSidecar(sidecarPath: string): Promise<ActionInContext[]> {
  if (!existsSync(sidecarPath)) {
    throw new Error(
      `extract requires a sidecar .jsonl — not found: ${sidecarPath}\n` +
        'Re-record with --save-actions, or pass --actions <file>.',
    );
  }

  const content = await readFile(sidecarPath, 'utf8');

  // parseJsonlContent skips line 0 (the xlibrary header) and parses action lines.
  const entries = parseJsonlContent(content);

  const actions: ActionInContext[] = [];
  for (const entry of entries) {
    const action = jsonlEntryToActionInContext(entry);
    if (action !== undefined) {
      actions.push(action);
    }
  }

  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core orchestration
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  /** Path to the source file to extract variables into. */
  sourceFile: string;
  /** Pre-loaded actions (used by the --extract-data post-record hook). */
  actions?: ActionInContext[];
  /**
   * Explicit path to the `.jsonl` sidecar. When undefined, the orchestrator
   * looks for `<sourceFile>.jsonl` next to the source file.
   */
  actionsFile?: string;
  /** Language target; inferred from `sourceFile` extension when omitted. */
  lang?: LangTarget;
  /**
   * Output file path. When undefined, edits the source file in-place (with .bak).
   * When provided, writes to this path (no .bak, no modification of sourceFile).
   */
  output?: string;
  /** Skip the interactive confirm prompt and apply immediately. */
  yes?: boolean;
  /**
   * Injected VariableEmitter — used by tests to capture the DetectionResult
   * without depending on Task #14 implementations.
   *
   * When omitted, `getEmitterForLang(lang)` is called (the default stub).
   * Task #14 injects real emitters here; production callers never set this.
   *
   * @internal — not part of the public CLI surface.
   */
  _emitter?: VariableEmitter;
  /**
   * Injected confirm function — used by tests to avoid the interactive readline
   * prompt. When omitted, `confirmPrompt()` is called.
   *
   * @internal — not part of the public CLI surface.
   */
  _confirmFn?: () => Promise<boolean>;
}

/**
 * Full extraction orchestration: detect → preview → confirm → apply.
 *
 * Shared by both:
 *   - `xlibrary extract <file>` via `runExtract()` in cli-extract.ts
 *   - `xlibrary codegen --extract-data` via `runExtractionOnActions()` in runner.ts
 *
 * @returns `true` when changes were applied, `false` when the user declined.
 */
export async function orchestrateExtraction(options: OrchestratorOptions): Promise<boolean> {
  const { sourceFile, yes = false, _emitter, _confirmFn } = options;

  // ── 1. Resolve language ───────────────────────────────────────────────────
  const lang = options.lang ?? inferLangFromOutput(sourceFile);

  // ── 2. Load source content ────────────────────────────────────────────────
  let sourceContent: string;
  try {
    sourceContent = await readFile(sourceFile, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `extract-orchestrator: source file not found — path: ${sourceFile}\n` +
          'Check the file path and try again.',
      );
    }
    throw new Error(
      `extract-orchestrator: could not read ${sourceFile} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── 3. Load actions ───────────────────────────────────────────────────────
  let actions: ActionInContext[];

  if (options.actions !== undefined && options.actions.length > 0) {
    // Pre-loaded (from --extract-data post-record hook)
    actions = options.actions;
  } else {
    // Load from sidecar .jsonl
    const sidecarPath = options.actionsFile ?? `${sourceFile}.jsonl`;
    actions = await loadActionsFromSidecar(sidecarPath);
  }

  // ── 4. Detect variables ───────────────────────────────────────────────────
  const result = detectVariables(actions);

  if (result.variables.length === 0) {
    console.log('\n  [wizard] No extractable variables detected in the recorded actions.');
    return false;
  }

  // ── 5. Diff preview ───────────────────────────────────────────────────────
  if (!yes) {
    const chalk = await loadChalk();
    const preview = buildDiffPreview(result.variables, chalk);
    console.log('\n' + preview + '\n');
  }

  // ── 6. Confirm ───────────────────────────────────────────────────────────
  const doConfirm = _confirmFn ?? confirmPrompt;
  const shouldApply = yes ? true : await doConfirm();

  if (!shouldApply) {
    console.log('  Aborted — no changes written.');
    return false;
  }

  // ── 7. Apply via VariableEmitter (Task #14 plug-in point) ─────────────────
  const emitter = _emitter ?? getEmitterForLang(lang);
  const newContent = emitter.applyExtraction(sourceContent, result);

  // ── 8. Write ──────────────────────────────────────────────────────────────
  const destPath = options.output ?? sourceFile;
  const isInPlace = destPath === sourceFile;

  if (isInPlace) {
    await writeWithBackup(destPath, newContent);
    console.log(`  Saved: ${destPath}  (original backed up to ${destPath}.bak)`);
  } else {
    await writeFile(destPath, newContent, 'utf8');
    console.log(`  Saved: ${destPath}`);
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point for the post-record hook (runner.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface PostRecordOptions {
  /** The `.robot` file that was just written. */
  sourceFile: string;
  /** Actions captured during the recording session. */
  actions: ActionInContext[];
  /**
   * When `true`, skip the interactive confirm prompt and apply immediately.
   * Runner.ts passes `quiet` here — --quiet implies non-interactive.
   */
  yes?: boolean;
}

/**
 * Post-record extraction entry point called from `runner.ts` when
 * `--extract-data` is set.
 *
 * Wraps `orchestrateExtraction()` with pre-loaded actions so no sidecar
 * file lookup is needed.
 */
export async function runExtractionOnActions(options: PostRecordOptions): Promise<void> {
  await orchestrateExtraction({
    sourceFile: options.sourceFile,
    actions: options.actions,
    yes: options.yes,
    // output: undefined → in-place edit
  });
}
