/**
 * recorder/jsonl-artifact.ts
 *
 * JSONL artifact format for `--save-actions` / `xlibrary emit`.
 *
 * File layout
 * ───────────
 * Line 0: xlibrary header JSON  (schema version + metadata)
 * Line 1+: one JSON object per ActionInContext (Playwright's existing JSONL schema)
 *
 * Example:
 * ```jsonl
 * {"xlib":1,"recorded-at":"2026-05-22T19:23:45.123Z","browser":"chromium","test-name":"Login Flow"}
 * {"name":"openPage","url":"https://example.com","signals":[],"pageGuid":"...","pageAlias":"page","framePath":[]}
 * {"name":"click","selector":"css=#btn","button":"left","modifiers":0,"clickCount":1,"signals":[],...}
 * ```
 *
 * The `xlib` field is the schema version (integer, starts at 1).
 * `xlibrary emit` reads the header to default `--test-name`, browser context, etc.
 *
 * Design notes
 * ────────────
 * - Pure functions only; no I/O — callers (runner.ts, cli-emit.ts) own file reads/writes.
 * - The action-line schema is the same flat shape that Playwright's JsonlLanguageGenerator
 *   writes (see `JsonlEntry` in jsonl-bridge.ts). This makes JSONL bridge mode trivial:
 *   just prepend the header to the temp file.
 * - In direct mode, we serialize captured ActionInContext objects the same way:
 *   merge `action` fields + `frame` fields into one flat object (mirrors Playwright's schema).
 */

import type { ActionInContext } from '../types.js';
import type { JsonlEntry } from './jsonl-bridge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

/** Current schema version. Increment when the header shape changes in a breaking way. */
export const XLIB_SCHEMA_VERSION = 1 as const;

/**
 * The first line of every `.jsonl` artifact produced by xlibrary.
 */
export interface XlibArtifactHeader {
  /** Schema version — always 1 for v0.2. */
  xlib: typeof XLIB_SCHEMA_VERSION;
  /** ISO-8601 timestamp of when the recording ended. */
  'recorded-at': string;
  /** Browser used: chromium | firefox | webkit */
  browser: string;
  /** Test-case name (from --test-name). */
  'test-name': string;
}

/**
 * Build the header object for a new artifact.
 *
 * @param browser   Browser name used during recording.
 * @param testName  Test name from --test-name (or the default).
 * @param now       ISO-8601 timestamp; defaults to `new Date().toISOString()`.
 */
export function buildArtifactHeader(
  browser: string,
  testName: string,
  now: string = new Date().toISOString(),
): XlibArtifactHeader {
  return {
    xlib: XLIB_SCHEMA_VERSION,
    'recorded-at': now,
    browser,
    'test-name': testName,
  };
}

/**
 * Serialize a header object to a single JSONL line (no trailing newline).
 */
export function serializeHeader(header: XlibArtifactHeader): string {
  return JSON.stringify(header);
}

/**
 * Parse the first line of an artifact as a header.
 *
 * Returns `undefined` if the line is missing, empty, or not valid JSON with an
 * `xlib` integer field — so callers can distinguish "xlibrary artifact" from
 * "plain Playwright JSONL".
 */
export function parseArtifactHeader(firstLine: string): XlibArtifactHeader | undefined {
  const trimmed = firstLine.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('xlib' in parsed) ||
    typeof (parsed as Record<string, unknown>)['xlib'] !== 'number'
  ) {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  return {
    xlib: obj['xlib'] as number as typeof XLIB_SCHEMA_VERSION,
    'recorded-at': typeof obj['recorded-at'] === 'string' ? obj['recorded-at'] : '',
    browser: typeof obj['browser'] === 'string' ? obj['browser'] : 'chromium',
    'test-name': typeof obj['test-name'] === 'string' ? obj['test-name'] : 'Recorded Flow',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action-line serialization (direct mode only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize a single `ActionInContext` to a flat JSONL entry line.
 *
 * The shape mirrors what Playwright's own `JsonlLanguageGenerator` writes:
 * all `action` fields + `frame` fields merged into one object.
 * This is the same shape that `parseJsonlContent` / `jsonlEntryToActionInContext`
 * in jsonl-bridge.ts consume — so the JSONL bridge and direct-mode paths produce
 * identical artifacts.
 */
export function serializeAction(actionInContext: ActionInContext): string {
  const { frame, action, startTime, endTime } = actionInContext;
  const entry: JsonlEntry & { startTime?: number; endTime?: number } = {
    // Spread action fields first (name, signals, selector, url, text, etc.)
    ...action,
    // Then frame fields (same names as JsonlEntry)
    pageGuid: frame.pageGuid,
    pageAlias: frame.pageAlias,
    framePath: frame.framePath,
    // Preserve timing metadata so round-trips keep approximate ordering info
    startTime,
    ...(endTime !== undefined ? { endTime } : {}),
  };
  return JSON.stringify(entry);
}

// ─────────────────────────────────────────────────────────────────────────────
// Full artifact serialization/deserialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the full content of a `.jsonl` artifact file.
 *
 * Returns a string ready to write to disk:
 *   line 0 = header JSON
 *   lines 1+= one action per line
 * The string ends with a trailing newline.
 */
export function buildArtifactContent(
  header: XlibArtifactHeader,
  actions: ActionInContext[],
): string {
  const lines: string[] = [serializeHeader(header)];
  for (const action of actions) {
    lines.push(serializeAction(action));
  }
  return lines.join('\n') + '\n';
}

/**
 * Build a `.jsonl` artifact where the action lines come from an already-written
 * Playwright JSONL temp file (JSONL bridge mode).
 *
 * In JSONL bridge mode Playwright already wrote the action lines to `tempContent`.
 * We strip Playwright's own header (line 0, which is a recorder metadata line),
 * then prepend our xlibrary header.
 *
 * @param header      The xlibrary header to prepend.
 * @param tempContent Raw content of Playwright's temp JSONL file.
 */
export function buildArtifactFromBridgeContent(
  header: XlibArtifactHeader,
  tempContent: string,
): string {
  // Playwright's JSONL file starts with its own metadata header on line 0;
  // action entries start at line 1. Skip line 0 and keep everything else.
  const rawLines = tempContent.split('\n');
  // rawLines[0] is Playwright's header; rawLines[1..] are action entries.
  const actionLines = rawLines.slice(1);

  // Remove empty trailing line from the split (the file ends with \n).
  while (actionLines.length > 0 && actionLines[actionLines.length - 1]?.trim() === '') {
    actionLines.pop();
  }

  const lines: string[] = [serializeHeader(header), ...actionLines];
  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact reader (for xlibrary emit)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of reading a `.jsonl` artifact.
 */
export interface ArtifactReadResult {
  header: XlibArtifactHeader;
  /** Raw JSONL lines for the action entries (line 0 stripped; empty lines excluded). */
  actionLines: string[];
}

/**
 * Parse a `.jsonl` artifact file's text content.
 *
 * Throws if the content is empty or the first line is not a valid xlibrary header.
 */
export function parseArtifactContent(content: string): ArtifactReadResult {
  const rawLines = content.split('\n');
  if (rawLines.length === 0 || !rawLines[0]) {
    throw new Error(
      'jsonl-artifact: file is empty — expected xlibrary header on line 0 ' +
        '({"xlib":1,"recorded-at":"...","browser":"...","test-name":"..."})',
    );
  }

  const header = parseArtifactHeader(rawLines[0]);
  if (!header) {
    throw new Error(
      `jsonl-artifact: line 0 is not a valid xlibrary header — got: ${rawLines[0].slice(0, 120)}\n` +
        'Expected: {"xlib":1,"recorded-at":"<iso>","browser":"<browser>","test-name":"<name>"}',
    );
  }

  const actionLines: string[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i]?.trim();
    if (line) actionLines.push(line);
  }

  return { header, actionLines };
}
