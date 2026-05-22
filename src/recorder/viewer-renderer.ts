/**
 * viewer-renderer.ts
 *
 * Pure parsing pipeline that transforms a raw `.robot` text string into a
 * structured `ViewerPayload` — the data shape the viewer frontend needs to
 * render quality-grade badges beside each step line.
 *
 * Architecture:
 *   1. Split the robot text into lines.
 *   2. For each line, attempt to parse a trailing `# xlib:step=N;alts=[...]`
 *      comment via `parseXlibComment()`.
 *   3. When a marker is found, grade the primary selector (alts[0]) via
 *      `gradeCandidate()` and record a `BadgeInfo` for the line index.
 *   4. Lines without markers produce no badge entry — they render as-is.
 *
 * The module is intentionally side-effect-free: no I/O, no process globals.
 * This makes it straightforward to test without spinning up a server.
 */

import { parseXlibComment } from '../codegen/xlib-comment.js';
import { gradeCandidate } from '../codegen/locator-grader.js';
import type { Grade } from '../codegen/locator-grader.js';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Badge metadata for a single step line.
 *
 * `lineIdx` is 0-based (matches `text.split('\n')[lineIdx]`).
 * `grade`   is the quality grade of the primary selector.
 * `alts`    is the full ordered list of alternative selectors (may be empty
 *            when only a single candidate was recorded — grade chip is still
 *            shown, expand panel is suppressed).
 */
export interface BadgeInfo {
  /** 0-based index into the lines array. */
  lineIdx: number;
  /** Letter-grade for the primary selector. */
  grade: Grade;
  /** All alternative selectors in ranked order (primary = index 0). */
  alts: string[];
}

/**
 * The full payload broadcast to viewer clients.
 *
 * `text`   is the raw `.robot` content (unchanged).
 * `badges` is the list of badge metadata, one entry per step line that carries
 *          an `# xlib:` marker. Lines without a marker have no entry — the
 *          frontend must handle absent entries gracefully.
 */
export interface ViewerPayload {
  text: string;
  badges: BadgeInfo[];
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Parse `robotText` and produce a `ViewerPayload`.
 *
 * The function never throws — malformed markers are silently skipped.
 */
export function buildViewerPayload(robotText: string): ViewerPayload {
  const lines = robotText.split('\n');
  const badges: BadgeInfo[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    const parsed = parseXlibComment(line);
    if (parsed === null) continue;

    // Determine the primary selector: first entry of alts, if present.
    const primarySelector = parsed.alts?.[0] ?? '';
    const alts = parsed.alts ?? [];

    // Grade the primary selector (empty string → grade D / unknown).
    const { grade } = gradeCandidate({ selector: primarySelector });

    badges.push({ lineIdx, grade, alts });
  }

  return { text: robotText, badges };
}
