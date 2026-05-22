/**
 * operations.ts — Pure editing operations for `xlibrary patch`.
 *
 * Every exported function takes a `sourceContent` string + `StepIndex`
 * (already parsed by step-parser.ts) and returns a NEW string with the
 * requested mutation applied.  No file I/O happens here; the caller
 * (cli-patch.ts) is responsible for reading and writing the file,
 * writing the .bak, and doing the atomic rename.
 *
 * ## NewStepProvider
 *
 * Operations that insert or replace steps accept an async
 * `NewStepProvider` callback.  For Task #10 (text-level only) the CLI
 * passes a STUB that returns a fixed placeholder string — real
 * recorder-driven content is wired by Task #11.
 *
 * ## Renumbering
 *
 * After every mutation, `renumberSteps()` walks the returned content and
 * rewrites every `xlib:step=N` comment so the numbers are contiguous
 * starting at 1 and match source order.  Any `alts=[...]` payload is
 * preserved verbatim.
 *
 * ## Contract with step-parser.ts
 *
 * `StepIndex` is produced by `parseSteps()` from the ORIGINAL source.
 * After a mutation the index is stale — callers should re-parse if they
 * need to chain multiple operations.  For single-operation CLI usage
 * (one flag per invocation), the stale index is never re-used.
 */

import type { StepIndex, ParsedStep } from './step-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Language of the source file, inferred from the file extension by the caller. */
export type SourceLang = 'robot' | 'selenium' | 'ts' | 'python';

/**
 * Callback for operations that need new step content (replace, insert).
 *
 * Returns a string that may span multiple lines.  For Robot Framework /
 * SeleniumLibrary output the string must already contain the 4-space
 * indentation and the trailing `# xlib:step=N` marker.  For TS / Python
 * the indentation and `// xlib:step=N` (or `# xlib:step=N`) comment
 * must also be present.
 *
 * The `targetStep` field carries the FINAL step number of the first
 * inserted step after renumbering (so Task #11 can name it correctly in
 * the recorder window title).
 *
 * Task #11 implementations will:
 *   1. Replay the test up to the target step using the replay-engine.
 *   2. Open the recorder window for the user to record the new step(s).
 *   3. Format the result as a string matching the source language.
 *   4. Return it via this callback.
 *
 * For Task #10's stand-alone testability:
 *   - Use a stub that returns a fixed placeholder.
 *   - This lets unit-tests verify splice logic without spawning a browser.
 */
export type NewStepProvider = (context: {
  sourceLang: SourceLang;
  targetStep: number;
  operation: 'replace' | 'insert-after' | 'insert-before';
}) => Promise<string>;

/**
 * Stub `NewStepProvider` for Task #10 unit tests and for the synchronous
 * path in `cli-patch.ts` (before Task #11 is wired).
 *
 * Returns a language-appropriate placeholder comment that, once inserted
 * into the file, keeps the xlib marker format valid for downstream tools.
 */
export function stubNewStepProvider(context: {
  sourceLang: SourceLang;
  targetStep: number;
  operation: 'replace' | 'insert-after' | 'insert-before';
}): string {
  const commentPrefix = context.sourceLang === 'ts' ? '//' : '#';
  // The caller will renumber markers after splicing, so using step=0 is
  // safe here — renumberSteps() will overwrite it.
  return (
    `    ${commentPrefix} NEW STEP via xlib patch — Task #11 wires this\n` +
    `    ${commentPrefix} xlib:step=0`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// renumberSteps — re-number all xlib:step=N comments in order
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk `content` and rewrite every `xlib:step=N` comment so the markers
 * are numbered contiguously (1, 2, 3, …) in the order they appear in the
 * source.
 *
 * The regex accepts both `#` and `//` comment prefixes and handles optional
 * leading whitespace.  Any `;alts=[...]` payload after the step number is
 * preserved verbatim.
 *
 * This must be called after EVERY mutation so the resulting file is always
 * in a clean state.
 *
 * @param content  Full file text (may contain stale / gap / duplicate step numbers).
 * @returns  New file text with contiguous 1-based step numbers.
 */
export function renumberSteps(content: string): string {
  let counter = 0;
  return content.replace(
    /([ \t]*(?:#|\/\/)\s+xlib:step=)\d+(.*)/g,
    (_match, prefix: string, suffix: string) => {
      counter += 1;
      return `${prefix}${counter}${suffix}`;
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal line-splice helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split content into a lines array that preserves the final newline state.
 *
 * All mutation helpers work on `string[]` then re-join with `\n`.
 * The original terminal newline (present or absent) is preserved.
 */
function splitLines(content: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  // When the file ends with \n, split() adds a synthetic empty last element;
  // drop it so every other element represents a real line.
  if (trailingNewline && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return { lines, trailingNewline };
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  const joined = lines.join('\n');
  return trailingNewline ? joined + '\n' : joined;
}

// ─────────────────────────────────────────────────────────────────────────────
// replaceStep — replace keyword line + marker with new content
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace the keyword line + marker for step `targetStepNum` with
 * `newContent` (as returned by a `NewStepProvider`).
 *
 * `newContent` may be multi-line.  It replaces exactly the range
 * [keywordLineIdx, markerLineIdx] inclusive.
 *
 * After splicing, the markers are renumbered contiguously.
 *
 * @param sourceContent  Original file text.
 * @param index          StepIndex from parseSteps(sourceContent).
 * @param targetStepNum  1-based step number to replace.
 * @param newContent     Replacement text (returned by NewStepProvider stub/real).
 * @returns  Rewritten file text.
 * @throws   If `targetStepNum` is not found in the index.
 */
export function replaceStep(
  sourceContent: string,
  index: StepIndex,
  targetStepNum: number,
  newContent: string,
): string {
  const step = requireStep(index, targetStepNum);
  const { lines, trailingNewline } = splitLines(sourceContent);

  const before = lines.slice(0, step.keywordLineIdx);
  const after = lines.slice(step.markerLineIdx + 1);
  const newLines = newContent.split('\n');

  const result = joinLines([...before, ...newLines, ...after], trailingNewline);
  return renumberSteps(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// replaceRange — replace steps N–M with new content
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace the block of steps from `fromStepNum` to `toStepNum` (inclusive)
 * with `newContent` (a single `NewStepProvider` call).
 *
 * Removal spans from the keyword line of `fromStepNum` to the marker line
 * of `toStepNum` inclusive.
 *
 * @throws  If either step number is not found, or if from > to.
 */
export function replaceRange(
  sourceContent: string,
  index: StepIndex,
  fromStepNum: number,
  toStepNum: number,
  newContent: string,
): string {
  if (fromStepNum > toStepNum) {
    throw new RangeError(`replaceRange: from step ${fromStepNum} must be <= to step ${toStepNum}`);
  }
  const fromStep = requireStep(index, fromStepNum);
  const toStep = requireStep(index, toStepNum);

  const { lines, trailingNewline } = splitLines(sourceContent);

  const before = lines.slice(0, fromStep.keywordLineIdx);
  const after = lines.slice(toStep.markerLineIdx + 1);
  const newLines = newContent.split('\n');

  const result = joinLines([...before, ...newLines, ...after], trailingNewline);
  return renumberSteps(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// insertAfter — insert new content after step N's marker line
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert `newContent` immediately AFTER step `afterStepNum`'s marker line.
 *
 * The existing step is unchanged; subsequent steps are renumbered.
 *
 * @throws  If `afterStepNum` is not found.
 */
export function insertAfter(
  sourceContent: string,
  index: StepIndex,
  afterStepNum: number,
  newContent: string,
): string {
  const step = requireStep(index, afterStepNum);
  const { lines, trailingNewline } = splitLines(sourceContent);

  const before = lines.slice(0, step.markerLineIdx + 1);
  const after = lines.slice(step.markerLineIdx + 1);
  const newLines = newContent.split('\n');

  const result = joinLines([...before, ...newLines, ...after], trailingNewline);
  return renumberSteps(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// insertBefore — insert new content before step N's keyword line
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert `newContent` immediately BEFORE step `beforeStepNum`'s keyword line.
 *
 * The existing step is unchanged; it and all subsequent steps are renumbered.
 *
 * @throws  If `beforeStepNum` is not found.
 */
export function insertBefore(
  sourceContent: string,
  index: StepIndex,
  beforeStepNum: number,
  newContent: string,
): string {
  const step = requireStep(index, beforeStepNum);
  const { lines, trailingNewline } = splitLines(sourceContent);

  const before = lines.slice(0, step.keywordLineIdx);
  const after = lines.slice(step.keywordLineIdx);
  const newLines = newContent.split('\n');

  const result = joinLines([...before, ...newLines, ...after], trailingNewline);
  return renumberSteps(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteStep — remove keyword line + marker, renumber
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove step `targetStepNum` (keyword line + marker) from the source.
 *
 * Subsequent step markers are renumbered.
 *
 * Edge case — deleting the only step: the file remains valid (the
 * `*** Test Cases ***` body may become empty, which is legal Robot syntax).
 *
 * @throws  If `targetStepNum` is not found.
 */
export function deleteStep(sourceContent: string, index: StepIndex, targetStepNum: number): string {
  const step = requireStep(index, targetStepNum);
  const { lines, trailingNewline } = splitLines(sourceContent);

  const before = lines.slice(0, step.keywordLineIdx);
  const after = lines.slice(step.markerLineIdx + 1);

  const result = joinLines([...before, ...after], trailingNewline);
  return renumberSteps(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteRange — remove steps N–M, renumber
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove steps `fromStepNum` through `toStepNum` (inclusive).
 *
 * Spans from the keyword line of `fromStepNum` to the marker line of
 * `toStepNum` — everything in between is deleted.
 *
 * @throws  If either step number is not found, or if from > to.
 */
export function deleteRange(
  sourceContent: string,
  index: StepIndex,
  fromStepNum: number,
  toStepNum: number,
): string {
  if (fromStepNum > toStepNum) {
    throw new RangeError(`deleteRange: from step ${fromStepNum} must be <= to step ${toStepNum}`);
  }
  const fromStep = requireStep(index, fromStepNum);
  const toStep = requireStep(index, toStepNum);

  const { lines, trailingNewline } = splitLines(sourceContent);

  const before = lines.slice(0, fromStep.keywordLineIdx);
  const after = lines.slice(toStep.markerLineIdx + 1);

  const result = joinLines([...before, ...after], trailingNewline);
  return renumberSteps(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// moveStep — cut step X, insert after step Y, renumber
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move step `fromStepNum` so it appears immediately after step `toStepNum`.
 *
 * Algorithm:
 *   1. Extract the keyword + marker lines of the source step (verbatim text).
 *   2. Delete the source step from the lines array.
 *   3. Find the NEW position of `toStepNum`'s marker in the modified array
 *      (its position has shifted if the source step was before it).
 *   4. Insert the extracted lines after that marker.
 *   5. Renumber.
 *
 * Edge cases:
 *   - `fromStepNum === toStepNum`: no-op (returns original content after
 *     renumbering, which is idempotent).
 *   - `toStepNum === 0`: insert BEFORE the first step (insert-at-top).
 *
 * @throws  If either step number is not found in the index (except toStepNum=0).
 */
export function moveStep(
  sourceContent: string,
  index: StepIndex,
  fromStepNum: number,
  toStepNum: number,
): string {
  // No-op: moving a step to itself is valid but meaningless.
  if (fromStepNum === toStepNum) {
    return renumberSteps(sourceContent);
  }

  const fromStep = requireStep(index, fromStepNum);

  const { lines, trailingNewline } = splitLines(sourceContent);

  // Extract the lines of the step we are moving (keyword + marker).
  const extractedLines = lines.slice(fromStep.keywordLineIdx, fromStep.markerLineIdx + 1);

  // Remove those lines from the array.
  const withoutStep = [
    ...lines.slice(0, fromStep.keywordLineIdx),
    ...lines.slice(fromStep.markerLineIdx + 1),
  ];

  // Special case: toStepNum === 0 means insert before any step (head of the
  // test body).  Find the keyword line of the current first step in the
  // modified array.
  if (toStepNum === 0) {
    // Find where the first xlib:step= marker is now, then find its keyword.
    const firstMarkerIdx = withoutStep.findIndex((l) => /(?:#|\/\/)\s+xlib:step=\d+/.test(l));
    if (firstMarkerIdx === -1) {
      // No markers left — just prepend.
      const result = joinLines([...extractedLines, ...withoutStep], trailingNewline);
      return renumberSteps(result);
    }
    // Walk back to find the keyword line of the first remaining step.
    const firstKeywordIdx = findPrecedingKeywordIdx(withoutStep, firstMarkerIdx);
    const before = withoutStep.slice(0, firstKeywordIdx);
    const after = withoutStep.slice(firstKeywordIdx);
    const result = joinLines([...before, ...extractedLines, ...after], trailingNewline);
    return renumberSteps(result);
  }

  // Normal case: find the target step's marker in the modified lines array.
  // We need to locate toStep's marker line in the withoutStep array.
  // The toStep's marker content (raw line text) tells us exactly which line.
  const toStep = requireStep(index, toStepNum);

  // Compute the position of toStep's marker in the modified array.
  // If fromStep was BEFORE toStep, each line's index shifts down by
  // (markerLineIdx - keywordLineIdx + 1) = the number of lines removed.
  const removedLineCount = fromStep.markerLineIdx - fromStep.keywordLineIdx + 1;
  let toMarkerNewIdx: number;
  if (fromStep.markerLineIdx < toStep.markerLineIdx) {
    // from was before to: shift to's index down.
    toMarkerNewIdx = toStep.markerLineIdx - removedLineCount;
  } else {
    // from was after to: no shift needed.
    toMarkerNewIdx = toStep.markerLineIdx;
  }

  const before = withoutStep.slice(0, toMarkerNewIdx + 1);
  const after = withoutStep.slice(toMarkerNewIdx + 1);
  const result = joinLines([...before, ...extractedLines, ...after], trailingNewline);
  return renumberSteps(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// parseRangeSpec — "3-7" → [3, 7]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a range spec like "3-7" into [from, to] tuple.
 *
 * Returns null if the spec is not a valid range string.
 *
 * @example
 *   parseRangeSpec('3-7')  // → [3, 7]
 *   parseRangeSpec('5')    // → null
 *   parseRangeSpec('a-b')  // → null
 */
export function parseRangeSpec(spec: string): [number, number] | null {
  const match = /^(\d+)-(\d+)$/.exec(spec.trim());
  if (!match) return null;
  const from = parseInt(match[1], 10);
  const to = parseInt(match[2], 10);
  if (isNaN(from) || isNaN(to)) return null;
  return [from, to];
}

/**
 * Parse a move spec like "3 to 7" into [from, to] tuple.
 *
 * Returns null if the spec is not a valid move string.
 *
 * @example
 *   parseMoveSpec('3 to 7')  // → [3, 7]
 *   parseMoveSpec('3-7')     // → null
 */
export function parseMoveSpec(spec: string): [number, number] | null {
  const match = /^(\d+)\s+to\s+(\d+)$/i.exec(spec.trim());
  if (!match) return null;
  const from = parseInt(match[1], 10);
  const to = parseInt(match[2], 10);
  if (isNaN(from) || isNaN(to)) return null;
  return [from, to];
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve a ParsedStep by number, throwing a descriptive error if absent.
 */
function requireStep(index: StepIndex, stepNum: number): ParsedStep {
  const step = index.byNumber.get(stepNum);
  if (!step) {
    const total = index.steps.length;
    throw new RangeError(
      `No step ${stepNum} in index (file has ${total} step${total === 1 ? '' : 's'})`,
    );
  }
  return step;
}

/**
 * Walk backwards from `markerIdx - 1` in the given lines array to find
 * the nearest non-blank line that is not itself a marker.
 *
 * Returns the index of that line, or `markerIdx` as a fallback when none
 * is found.
 */
function findPrecedingKeywordIdx(lines: string[], markerIdx: number): number {
  for (let j = markerIdx - 1; j >= 0; j--) {
    const candidate = lines[j] ?? '';
    if (candidate.trim() === '') continue;
    if (/(?:#|\/\/)\s+xlib:step=/.test(candidate)) continue;
    return j;
  }
  return markerIdx;
}
