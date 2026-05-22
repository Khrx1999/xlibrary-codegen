/**
 * cli-patch.ts — handler for `xlibrary patch <file>`
 *
 * Task #9 scaffold:
 *   - Parses all flags defined in §3.1 of docs/v0.2-spec.md
 *   - Runs parseSteps() on the target file
 *   - Resolves --at <id> (numeric OR fuzzy content search)
 *
 * Task #10 (this revision):
 *   - Implements all editing operations: replace, insert-after,
 *     insert-before, delete, delete-range, move, range-replace.
 *   - Writes a .bak backup before any mutation (unless --no-backup).
 *   - Uses atomic write (temp file + rename) to avoid partial writes on
 *     Ctrl+C or OS crash.
 *   - Uses a stub NewStepProvider; Task #11 injects the real one.
 *
 * Why a separate file (not inline in cli.ts)?
 *   vitest instruments process.exit() calls; a handler that calls
 *   process.exit() in the same module as the Commander program causes
 *   test-runner hangs. Keeping the handler in its own file lets tests
 *   import it without pulling in Commander or triggering auto-parse.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  parseSteps,
  findStepsByContent,
  replaceStep,
  replaceRange,
  insertAfter,
  insertBefore,
  deleteStep,
  deleteRange,
  moveStep,
  parseRangeSpec,
  parseMoveSpec,
  stubNewStepProvider,
} from './patch/index.js';
import type { StepIndex, ParsedStep, LangTarget, NewStepProvider } from './patch/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public options type — Commander fills this
// ─────────────────────────────────────────────────────────────────────────────

export interface PatchOptions {
  /** --at <id>: step number (if numeric) or fuzzy content search string. */
  at?: string;
  /** --insert-after <id> */
  insertAfter?: string;
  /** --insert-before <id> */
  insertBefore?: string;
  /** --delete <id|range> e.g. "5" or "3-7" */
  delete?: string;
  /** --move <from> to <to> — stored as "<from> to <to>" by Commander */
  move?: string;
  /** --range <from>-<to>: restrict the operation to a step range */
  range?: string;
  /** --non-interactive: fail-fast instead of pausing on replay failures */
  nonInteractive?: boolean;
  /** --no-backup: skip writing .bak file (Commander stores as `backup: false`) */
  backup?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported handler (called from cli.ts .action())
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entry point for `xlibrary patch <file> [options]`.
 *
 * Returns an exit code (0 = success, 1 = user error).  The caller (cli.ts)
 * is responsible for calling `process.exit(code)` so this function remains
 * testable without triggering the Node process exit.
 */
export async function runPatch(
  file: string,
  opts: PatchOptions,
  provider: NewStepProvider = (ctx) => Promise.resolve(stubNewStepProvider(ctx)),
): Promise<number> {
  // ── Validate: only one operation flag at a time ────────────────────────────
  const operationFlags = [
    opts.at !== undefined ? '--at' : null,
    opts.insertAfter !== undefined ? '--insert-after' : null,
    opts.insertBefore !== undefined ? '--insert-before' : null,
    opts.delete !== undefined ? '--delete' : null,
    opts.move !== undefined ? '--move' : null,
  ].filter((f): f is string => f !== null);

  // Conflict: --at combined with another insert/delete/move is ambiguous.
  // (--at is the TARGET; --range is a modifier, not an operation by itself.)
  const insertMoveDelete = operationFlags.filter((f) => f !== '--at');
  if (operationFlags.includes('--at') && insertMoveDelete.length > 0) {
    console.error(
      `xlibrary patch: conflicting flags — cannot combine --at with ${insertMoveDelete.join(', ')}`,
    );
    console.error(
      '  Use --at only for replace, or use --insert-after/--insert-before/--delete/--move independently.',
    );
    return 1;
  }

  // ── Read the source file ───────────────────────────────────────────────────
  let sourceContent: string;
  try {
    sourceContent = readFileSync(file, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`xlibrary patch: cannot read file "${file}" — ${msg}`);
    return 1;
  }

  // ── Parse step markers ─────────────────────────────────────────────────────
  const index: StepIndex = parseSteps(sourceContent);
  const totalSteps = index.steps.length;

  if (totalSteps === 0) {
    console.error(`xlibrary patch: no xlib:step markers found in "${file}".`);
    console.error('  Re-record the file with xlibrary >= 0.2.0 to embed step markers.');
    return 1;
  }

  // ── No operation specified — list steps and exit ───────────────────────────
  if (
    opts.at === undefined &&
    opts.insertAfter === undefined &&
    opts.insertBefore === undefined &&
    opts.delete === undefined &&
    opts.move === undefined
  ) {
    printStepTable(index);
    console.log(
      `\n(${totalSteps} step${totalSteps === 1 ? '' : 's'} total — pass --at <id> or another operation flag to patch)`,
    );
    return 0;
  }

  // ── Dispatch to the appropriate operation ─────────────────────────────────

  // --delete handles both single steps and ranges differently from other ops.
  if (opts.delete !== undefined) {
    return runDelete(file, opts, sourceContent, index, totalSteps);
  }

  // --move uses its own target resolution.
  if (opts.move !== undefined) {
    return runMove(file, opts, sourceContent, index, totalSteps);
  }

  // For --at, --insert-after, --insert-before we need to resolve a target step.
  const resolveId = opts.at ?? opts.insertAfter ?? opts.insertBefore;
  if (resolveId === undefined) {
    console.error('xlibrary patch: no operation specified.');
    return 1;
  }

  const resolved = resolveTarget(resolveId, index, totalSteps);
  if (resolved.kind === 'error') {
    console.error(`xlibrary patch: ${resolved.message}`);
    return 1;
  }

  if (resolved.kind === 'disambiguation') {
    printDisambiguation(resolveId, resolved.matches);
    return 1;
  }

  const step = resolved.step;
  const sourceLang = inferLang(file);

  if (opts.at !== undefined) {
    // --at: replace (single step or range).
    if (opts.range !== undefined) {
      // --at + --range: replace a range of steps.
      const rangeParsed = parseRangeSpec(opts.range);
      if (!rangeParsed) {
        console.error(
          `xlibrary patch: --range "${opts.range}" is not a valid range (expected "<from>-<to>")`,
        );
        return 1;
      }
      const [rangeFrom, rangeTo] = rangeParsed;
      return await runReplaceRange(
        file,
        opts,
        sourceContent,
        index,
        rangeFrom,
        rangeTo,
        sourceLang,
        provider,
      );
    }
    return await runReplaceStep(file, opts, sourceContent, index, step.step, sourceLang, provider);
  }

  if (opts.insertAfter !== undefined) {
    return await runInsertAfter(file, opts, sourceContent, index, step.step, sourceLang, provider);
  }

  if (opts.insertBefore !== undefined) {
    return await runInsertBefore(file, opts, sourceContent, index, step.step, sourceLang, provider);
  }

  console.error('xlibrary patch: no operation specified.');
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operation runners — each calls the pure operation, writes backup + result
// ─────────────────────────────────────────────────────────────────────────────

async function runReplaceStep(
  file: string,
  opts: PatchOptions,
  sourceContent: string,
  index: StepIndex,
  stepNum: number,
  sourceLang: LangTarget,
  provider: NewStepProvider,
): Promise<number> {
  const newContent = await provider({
    sourceLang,
    targetStep: stepNum,
    operation: 'replace',
  });
  let result: string;
  try {
    result = replaceStep(sourceContent, index, stepNum, newContent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`xlibrary patch: replaceStep failed — ${msg}`);
    return 1;
  }
  return writeResult(file, opts, sourceContent, result, `replace step ${stepNum}`);
}

async function runReplaceRange(
  file: string,
  opts: PatchOptions,
  sourceContent: string,
  index: StepIndex,
  fromNum: number,
  toNum: number,
  sourceLang: LangTarget,
  provider: NewStepProvider,
): Promise<number> {
  const newContent = await provider({
    sourceLang,
    targetStep: fromNum,
    operation: 'replace',
  });
  let result: string;
  try {
    result = replaceRange(sourceContent, index, fromNum, toNum, newContent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`xlibrary patch: replaceRange failed — ${msg}`);
    return 1;
  }
  return writeResult(file, opts, sourceContent, result, `replace steps ${fromNum}–${toNum}`);
}

async function runInsertAfter(
  file: string,
  opts: PatchOptions,
  sourceContent: string,
  index: StepIndex,
  stepNum: number,
  sourceLang: LangTarget,
  provider: NewStepProvider,
): Promise<number> {
  const newContent = await provider({
    sourceLang,
    targetStep: stepNum + 1,
    operation: 'insert-after',
  });
  let result: string;
  try {
    result = insertAfter(sourceContent, index, stepNum, newContent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`xlibrary patch: insertAfter failed — ${msg}`);
    return 1;
  }
  return writeResult(file, opts, sourceContent, result, `insert after step ${stepNum}`);
}

async function runInsertBefore(
  file: string,
  opts: PatchOptions,
  sourceContent: string,
  index: StepIndex,
  stepNum: number,
  sourceLang: LangTarget,
  provider: NewStepProvider,
): Promise<number> {
  const newContent = await provider({
    sourceLang,
    targetStep: stepNum,
    operation: 'insert-before',
  });
  let result: string;
  try {
    result = insertBefore(sourceContent, index, stepNum, newContent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`xlibrary patch: insertBefore failed — ${msg}`);
    return 1;
  }
  return writeResult(file, opts, sourceContent, result, `insert before step ${stepNum}`);
}

function runDelete(
  file: string,
  opts: PatchOptions,
  sourceContent: string,
  index: StepIndex,
  totalSteps: number,
): number {
  const deleteSpec = opts.delete ?? '';
  const rangeParsed = parseRangeSpec(deleteSpec);

  if (rangeParsed) {
    const [fromNum, toNum] = rangeParsed;
    // Validate both endpoints exist.
    if (!index.byNumber.has(fromNum)) {
      console.error(
        `xlibrary patch: no step ${fromNum} in file (file has ${totalSteps} step${totalSteps === 1 ? '' : 's'})`,
      );
      return 1;
    }
    if (!index.byNumber.has(toNum)) {
      console.error(
        `xlibrary patch: no step ${toNum} in file (file has ${totalSteps} step${totalSteps === 1 ? '' : 's'})`,
      );
      return 1;
    }
    if (fromNum > toNum) {
      console.error(`xlibrary patch: --delete range ${fromNum}-${toNum} is invalid (from > to)`);
      return 1;
    }
    let result: string;
    try {
      result = deleteRange(sourceContent, index, fromNum, toNum);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`xlibrary patch: deleteRange failed — ${msg}`);
      return 1;
    }
    return writeResult(file, opts, sourceContent, result, `delete steps ${fromNum}–${toNum}`);
  }

  // Single step delete.
  const asNumber = parseInt(deleteSpec, 10);
  if (isNaN(asNumber) || String(asNumber) !== deleteSpec.trim()) {
    console.error(
      `xlibrary patch: --delete "${deleteSpec}" is not a valid step number or range (expected "<N>" or "<N>-<M>")`,
    );
    return 1;
  }
  if (!index.byNumber.has(asNumber)) {
    console.error(
      `xlibrary patch: no step ${asNumber} in file (file has ${totalSteps} step${totalSteps === 1 ? '' : 's'})`,
    );
    return 1;
  }
  let result: string;
  try {
    result = deleteStep(sourceContent, index, asNumber);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`xlibrary patch: deleteStep failed — ${msg}`);
    return 1;
  }
  return writeResult(file, opts, sourceContent, result, `delete step ${asNumber}`);
}

function runMove(
  file: string,
  opts: PatchOptions,
  sourceContent: string,
  index: StepIndex,
  totalSteps: number,
): number {
  const moveSpec = opts.move ?? '';
  const moveParsed = parseMoveSpec(moveSpec);

  if (!moveParsed) {
    console.error(
      `xlibrary patch: --move "${moveSpec}" is not a valid move spec (expected "<from> to <to>")`,
    );
    return 1;
  }

  const [fromNum, toNum] = moveParsed;

  if (!index.byNumber.has(fromNum)) {
    console.error(
      `xlibrary patch: no step ${fromNum} in file (file has ${totalSteps} step${totalSteps === 1 ? '' : 's'})`,
    );
    return 1;
  }
  if (toNum !== 0 && !index.byNumber.has(toNum)) {
    console.error(
      `xlibrary patch: no step ${toNum} in file (file has ${totalSteps} step${totalSteps === 1 ? '' : 's'})`,
    );
    return 1;
  }

  let result: string;
  try {
    result = moveStep(sourceContent, index, fromNum, toNum);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`xlibrary patch: moveStep failed — ${msg}`);
    return 1;
  }
  return writeResult(
    file,
    opts,
    sourceContent,
    result,
    `move step ${fromNum} to after step ${toNum}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// writeResult — backup + atomic write
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write `newContent` to `file` atomically.
 *
 * Steps:
 *   1. Write backup to `<file>.bak` (unless --no-backup).
 *   2. Write `newContent` to a temp file in the OS tmp dir.
 *   3. Rename temp → `file` (atomic on POSIX; best-effort on Windows).
 *
 * This ensures that a Ctrl+C between step 2 and 3 leaves the original
 * file intact (the temp file is orphaned in /tmp, not a corruption risk).
 */
function writeResult(
  file: string,
  opts: PatchOptions,
  original: string,
  newContent: string,
  operationDesc: string,
): number {
  // ── Backup ──────────────────────────────────────────────────────────────────
  if (opts.backup !== false) {
    const bakPath = `${file}.bak`;
    try {
      writeFileSync(bakPath, original, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`xlibrary patch: cannot write backup "${bakPath}" — ${msg}`);
      return 1;
    }
  }

  // ── Atomic write ─────────────────────────────────────────────────────────
  const token = randomBytes(6).toString('hex');
  const tmpFile = join(tmpdir(), `xlibrary-patch-${token}.tmp`);
  try {
    writeFileSync(tmpFile, newContent, 'utf8');
    renameSync(tmpFile, file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`xlibrary patch: cannot write "${file}" — ${msg}`);
    // Clean up the temp file if rename failed.
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors.
    }
    return 1;
  }

  // ── Success summary ──────────────────────────────────────────────────────
  const backupNote = opts.backup !== false ? ` (backup: ${basename(file)}.bak)` : '';
  console.log(`xlibrary patch: ${operationDesc} — ${basename(file)} updated${backupNote}`);
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Language inference from file extension
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer the source language from the file extension.
 *
 * Mirrors the inference table in docs/v0.2-spec.md §1.2:
 *   .robot (non-selenium) → robot
 *   .selenium.robot       → selenium
 *   .spec.ts / .ts        → ts
 *   .py                   → python
 *   other                 → robot (safe default)
 */
export function inferLang(filePath: string): LangTarget {
  const base = basename(filePath).toLowerCase();
  if (base.endsWith('.selenium.robot')) return 'selenium';
  const ext = extname(base);
  if (ext === '.robot') return 'robot';
  if (ext === '.ts') return 'ts';
  if (ext === '.py') return 'python';
  return 'robot';
}

// ─────────────────────────────────────────────────────────────────────────────
// Target resolution
// ─────────────────────────────────────────────────────────────────────────────

type ResolveResult =
  | { kind: 'found'; step: ParsedStep }
  | { kind: 'disambiguation'; matches: Array<{ step: number; keywordLine: string }> }
  | { kind: 'error'; message: string };

/**
 * Resolve `--at <id>` to a specific `ParsedStep`.
 *
 * Resolution order:
 *   1. If `id` is a pure integer → direct lookup by step number.
 *   2. Otherwise → case-insensitive substring search on keyword lines.
 *      - 0 matches → error.
 *      - 1 match   → found.
 *      - N>1 matches → disambiguation.
 */
function resolveTarget(id: string, index: StepIndex, totalSteps: number): ResolveResult {
  const asNumber = parseInt(id, 10);

  if (!isNaN(asNumber) && String(asNumber) === id.trim()) {
    // Numeric: direct lookup.
    const step = index.byNumber.get(asNumber);
    if (!step) {
      return {
        kind: 'error',
        message: `No step ${asNumber} in file (file has ${totalSteps} step${totalSteps === 1 ? '' : 's'})`,
      };
    }
    return { kind: 'found', step };
  }

  // Fuzzy content search.
  const matches = findStepsByContent(index, id);
  if (matches.length === 0) {
    return {
      kind: 'error',
      message: `No steps matching "${id}" (searched ${totalSteps} step${totalSteps === 1 ? '' : 's'})`,
    };
  }
  if (matches.length === 1) {
    const firstMatch = matches[0];
    if (!firstMatch) {
      return { kind: 'error', message: 'Internal error: matches array empty' };
    }
    const found = index.byNumber.get(firstMatch.step);
    if (!found) {
      return { kind: 'error', message: 'Internal error: fuzzy match not in index' };
    }
    return { kind: 'found', step: found };
  }

  return { kind: 'disambiguation', matches };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Print all steps in a compact numbered table. */
function printStepTable(index: StepIndex): void {
  console.log('Steps in file:');
  for (const s of index.steps) {
    const line = s.keywordLine.trim();
    console.log(`  Step ${String(s.step).padStart(3, ' ')}  ${line}`);
  }
}

/** Print a disambiguation table when the fuzzy query matches multiple steps. */
function printDisambiguation(
  query: string,
  matches: Array<{ step: number; keywordLine: string }>,
): void {
  console.error(
    `xlibrary patch: "${query}" matches ${matches.length} steps — be more specific or use a step number:`,
  );
  console.error('');
  for (const m of matches) {
    console.error(`  Step ${String(m.step).padStart(3, ' ')}  ${m.keywordLine.trim()}`);
  }
  console.error('');
  const firstExample = matches[0];
  if (firstExample) {
    console.error(`  Example: xlibrary patch <file> --at ${firstExample.step}`);
  }
}
