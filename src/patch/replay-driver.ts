/**
 * replay-driver.ts
 *
 * Orchestrator for the `xlibrary patch` replay-then-record flow:
 *
 *   1. Read the prior action stream from the JSONL sidecar (preferred) OR fall
 *      back to "no prior actions" with a warning when the sidecar is absent.
 *   2. Replay actions 0 … (targetStep − 2) via replay-engine.
 *      Index maths: targetStep is 1-based (user-facing), actions array is
 *      0-based.  "replay up to target step − 1" means indices 0 to
 *      (targetStep − 2) inclusive.
 *   3. On failure in interactive mode: show [s]kip / [r]ecord / [a]bort prompt.
 *      In --non-interactive mode: abort immediately with diagnostic.
 *   4. Open the Playwright recorder at the page's current state (after replay).
 *   5. Capture new actions until the user closes the browser.
 *   6. Return { newActions, status }.
 *
 * The caller (cli-patch.ts) feeds the returned newActions into step-formatter
 * and then into operations.ts for splicing.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { chromium, firefox, webkit } from 'playwright-core';
import type { Browser, BrowserContext, BrowserType } from 'playwright-core';
import { debuglog } from 'node:util';

import type { ActionInContext } from '../types.js';
import { createReplayController } from '../replay/replay-engine.js';
import type { ReplayState } from '../replay/replay-engine.js';
import { parseJsonlContent, jsonlEntryToActionInContext } from '../recorder/jsonl-bridge.js';

const dlog = debuglog('xlibrary');

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type ReplayDriverResult =
  | { status: 'done'; newActions: ActionInContext[] }
  | { status: 'aborted'; reason: string };

export interface ReplayDriverOptions {
  /** Absolute path to the source .robot / .py / .ts file being patched. */
  sourceFile: string;
  /**
   * 1-based step number the user wants to replace / insert at.
   * Replay will execute actions 1 … (targetStep − 1).
   */
  targetStep: number;
  /** Browser engine to use for replay + re-recording. Default: chromium. */
  browserName?: 'chromium' | 'firefox' | 'webkit';
  /**
   * When true, any replay failure aborts immediately instead of offering
   * the interactive [s]kip / [r]ecord / [a]bort prompt.
   */
  nonInteractive?: boolean;
  /**
   * Milliseconds between replay actions. Default: 500.
   * Tests can pass a small value (e.g. 50) to speed up.
   */
  stepDelayMs?: number;
  /**
   * Per-action timeout for replay. Default: 5000.
   */
  actionTimeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Select a Playwright BrowserType by name. */
function selectBrowserType(name: ReplayDriverOptions['browserName']): BrowserType {
  switch (name) {
    case 'firefox':
      return firefox;
    case 'webkit':
      return webkit;
    default:
      return chromium;
  }
}

/** Millisecond sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONL sidecar reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load prior actions from the JSONL sidecar next to sourceFile.
 *
 * Sidecar convention: `<sourceFile>.jsonl`
 * (e.g. `tests/login.robot` → `tests/login.robot.jsonl`)
 *
 * When the sidecar is absent a warning is printed and an empty array is
 * returned. Replay with zero prior actions means the recorder opens on a
 * blank browser — the user re-records from scratch up to the splice point.
 */
async function loadPriorActions(sourceFile: string): Promise<ActionInContext[]> {
  const sidecarPath = sourceFile + '.jsonl';

  if (!existsSync(sidecarPath)) {
    console.warn(
      `  ⚠  No JSONL sidecar found at: ${sidecarPath}` +
        `\n     Replay will start from a blank browser (no prior actions to replay).` +
        `\n     Record manually up to your target step, then close the browser.\n`,
    );
    return [];
  }

  let content: string;
  try {
    content = await readFile(sidecarPath, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `  ⚠  Could not read JSONL sidecar (${sidecarPath}): ${msg}` +
        `\n     Replay will start from a blank browser.\n`,
    );
    return [];
  }

  if (!content.trim()) {
    console.warn(`  ⚠  JSONL sidecar is empty (${sidecarPath}). Starting from blank browser.\n`);
    return [];
  }

  const entries = parseJsonlContent(content);
  const actions = entries
    .map((e) => jsonlEntryToActionInContext(e))
    .filter((a): a is ActionInContext => a !== undefined);

  dlog('replay-driver: loaded %d prior actions from %s', actions.length, sidecarPath);
  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive prompt
// ─────────────────────────────────────────────────────────────────────────────

type PromptChoice = 'skip' | 'record' | 'abort';

/**
 * Ask the user what to do after a replay failure.
 *
 * [s]kip   → mark the failed step as skipped, continue to next
 * [r]ecord → stop replay here, open recorder at current page state
 * [a]bort  → exit, restore .bak
 *
 * Returns null when stdin is not a TTY (callers treat as 'abort').
 */
async function promptOnFailure(stepIndex: number, errorMessage: string): Promise<PromptChoice> {
  // Guard: if stdin is not a TTY we cannot read interactively.
  if (!process.stdin.isTTY) {
    return 'abort';
  }

  process.stderr.write(
    `\n  ✗  Replay failed at step ${stepIndex + 1}: ${errorMessage}\n` +
      `\n  What do you want to do?\n` +
      `    [s]kip   — skip this step and continue replay\n` +
      `    [r]ecord — stop replay here and open recorder at current page\n` +
      `    [a]bort  — abort the patch operation\n` +
      `\n  Choice [s/r/a]: `,
  );

  return new Promise<PromptChoice>((resolve) => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.once('line', (line) => {
      rl.close();
      const choice = line.trim().toLowerCase();
      if (choice === 's' || choice === 'skip') resolve('skip');
      else if (choice === 'r' || choice === 'record') resolve('record');
      else resolve('abort');
    });
    // If stdin closes without a line, default to abort.
    rl.once('close', () => resolve('abort'));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Recorder capture
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal interface for calling _enableRecorder on a BrowserContext. */
interface BrowserContextWithRecorder {
  _enableRecorder(params: {
    language: string;
    mode?: string;
    outputFile?: string;
    handleSIGINT?: boolean;
  }): Promise<void>;
}

/**
 * Open a Playwright recorder on `context` + `page` (which already have the
 * browser state from replay), capture all actions until the browser closes,
 * and return them as ActionInContext[].
 *
 * Strategy: use the 'jsonl' language so Playwright writes raw actions to a
 * temp file — same approach as runner.ts's JSONL bridge mode. We poll the
 * temp file every 400 ms and parse on browser close.
 */
async function captureViaRecorder(
  browser: Browser,
  context: BrowserContext,
  _browserName: ReplayDriverOptions['browserName'],
): Promise<ActionInContext[]> {
  const tempDir = join(tmpdir(), `xlibrary-patch-${Date.now()}`);
  const tempJSONLPath = join(tempDir, 'recording.jsonl');

  await mkdir(tempDir, { recursive: true });

  const contextWithRecorder = context as unknown as BrowserContextWithRecorder;
  await contextWithRecorder._enableRecorder({
    language: 'jsonl',
    mode: 'recording',
    outputFile: tempJSONLPath,
    handleSIGINT: false,
  });

  console.log(
    `\n  Record your new step(s) in the browser window.` +
      `\n  Close the browser window when done.\n`,
  );

  // Wait for the browser to close.
  await new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve());
  });

  // Grace period for ThrottledFile to flush.
  await sleep(200);

  // Read and parse the JSONL file.
  let actions: ActionInContext[] = [];
  try {
    const content = await readFile(tempJSONLPath, 'utf8');
    if (content.trim()) {
      const entries = parseJsonlContent(content);
      actions = entries
        .map((e) => jsonlEntryToActionInContext(e))
        .filter((a): a is ActionInContext => a !== undefined);
    }
  } catch (err) {
    dlog('captureViaRecorder: failed to read JSONL: %s', err instanceof Error ? err.message : err);
  }

  // Cleanup temp dir.
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }

  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute the full replay → record cycle for a single patch operation.
 *
 * Returns `{ status: 'done', newActions }` on success.
 * Returns `{ status: 'aborted', reason }` when the user aborts or a
 * non-interactive failure occurs.
 */
export async function replayThenRecord(options: ReplayDriverOptions): Promise<ReplayDriverResult> {
  const { sourceFile, targetStep, nonInteractive = false } = options;
  const browserName = options.browserName ?? 'chromium';
  const stepDelayMs = options.stepDelayMs ?? 500;
  const actionTimeoutMs = options.actionTimeoutMs ?? 5000;

  // ── 1. Load prior actions from JSONL sidecar ─────────────────────────────
  const allPriorActions = await loadPriorActions(sourceFile);

  // targetStep is 1-based. We want to replay actions at indices
  // 0 … (targetStep − 2), i.e. the first (targetStep − 1) actions.
  const replayCount = Math.max(0, targetStep - 1);
  const actionsToReplay = allPriorActions.slice(0, replayCount);

  dlog(
    'replay-driver: targetStep=%d, priorActions=%d, replayCount=%d',
    targetStep,
    allPriorActions.length,
    replayCount,
  );

  // ── 2. Launch browser ─────────────────────────────────────────────────────
  const browserType = selectBrowserType(browserName);
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await browserType.launch({ headless: false });
    context = await browser.newContext();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'aborted', reason: `Failed to launch browser: ${msg}` };
  }

  // ── 3. Replay prior actions ───────────────────────────────────────────────
  if (actionsToReplay.length > 0) {
    console.log(`\n  Replaying ${actionsToReplay.length} action(s) before step ${targetStep}…\n`);

    const ctrl = createReplayController({
      actions: actionsToReplay,
      browserName,
      stepDelayMs,
      actionTimeoutMs,
    });

    // Wire up progress indicator.
    ctrl.onStateChange((state: ReplayState) => {
      if (state.status === 'running' && state.currentIndex >= 0) {
        const stepNum = state.currentIndex + 1;
        const total = state.totalActions;
        process.stdout.write(
          `\r  Replaying step ${stepNum}/${total}: ${state.currentName ?? ''}  `,
        );
      }
    });

    await ctrl.start();

    // Wait for completion or failure.
    const finalState = await waitUntilDone(ctrl);

    if (finalState.status === 'error') {
      const errorMsg = finalState.errorMessage ?? 'unknown error';
      process.stdout.write('\n');

      if (nonInteractive) {
        await browser.close().catch(() => {
          /* ignore */
        });
        return {
          status: 'aborted',
          reason: `Replay failed at step ${(finalState.currentIndex ?? 0) + 1}: ${errorMsg}`,
        };
      }

      // Interactive: ask the user.
      const choice = await promptOnFailure(finalState.currentIndex ?? 0, errorMsg);

      if (choice === 'abort') {
        await browser.close().catch(() => {
          /* ignore */
        });
        return { status: 'aborted', reason: `User aborted after replay failure: ${errorMsg}` };
      }

      if (choice === 'skip') {
        // User wants to skip the failed step and continue replay from the
        // next index. We restart replay from (currentIndex + 1) to the end.
        const skipFrom = (finalState.currentIndex ?? 0) + 1;
        const remaining = actionsToReplay.slice(skipFrom);

        if (remaining.length > 0) {
          console.log(`\n  Skipping step ${skipFrom + 1}, continuing replay…\n`);
          const ctrl2 = createReplayController({
            actions: remaining,
            browserName,
            stepDelayMs,
            actionTimeoutMs,
          });
          await ctrl2.start();
          const finalState2 = await waitUntilDone(ctrl2);
          process.stdout.write('\n');

          if (finalState2.status === 'error') {
            const err2 = finalState2.errorMessage ?? 'unknown error';
            if (nonInteractive) {
              await browser.close().catch(() => {
                /* ignore */
              });
              return {
                status: 'aborted',
                reason: `Replay failed during skip-resume at step ${(finalState2.currentIndex ?? 0) + skipFrom + 1}: ${err2}`,
              };
            }
            // For simplicity: a second failure after skip → ask again
            const choice2 = await promptOnFailure((finalState2.currentIndex ?? 0) + skipFrom, err2);
            if (choice2 === 'abort' || choice2 === 'skip') {
              // Skip on skip → abort (don't loop infinitely)
              await browser.close().catch(() => {
                /* ignore */
              });
              return {
                status: 'aborted',
                reason: 'Replay failed twice — aborting to prevent infinite skip loop.',
              };
            }
            // choice2 === 'record' → fall through to recorder
          }
        }
      }
      // choice === 'record' falls through to recorder below.
    } else {
      process.stdout.write('\n');
    }

    // Stop the replay controller (browser stays open; we pass `context` to recorder).
    await ctrl.stop().catch(() => {
      /* ignore */
    });
  }

  // ── 4. Open recorder and capture new actions ──────────────────────────────
  console.log(`\n  Opening recorder at step ${targetStep}…`);

  // We need to open a new page in the existing context if none is open,
  // because the replay engine uses its OWN browser (separate from ours).
  // The replay-engine's browser has already navigated — but we launched
  // our OWN browser above. The replay-engine internally manages its own
  // Browser instance. Our `browser` + `context` need a page.
  const pages = context.pages();
  if (pages.length === 0) {
    await context.newPage();
  }

  const newActions = await captureViaRecorder(browser, context, browserName);

  // Browser is now closed (captureViaRecorder awaits disconnect).

  if (newActions.length === 0) {
    console.warn(`  ⚠  No actions recorded — the patch will insert an empty block.\n`);
  } else {
    console.log(`  ✓  Captured ${newActions.length} new action(s).\n`);
  }

  return { status: 'done', newActions };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper: wait until replay reaches a terminal state
// ─────────────────────────────────────────────────────────────────────────────

async function waitUntilDone(
  ctrl: ReturnType<typeof createReplayController>,
): Promise<ReplayState> {
  return new Promise<ReplayState>((resolve) => {
    const unsub = ctrl.onStateChange((state: ReplayState) => {
      const done =
        state.status === 'complete' || state.status === 'error' || state.status === 'stopped';
      if (done) {
        unsub();
        resolve(state);
      }
    });
    // Also check current state in case it's already done.
    const current = ctrl.getState();
    const alreadyDone =
      current.status === 'complete' || current.status === 'error' || current.status === 'stopped';
    if (alreadyDone) {
      unsub();
      resolve(current);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: derive JSONL sidecar path from source file path (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the expected JSONL sidecar path for a given source file.
 * e.g. `/path/to/test.robot` → `/path/to/test.robot.jsonl`
 */
export function sidecarPathFor(sourceFile: string): string {
  return sourceFile + '.jsonl';
}

/**
 * Write an ActionInContext[] array as a JSONL sidecar file.
 * Used by tests to create fixture sidecars without running the recorder.
 */
export async function writeSidecar(
  sourceFile: string,
  actions: ActionInContext[],
): Promise<string> {
  const sidecarPath = sidecarPathFor(sourceFile);
  const dir = dirname(sidecarPath);
  await mkdir(dir, { recursive: true });

  // Line 0: header metadata (parseJsonlContent skips line 0)
  const lines = ['{"version":1}'];
  for (const action of actions) {
    const flat = {
      ...action.action,
      pageGuid: action.frame.pageGuid,
      pageAlias: action.frame.pageAlias,
      framePath: action.frame.framePath,
    };
    lines.push(JSON.stringify(flat));
  }

  await writeFile(sidecarPath, lines.join('\n') + '\n', 'utf8');
  return sidecarPath;
}
