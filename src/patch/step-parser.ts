/**
 * step-parser.ts
 *
 * Cross-language step parser: reads source text from any of the four supported
 * emitter targets (Robot Framework, SeleniumLibrary, Python, TypeScript) and
 * builds a `StepIndex` keyed on `xlib:step=N` marker comments.
 *
 * Language support:
 *   Robot Framework  →  `    Click    css=#btn`\n`    # xlib:step=1`
 *   SeleniumLibrary  →  same structure as RF
 *   Python           →  `    page.click("css=#btn")`\n`    # xlib:step=1`
 *   TypeScript       →  `    await page.click("css=#btn");`\n`    // xlib:step=1`
 *
 * The algorithm is language-agnostic:
 *   For each line that contains `xlib:step=N`, the PRECEDING non-blank,
 *   non-marker line is treated as the "keyword line" (the action line).
 *   This is robust across all four syntaxes because all emitters write
 *   the marker immediately after the action.
 *
 * This module is PURE — no file system access, no process.exit.
 * I/O (readFileSync) is the caller's responsibility; pass `sourceContent`
 * as a string.
 */

import { parseXlibComment } from '../codegen/xlib-comment.js';
import type { ParsedXlibComment } from '../codegen/xlib-comment.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedStep {
  /** 1-indexed step number from xlib:step=N marker. */
  step: number;
  /** Line index in the source file (0-indexed) of the xlib marker comment. */
  markerLineIdx: number;
  /** Line index of the keyword line that precedes the marker (0-indexed). */
  keywordLineIdx: number;
  /** Raw keyword line text (the line that performs the action). */
  keywordLine: string;
  /** Parsed xlib payload (step + alts). */
  xlib: ParsedXlibComment;
}

export interface StepIndex {
  /** Steps in source order. */
  steps: ParsedStep[];
  /** Map from step number → ParsedStep (for direct --at <N> lookup). */
  byNumber: Map<number, ParsedStep>;
}

export interface FuzzyMatch {
  step: number;
  keywordLine: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk `sourceContent` and build a `StepIndex`.
 *
 * Algorithm:
 *   Split into lines. For every line that parses as an xlib marker:
 *     1. Record the marker line index.
 *     2. Walk BACKWARDS from `markerLineIdx - 1` to find the nearest
 *        non-blank line that is NOT itself a marker comment — that is
 *        the keyword line.
 *     3. Build a `ParsedStep` and add to both `steps` and `byNumber`.
 *
 * Duplicate step numbers (same `xlib:step=N` appearing twice) are silently
 * skipped after the first occurrence; the first one wins.
 *
 * @param sourceContent  Full text of the source file.
 */
export function parseSteps(sourceContent: string): StepIndex {
  const lines = sourceContent.split('\n');
  const steps: ParsedStep[] = [];
  const byNumber = new Map<number, ParsedStep>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const payload = parseXlibComment(line);
    if (!payload) continue;

    // Skip duplicate step numbers — first occurrence wins.
    if (byNumber.has(payload.step)) continue;

    // Find the nearest preceding keyword line.
    const { keywordLineIdx, keywordLine } = findPrecedingKeywordLine(lines, i);

    const parsedStep: ParsedStep = {
      step: payload.step,
      markerLineIdx: i,
      keywordLineIdx,
      keywordLine,
      xlib: payload,
    };

    steps.push(parsedStep);
    byNumber.set(payload.step, parsedStep);
  }

  // Sort by source order (markerLineIdx) — handles pathological cases where
  // step numbers appear out of order in the source.
  steps.sort((a, b) => a.markerLineIdx - b.markerLineIdx);

  return { steps, byNumber };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy content match
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Case-insensitive substring match on keyword lines.
 *
 * Useful for `--at "Click Login"` where the user types part of the keyword
 * rather than remembering the exact step number.
 *
 * Returns all matching steps in source order.
 *
 * @param index  StepIndex produced by `parseSteps`.
 * @param query  Search string (case-insensitive).
 */
export function findStepsByContent(index: StepIndex, query: string): FuzzyMatch[] {
  const needle = query.toLowerCase();
  const results: FuzzyMatch[] = [];

  for (const s of index.steps) {
    if (s.keywordLine.toLowerCase().includes(needle)) {
      results.push({ step: s.step, keywordLine: s.keywordLine });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk backwards from `markerIdx - 1` and return the first line that:
 *   - is not blank (i.e. not all whitespace), AND
 *   - does not itself parse as an xlib marker comment.
 *
 * If no such line exists (marker is at the top of the file with nothing
 * before it), returns `{ keywordLineIdx: markerIdx, keywordLine: '' }` as
 * a safe fallback — the caller still gets a usable `ParsedStep`.
 */
function findPrecedingKeywordLine(
  lines: readonly string[],
  markerIdx: number,
): { keywordLineIdx: number; keywordLine: string } {
  for (let j = markerIdx - 1; j >= 0; j--) {
    const candidate = lines[j] ?? '';

    // Skip blank lines.
    if (candidate.trim() === '') continue;

    // Skip other xlib marker lines (shouldn't happen in well-formed files, but
    // guard against emitters that write back-to-back markers).
    if (parseXlibComment(candidate) !== null) continue;

    return { keywordLineIdx: j, keywordLine: candidate };
  }

  // Fallback: no keyword line found above the marker.
  return { keywordLineIdx: markerIdx, keywordLine: '' };
}
