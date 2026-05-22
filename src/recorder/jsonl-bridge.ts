/**
 * recorder/jsonl-bridge.ts
 *
 * Parsing + re-rendering for JSONL bridge mode.
 *
 * When the bundle-patch is unavailable (Playwright internal layout changed),
 * the runner asks Playwright to write each recorded action as JSON line into
 * a temp file (`_enableRecorder({ language: 'jsonl', outputFile: <tmp> })`).
 * This module owns:
 *
 *   1. The shape of a JSONL line (`JsonlEntry`).
 *   2. Reconstructing an `ActionInContext` from one entry.
 *   3. Rendering one entry as Robot Framework keyword lines via the supplied
 *      generator.
 *
 * Why a fresh generator per render: Playwright's `ThrottledFile` mutates the
 * last JSONL line in place while the user is mid-action (e.g. typing into a
 * `fill`). Any state carried across ticks (e.g. the openPage/navigate collapse
 * flag) would drift from the actual sequence — re-running stateless from the
 * full entry list keeps the output deterministic.
 */

import { debuglog } from 'node:util';
import type { Action, ActionInContext } from '../types.js';

/**
 * Minimal interface that `jsonlEntryToStepLines` needs from any generator.
 * Both `RobotFrameworkLanguageGenerator` and `SeleniumLibraryLanguageGenerator`
 * satisfy this structurally.
 */
export interface ActionGenerator {
  generateAction(actionInContext: ActionInContext): string;
}

const dlog = debuglog('xlibrary');

/**
 * Flat shape of one JSONL output line.
 *
 * Playwright's JsonlLanguageGenerator merges `ActionInContext.action` and
 * `ActionInContext.frame` into a single flat object, plus an extra `locator`
 * field used by the recorder UI we don't need.
 */
export interface JsonlEntry {
  // ── from action ────────────────────────────────────────────────────────
  name?: string;
  signals?: unknown[];
  selector?: string;
  url?: string;
  text?: string;
  key?: string;
  modifiers?: number;
  options?: string[];
  files?: string[];
  value?: string;
  checked?: boolean;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  ariaSnapshot?: string;
  preconditionSelector?: string;
  ref?: string;
  substring?: boolean;
  // ── from frame ─────────────────────────────────────────────────────────
  pageGuid?: string;
  pageAlias?: string;
  framePath?: string[];
  // ── added by jsonl generator ───────────────────────────────────────────
  locator?: unknown;
}

/**
 * Reconstruct an `ActionInContext` from a flat JSONL entry.
 * Returns `undefined` if the entry is missing a valid action name.
 */
export function jsonlEntryToActionInContext(entry: JsonlEntry): ActionInContext | undefined {
  const {
    pageGuid = '',
    pageAlias = 'page',
    framePath = [],
    locator: _locator,
    ...actionFields
  } = entry;

  if (!actionFields.name) return undefined;

  const action = {
    ...actionFields,
    signals: Array.isArray(actionFields.signals) ? actionFields.signals : [],
  } as unknown as Action;

  return {
    frame: { pageGuid, pageAlias, framePath },
    action,
    startTime: Date.now(),
  };
}

/**
 * Translate one JSONL entry into Robot Framework keyword-call lines
 * (each already 4-space indented, matching RobotFormatter output).
 *
 * Generator errors are NOT silently rewritten into TODO comments — that
 * pattern made real bugs look like user follow-ups. The line is now marked
 * `# ERROR` (visible during review) and the underlying error is logged to
 * stderr so the user actually sees it.
 */
export function jsonlEntryToStepLines(entry: JsonlEntry, generator: ActionGenerator): string[] {
  const actionInContext = jsonlEntryToActionInContext(entry);
  if (!actionInContext) {
    dlog(
      'jsonlEntryToStepLines: dropping entry with no name: %s',
      JSON.stringify(entry).slice(0, 200),
    );
    return [];
  }

  let step: string;
  try {
    step = generator.generateAction(actionInContext);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ⚠  Generator threw on "${entry.name}": ${msg}`);
    dlog('jsonlEntryToStepLines: %s', err instanceof Error ? err.stack : err);
    step = `    # ERROR: failed to generate "${entry.name ?? 'unknown'}" — ${msg}`;
  }

  if (!step.trim()) return [];
  return step.split('\n').filter((line) => line.trim() !== '');
}

/**
 * Parse the entire JSONL temp file into entries.
 *
 * Skips line 0 (header metadata) and silently drops malformed lines (logged
 * via dlog). Empty or whitespace-only lines are ignored.
 */
export function parseJsonlContent(content: string): JsonlEntry[] {
  const rawLines = content.split('\n');
  const entries: JsonlEntry[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const raw = rawLines[i].trim();
    if (!raw) continue;
    try {
      entries.push(JSON.parse(raw) as JsonlEntry);
    } catch {
      dlog('parseJsonlContent: malformed JSONL at line %d: %s', i, raw.slice(0, 100));
    }
  }
  return entries;
}
