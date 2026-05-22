/**
 * recorder/runner.ts
 *
 * Launches Chromium (or another browser) with Playwright's visual recorder,
 * captures recorded actions, translates them to Robot Framework syntax via
 * RobotFrameworkLanguageGenerator, and writes the output `.robot` file.
 *
 * Two operating modes (selected automatically at runtime):
 *
 * ── DIRECT MODE (preferred) ────────────────────────────────────────────────
 * If we can monkey-patch Playwright's internal `languageSet()` function to
 * register our generator, the Inspector writes Robot Framework `.robot` output
 * directly — no temp files, no translation step, no polling delay.
 *   `_enableRecorder({ language: 'robotframework', outputFile: outputPath })`
 *
 * ── JSONL BRIDGE MODE (fallback) ───────────────────────────────────────────
 * Playwright bundles its internals into `coreBundle.js`, so the monkey-patch
 * fails in most installations. We fall back transparently:
 *   1. `_enableRecorder({ language: 'jsonl', outputFile: tmpFile })`
 *   2. Poll tmpFile every 400 ms; translate JSONL → Robot Framework; write outputPath.
 *   3. Stateless full re-render per poll — handles ThrottledFile mutations to existing lines.
 *
 * Supporting modules in this folder:
 *   - `bundle-patcher.ts`         — Module._compile hook + 3 regex patches
 *   - `viewer-server.ts`          — HTTP + WebSocket live preview server
 *   - `inspector-toolbar/`        — Toolbar HTML/CSS/JS injection
 *   - `jsonl-bridge.ts`           — JSONL parse + reconstruct ActionInContext
 *   - `preview-printer.ts`        — Unicode-box keyword preview
 *   - `editor-opener.ts`          — openInEditor + openInBrowser
 */

import { debuglog } from 'node:util';
import { chromium, firefox, webkit } from 'playwright-core';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import type {
  RobotCodegenOptions,
  LangTarget,
  ActionInContext,
  LanguageGeneratorOptions,
} from '../types.js';
import { RobotFrameworkLanguageGenerator } from '../codegen/robotframework.js';
import { SeleniumLibraryLanguageGenerator } from '../codegen/selenium.js';
import { startViewerServer } from './viewer-server.js';
import type { ViewerServer, ReplayCommand } from './viewer-server.js';
import {
  registerLanguageGenerator,
  wasBundlePatchSuccessful,
  wasInspectorPatchSuccessful,
  wasOutputFollowsTargetSuccessful,
  wasSelectorCandidatesPatchSuccessful,
  setInspectorInjection,
} from './bundle-patcher.js';
import { createReplayController, type ReplayController } from '../replay/replay-engine.js';
import { buildInspectorInjection } from './inspector-toolbar/index.js';
import { printKeywordPreview } from './preview-printer.js';
import { openInEditor, openInBrowser } from './editor-opener.js';
import {
  jsonlEntryToActionInContext,
  jsonlEntryToStepLines,
  parseJsonlContent,
} from './jsonl-bridge.js';
import {
  buildArtifactHeader,
  buildArtifactContent,
  buildArtifactFromBridgeContent,
} from './jsonl-artifact.js';

// ---------------------------------------------------------------------------
// Debug logger — activate with:  NODE_DEBUG=xlibrary node dist/cli.js …
// (node:util debuglog uses NODE_DEBUG, not the npm `debug` package's DEBUG)
// ---------------------------------------------------------------------------
const dlog = debuglog('xlibrary');

// ---------------------------------------------------------------------------
// Small async sleep helper (used for ENOENT retry in flushOutput).
// ---------------------------------------------------------------------------
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Re-export so existing consumers (and `tests/inspector-toolbar.test.ts`)
// can keep importing `buildInspectorInjection` from this module — the
// canonical home is `./inspector-toolbar/index.ts` since the B1 split.
export { buildInspectorInjection } from './inspector-toolbar/index.js';

// ---------------------------------------------------------------------------
// Loud warning when the bundle-patcher regex misses
// ---------------------------------------------------------------------------

/**
 * Print a multi-line banner explaining that direct-mode is unavailable,
 * which of the three patches missed, and where to report the regression.
 *
 * The user keeps recording — JSONL bridge mode still produces correct
 * `.robot` output. The banner exists so a silent regression doesn't ship
 * after a `playwright-core` minor bump: the user sees obvious feedback and
 * the issue gets reported with the exact version in the title.
 */
function printBundlePatchWarning(): void {
  const bar = '━'.repeat(72);
  const tick = (ok: boolean): string => (ok ? '✓ applied' : '✗ regex MISS');

  // Detect the bundled playwright-core version so the banner names it explicitly.
  let pwVersion = 'unknown';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require('node:module') as typeof import('node:module');
    const requireFromHere = createRequire(import.meta.url);
    pwVersion = (requireFromHere('playwright-core/package.json') as { version: string }).version;
  } catch {
    // Fall through with 'unknown' — not worth aborting over.
  }

  console.warn(
    `\n${bar}` +
      `\n⚠  xlibrary direct-mode UNAVAILABLE` +
      `\n` +
      `\n   playwright-core@${pwVersion} internal layout changed since xlibrary` +
      `\n   was last tested. Patches applied:` +
      `\n     • languageSet():           ${tick(wasBundlePatchSuccessful())}` +
      `\n     • Inspector injection:     ${tick(wasInspectorPatchSuccessful())}` +
      `\n     • Output follows Target:   ${tick(wasOutputFollowsTargetSuccessful())}` +
      `\n     • Selector candidates:     ${tick(wasSelectorCandidatesPatchSuccessful())}` +
      `\n` +
      `\n   Falling back to JSONL bridge mode — recording still works, but the` +
      `\n   Inspector window shows JSONL instead of Robot Framework, and the` +
      `\n   "Target:" dropdown will not switch the .robot output.` +
      `\n` +
      `\n   Please report at:` +
      `\n     https://github.com/Khrx1999/xlibrary/issues/new` +
      `\n   …with playwright-core@${pwVersion} in the title.` +
      `\n${bar}\n`,
  );
}

/**
 * Warn (but do NOT exit) when the user requests `-l ts` or `-l python` while
 * bundle patch #1 is failing.
 *
 * Why warn instead of hard-fail (per Task #4 investigation):
 *   Playwright's `playwright-test` and `python-pytest` language generators are
 *   shipped natively inside coreBundle.js and registered without any patching.
 *   A bundle-patch failure means xlibrary's Self-Healing alt-selector hints
 *   (Task #7) won't be injected — but the recording itself works fine.
 *   Hard-failing here would block a perfectly functional recording session.
 *
 *   The warning alerts the user that the future Self-Healing feature won't be
 *   active, and invites them to update or report the version mismatch.
 */
function printTsPythonPatchWarning(lang: 'ts' | 'python'): void {
  let pwVersion = 'unknown';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require('node:module') as typeof import('node:module');
    const requireFromHere = createRequire(import.meta.url);
    pwVersion = (requireFromHere('playwright-core/package.json') as { version: string }).version;
  } catch {
    // Fall through — version unknown but warning still fires.
  }

  const bar = '━'.repeat(72);
  const nativeId = lang === 'ts' ? 'playwright-test' : 'python-pytest';
  console.warn(
    `\n${bar}` +
      `\n⚠  xlibrary bundle patch unavailable (playwright-core@${pwVersion})` +
      `\n` +
      `\n   You requested -l ${lang} (Playwright's native emitter).  Recording` +
      `\n   will work correctly — Playwright's built-in ${nativeId}` +
      `\n   generator does not require xlibrary's bundle patch.` +
      `\n` +
      `\n   What you DO lose when the patch misses:` +
      `\n     • Self-Healing alt-selector hints (Task #7)` +
      `\n     • Inspector "Open Live Preview" button` +
      `\n` +
      `\n   To restore the patch, update xlibrary or downgrade playwright-core` +
      `\n   to a supported version.  Report at:` +
      `\n     https://github.com/Khrx1999/xlibrary/issues/new` +
      `\n   …with playwright-core@${pwVersion} in the title.` +
      `\n${bar}\n`,
  );
}

// ---------------------------------------------------------------------------
// Internal types — mirror the _enableRecorder channel schema
// (not exported from playwright-core public types, accessed via unknown cast)
// ---------------------------------------------------------------------------

interface EnableRecorderParams {
  language?: string;
  mode?: 'recording' | 'inspecting';
  outputFile?: string;
  launchOptions?: Record<string, unknown>;
  contextOptions?: Record<string, unknown>;
  handleSIGINT?: boolean;
}

/** Minimal interface used to call the internal `_enableRecorder` method. */
interface BrowserContextWithRecorder {
  _enableRecorder(params: EnableRecorderParams): Promise<void>;
}

// ---------------------------------------------------------------------------
// Language ID mapping
// ---------------------------------------------------------------------------

/**
 * Map xlibrary's `--lang` option value to the Playwright recorder language ID.
 *
 * The language IDs come from the `LanguageGenerator.id` field in Playwright's
 * built-in generators (vendor/playwright/.../codegen/languages.ts):
 *
 *   | xlibrary `lang`  | _enableRecorder `language` |
 *   |------------------|---------------------------|
 *   | `robot`          | `robotframework` / `jsonl` (chosen per directMode) |
 *   | `selenium`       | `selenium`                |
 *   | `ts`             | `playwright-test`         |
 *   | `python`         | `python-pytest`           |
 *
 * For `robot` we return a sentinel `'robot'` and let `runRecorder` handle
 * the directMode/JSONL split (same as before). For `selenium`, `ts`, and
 * `python` we always use direct mode — Playwright's built-in generators are
 * already registered in the bundle so no patcher is needed.
 */
export function langToPlaywrightId(lang: LangTarget, directMode: boolean): string {
  switch (lang) {
    case 'robot':
      return directMode ? 'robotframework' : 'jsonl';
    case 'selenium':
      return 'selenium';
    case 'ts':
      return 'playwright-test';
    case 'python':
      return 'python-pytest';
  }
}

/**
 * Human-readable label for the startup banner.
 */
function langLabel(lang: LangTarget): string {
  switch (lang) {
    case 'robot':
      return 'Robot Framework (Browser Library)';
    case 'selenium':
      return 'Robot Framework (SeleniumLibrary)';
    case 'ts':
      return 'TypeScript (Playwright Test)';
    case 'python':
      return 'Python (pytest-playwright)';
  }
}

// ---------------------------------------------------------------------------
// Main runner entry point
// ---------------------------------------------------------------------------

/**
 * Launch the browser with the Playwright recorder, translate recorded actions
 * to Robot Framework, and write the output `.robot` file.
 *
 * Resolves when the browser is closed or SIGINT is received.
 */
export async function runRecorder(options: RobotCodegenOptions): Promise<void> {
  const browserName = options.browser ?? 'chromium';
  const outputPath = options.output ?? 'recorded.robot';
  const testName = options.testName ?? 'Recorded Flow';
  const quiet = options.quiet ?? false;
  const openAfter = options.open ?? false;
  const showViewer = options.viewer !== false; // default on; --no-viewer disables
  const autoOpenViewer = options.openViewer ?? false; // off — Inspector gets a button instead
  const url = options.url;
  const doExtractData = options.extractData === true;
  // Default to 'robot' so existing callers that don't supply `lang` keep the same behaviour.
  const lang: LangTarget = options.lang ?? 'robot';

  // Resolve the JSONL artifact path from --save-actions
  // true (bare flag) → <output>.jsonl next to the output file
  // string → use as-is
  // undefined → no artifact written
  const artifactPath: string | undefined =
    options.saveActions === true
      ? outputPath.replace(/(\.[^.]+)?$/, (ext) => (ext ? `${ext}.jsonl` : '.jsonl'))
      : typeof options.saveActions === 'string'
        ? options.saveActions
        : undefined;

  // ── Select browser type ───────────────────────────────────────────────────
  const browserType =
    browserName === 'firefox' ? firefox : browserName === 'webkit' ? webkit : chromium;

  // ── Launch browser ─────────────────────────────────────────────────────────
  const browser = await browserType.launch({
    headless: false,
    handleSIGINT: false,
  });
  const context = await browser.newContext();

  // ── Initialise the generator ──────────────────────────────────────────────
  const generator = new RobotFrameworkLanguageGenerator(testName);
  const seleniumGenerator = new SeleniumLibraryLanguageGenerator(testName);

  const generatorOptions: LanguageGeneratorOptions = {
    browserName,
    launchOptions: {},
    contextOptions: {},
  };

  // ── Register Robot Framework targets with Playwright's language registry ──
  //
  // bundle-patcher.ts rewrote coreBundle.js's `languageSet()` factory at module
  // load time to consult our global registry. We register both Robot Framework
  // variants here, BEFORE _enableRecorder, so the Inspector dropdown offers both.
  //
  //   - Browser Library  (primary, drives outputFile when directMode)
  //   - SeleniumLibrary  (secondary, selectable from "Target:" dropdown)
  //
  // `wasBundlePatchSuccessful()` reflects whether the regex matched — if the
  // upstream Playwright internals changed shape, this returns false and we
  // fall back to JSONL bridge mode (still works, just shows JSONL in the
  // Inspector window instead of `.robot`).
  registerLanguageGenerator(generator);
  registerLanguageGenerator(seleniumGenerator);
  const directMode = wasBundlePatchSuccessful();

  if (directMode) {
    console.log(
      '  ✓  Registered Robot Framework targets in Playwright Inspector:',
      '\n       • Browser Library  (primary — output file written in this format)',
      '\n       • SeleniumLibrary  (selectable via Inspector "Target:" dropdown)',
    );
  } else if (lang === 'ts' || lang === 'python') {
    // Per Task #4 investigation: Playwright's native playwright-test /
    // python-pytest generators don't require xlibrary's bundle patch.
    // Recording works fine; only Self-Healing alt hints + Inspector button
    // are lost. Warn (don't hard-fail) so the user knows what they're missing.
    printTsPythonPatchWarning(lang);
  } else {
    // lang ∈ {robot, selenium} + bundle-patch failed → JSONL bridge fallback
    printBundlePatchWarning();
  }

  // ── Aux viewer window (--viewer, default on) ──────────────────────────────
  //
  // The viewer-server always starts in the background when --viewer is on.
  // By default we don't pop open a browser tab — the Playwright Inspector
  // gets an injected "Open Live Preview" button instead (via bundle-patcher's
  // Inspector injection patch). Pass --open-viewer for auto-open behaviour.
  let viewer: ViewerServer | null = null;
  if (showViewer) {
    try {
      viewer = await startViewerServer();
      if (autoOpenViewer) {
        openInBrowser(viewer.url);
      } else {
        // Wire the Inspector injection. Done BEFORE _enableRecorder so the
        // injection is in place by the time Playwright serves index.html.
        setInspectorInjection(buildInspectorInjection(viewer.url));
      }
    } catch (err) {
      console.warn(
        `  ⚠  Could not start viewer server — ${err instanceof Error ? err.message : String(err)}`,
        '\n     Recording will continue without the live viewer.',
      );
      viewer = null;
    }
  }

  // ── Temp JSONL file (JSONL bridge mode only) ──────────────────────────────
  const tempDir = join(tmpdir(), `xlibrary-${Date.now()}`);
  const tempJSONLPath = join(tempDir, 'recording.jsonl');

  if (!directMode) {
    await mkdir(tempDir, { recursive: true });
  }

  // ── Cleanup temp files + viewer server ───────────────────────────────────
  async function cleanup(): Promise<void> {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    try {
      viewer?.close();
    } catch {
      /* best-effort */
    }
  }

  // =========================================================================
  // Action capture for Replay
  // =========================================================================
  //
  // Live snapshot of every action the user has recorded so the viewer's
  // "Replay" button can drive a separate browser through them.
  //
  //   - Direct mode: read `generator.getCapturedActions()` (populated by our
  //     own RobotFrameworkLanguageGenerator on each Playwright re-render).
  //   - JSONL mode: parse the temp JSONL file and convert each entry back to
  //     an ActionInContext via `jsonlEntryToActionInContext()`.
  //
  // The list is replaced wholesale on each tick.
  let latestActions: ActionInContext[] = [];
  let activeReplay: ReplayController | null = null;

  // =========================================================================
  // DIRECT MODE: recorder writes Robot Framework directly to outputPath.
  // We just tail the output file for live preview.
  // =========================================================================
  let directLineCount = 0;

  async function tailOutputForPreview(): Promise<void> {
    let content: string;
    try {
      content = await readFile(outputPath, 'utf8');
    } catch {
      return;
    }

    const lines = content.split('\n');

    // If the recorder rewrote the file shorter, just reset our cursor.
    if (lines.length < directLineCount) {
      directLineCount = 0;
    }

    const newKwLines = lines
      .slice(directLineCount)
      .filter((l) => l.startsWith('    ') && l.trim() !== '');

    if (!quiet && newKwLines.length > 0) {
      printKeywordPreview(newKwLines);
    }

    directLineCount = lines.length;

    // Push full content to viewer (recorder writes complete file each time).
    viewer?.broadcast(content);

    // Snapshot the action list for the Replay button. xlibrary owns the
    // robot + selenium emitters, so both expose getCapturedActions(). For
    // ts/python the built-in Playwright emitter owns the output — we have
    // no captured action stream there, so Replay is disabled.
    if (lang === 'robot') {
      latestActions = generator.getCapturedActions();
    } else if (lang === 'selenium') {
      latestActions = seleniumGenerator.getCapturedActions();
    }
  }

  // =========================================================================
  // JSONL BRIDGE MODE: translate JSONL → Robot Framework ourselves.
  //
  // Stateless full re-render per tick — Playwright's ThrottledFile mutates the
  // last JSONL entry in place while the user is mid-action (e.g. typing into a
  // `fill`). Any cursor-based "skip what we've already read" strategy captures
  // the FIRST snapshot of that line and misses every later update.
  //
  // Fix: every poll, read JSONL fresh, parse all entries, render with a NEW
  // generator, write the .robot file. The generator is cheap to construct and
  // its internal state (the openPage+navigate collapse flag) is rebuilt from
  // the full entry list each pass.
  //
  // For the live preview we track the lines we last printed and only print
  // newly-added lines on each tick.
  // =========================================================================

  let lastRenderedSteps: string[] = [];

  async function flushOutput(): Promise<void> {
    // ── 1. Read JSONL — with ENOENT retry for atomic-rename races ─────────
    let content: string;
    try {
      content = await readFile(tempJSONLPath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        dlog('flushOutput: ENOENT — likely mid-rename, retrying after 50 ms');
        await sleep(50);
        try {
          content = await readFile(tempJSONLPath, 'utf8');
        } catch (err2) {
          dlog(
            'flushOutput: retry also failed (%s), skipping this tick',
            (err2 as NodeJS.ErrnoException).message,
          );
          return;
        }
      } else {
        dlog('flushOutput: readFile error %s, skipping', code ?? (err as Error).message);
        return;
      }
    }

    if (!content.trim()) {
      dlog('flushOutput: empty content — nothing to render this tick');
      return;
    }

    // ── 2. Parse all entries ───────────────────────────────────────────────
    const entries = parseJsonlContent(content);

    // ── 3. Render with a FRESH generator instance ──────────────────────────
    const freshGen = new RobotFrameworkLanguageGenerator(testName);
    const steps: string[] = [];
    for (const entry of entries) {
      for (const line of jsonlEntryToStepLines(entry, freshGen)) {
        steps.push(line);
      }
    }

    // Snapshot for Replay: rebuild the action list from JSONL entries.
    latestActions = entries
      .map((e) => jsonlEntryToActionInContext(e))
      .filter((a): a is ActionInContext => a !== undefined);

    // ── 4. Terminal preview — print only newly-added steps ─────────────────
    if (!quiet) {
      let firstDiff = 0;
      while (
        firstDiff < lastRenderedSteps.length &&
        firstDiff < steps.length &&
        lastRenderedSteps[firstDiff] === steps[firstDiff]
      ) {
        firstDiff++;
      }
      const newlyChanged = steps.slice(firstDiff);
      if (newlyChanged.length > 0) {
        printKeywordPreview(newlyChanged);
      }
    }

    lastRenderedSteps = steps;

    // ── 5. Write .robot and broadcast to viewer ────────────────────────────
    const header = freshGen.generateHeader(generatorOptions);
    const footer = freshGen.generateFooter(undefined);
    const robotContent = [header, ...steps, footer].join('\n') + '\n';
    await writeFile(outputPath, robotContent, 'utf8');
    viewer?.broadcast(robotContent);
  }

  // =========================================================================
  // Unified periodic work + shutdown (works for both modes)
  // =========================================================================

  // For robot: use directMode to pick between tail (direct) and JSONL bridge.
  // For ts / python / selenium: Playwright's own emitter always writes directly
  // to outputPath — no JSONL bridge needed regardless of bundle-patcher status.
  const periodicWork = lang === 'robot' && !directMode ? flushOutput : tailOutputForPreview;

  // ── Enable the Playwright recorder ────────────────────────────────────────
  const contextWithRecorder = context as unknown as BrowserContextWithRecorder;

  // For `robot` in direct mode or JSONL fallback, use the existing split.
  // For `ts` / `python` / `selenium` we always write to the output file directly
  // using Playwright's own built-in emitter — no JSONL bridge needed.
  const playwrightLangId = langToPlaywrightId(lang, directMode);
  const recorderOutputFile = lang === 'robot' && !directMode ? tempJSONLPath : outputPath;

  await contextWithRecorder._enableRecorder({
    language: playwrightLangId,
    mode: 'recording',
    outputFile: recorderOutputFile,
    launchOptions: {},
    contextOptions: {},
    handleSIGINT: false,
  });

  // ── Open the starting URL (if provided) ───────────────────────────────────
  if (url) {
    const page = await context.newPage();
    const normalised =
      url.startsWith('http') || url.startsWith('file://') || url.startsWith('about:')
        ? url
        : `https://${url}`;
    await page.goto(normalised);
  }

  // ── Wire up Replay buttons (viewer → replay engine) ───────────────────────
  if (viewer) {
    const viewerInScope = viewer;
    viewer.setCommandHandler(async (cmd: ReplayCommand) => {
      switch (cmd.type) {
        case 'replay-start': {
          if (activeReplay) {
            await activeReplay.stop().catch(() => {
              /* ignore */
            });
            activeReplay = null;
          }
          if (latestActions.length === 0) {
            viewerInScope.broadcastReplayState({
              status: 'error',
              currentIndex: -1,
              totalActions: 0,
              errorMessage: 'No actions recorded yet — interact with the recorder window first.',
            });
            return;
          }
          const ctrl = createReplayController({
            actions: latestActions,
            browserName: browserName,
            stepDelayMs: 600,
          });
          ctrl.onStateChange((state) => viewerInScope.broadcastReplayState(state));
          activeReplay = ctrl;
          await ctrl.start();
          break;
        }
        case 'replay-pause':
          activeReplay?.pause();
          break;
        case 'replay-resume':
          activeReplay?.resume();
          break;
        case 'replay-step':
          activeReplay?.step();
          break;
        case 'replay-stop': {
          if (activeReplay) {
            await activeReplay.stop();
            activeReplay = null;
          }
          break;
        }
      }
    });
  }

  // Describe the recording mode in the banner in a language-aware way.
  const modeDescription: string = (() => {
    if (lang === 'robot') {
      return directMode ? 'direct (Inspector shows Robot Framework)' : 'JSONL bridge';
    }
    // ts / python / selenium: Playwright's built-in emitter runs direct.
    return `direct (Playwright built-in: ${playwrightLangId})`;
  })();

  console.log(
    `\n🤖 xlibrary codegen — recording in progress`,
    `\n   Language: ${langLabel(lang)}`,
    `\n   Mode    : ${modeDescription}`,
    `\n   Output  : ${outputPath}`,
    viewer
      ? autoOpenViewer
        ? `\n   Viewer  : ${viewer.url}  (opening in browser… — Replay button enabled there)`
        : `\n   Viewer  : ${viewer.url}  (click "📊 Open Live Preview" in Inspector to open)`
      : `\n   Viewer  : off (--no-viewer)`,
    `\n   Preview : ${quiet ? 'off (--quiet)' : 'on — each recorded keyword prints below'}`,
    `\n   On exit : ${openAfter ? 'open file in editor (--open)' : 'no editor launch'}`,
    `\n   Close the browser window or press Ctrl+C to finish.\n`,
  );

  // ── Poll every 400 ms ─────────────────────────────────────────────────────
  const pollInterval = setInterval(() => {
    periodicWork().catch(() => {
      /* ignore transient I/O errors */
    });
  }, 400);

  // ── Wait for browser to disconnect ────────────────────────────────────────
  const donePromise = new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve());
  });

  // =========================================================================
  // Unified shutdown — MUST be called from both SIGINT and browser-disconnect.
  //
  // Critical ordering (fixes ENOENT crash + missing-actions bug):
  //   1. browser.close() FIRST  → triggers ThrottledFile.flush() (writes buffered JSONL)
  //   2. sleep(200)             → grace period for the synchronous writeFileSync inside flush
  //   3. flushOutput()          → reads the now-complete JSONL, catches every buffered action
  //   4. cleanup()              → rm tempDir LAST (ThrottledFile is done by now)
  //
  // Guard: isShuttingDown prevents double-execution when SIGINT fires while the
  // browser-disconnect path is already running (browser.close() in SIGINT triggers
  // the 'disconnected' event which would otherwise kick off a second shutdown).
  // =========================================================================
  let isShuttingDown = false;

  async function shutdown(label: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    clearInterval(pollInterval);
    console.log(`\n${label}`);

    // Stop any in-flight replay first — its browser is independent of the
    // recording browser and otherwise leaks if the user Ctrl+C's mid-replay.
    if (activeReplay) {
      try {
        await activeReplay.stop();
      } catch {
        /* best-effort */
      }
      activeReplay = null;
    }

    // Step 1 — close browser (triggers ThrottledFile.flush() for buffered JSONL).
    // Must happen BEFORE cleanup() deletes tempDir — otherwise ThrottledFile's
    // writeFileSync inside the close handler targets a deleted path → ENOENT crash.
    try {
      await browser.close();
      dlog('shutdown: browser.close() completed');
    } catch {
      // Already closed (user clicked the window X) — safe to continue.
    }

    // Step 2 — grace period so ThrottledFile's synchronous write can complete.
    // Only needed for the JSONL bridge (robot target, bundle-patcher miss).
    // For ts/python/selenium Playwright writes directly to outputPath — no temp file.
    if (lang === 'robot' && !directMode) {
      dlog('shutdown: sleeping 200 ms for ThrottledFile grace period');
      await sleep(200);
    }

    // Step 3 — final read of the now-complete JSONL / output file.
    dlog('shutdown: performing final flush (last render=%d steps)', lastRenderedSteps.length);
    let finalFlushFailed = false;
    await periodicWork().catch((err: unknown) => {
      // Final flush is the LAST chance to write buffered actions to disk.
      // Silencing a failure here means we'd print "✅ Saved" against an
      // incomplete file — actively misleading. Surface loudly.
      finalFlushFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌  Final flush failed — output may be incomplete: ${msg}`);
      dlog('shutdown: final periodicWork error: %s', err instanceof Error ? err.stack : err);
    });
    dlog('shutdown: final flush done (last render=%d steps)', lastRenderedSteps.length);

    if (finalFlushFailed) {
      console.log(`⚠️  Saved (with errors): ${outputPath}`);
    } else {
      console.log(`✅  Saved: ${outputPath}`);
    }

    // Step 3b — write JSONL artifact (--save-actions)
    if (artifactPath) {
      try {
        const header = buildArtifactHeader(browserName, testName);

        let artifactContent: string;
        if (directMode) {
          // Direct mode: generator has captured all actions internally.
          artifactContent = buildArtifactContent(header, latestActions);
        } else {
          // JSONL bridge mode: the temp file already has all action lines.
          // Re-read it one last time (final flush already ran, so it's complete).
          let tempContent = '';
          try {
            tempContent = await readFile(tempJSONLPath, 'utf8');
          } catch {
            // Temp file may have been deleted already or never written (empty session).
            // Fall back to building from latestActions.
          }
          if (tempContent.trim()) {
            artifactContent = buildArtifactFromBridgeContent(header, tempContent);
          } else {
            artifactContent = buildArtifactContent(header, latestActions);
          }
        }

        // Ensure the parent directory exists (user may specify a nested path).
        await mkdir(dirname(artifactPath), { recursive: true });
        await writeFile(artifactPath, artifactContent, 'utf8');
        console.log(`📄  Actions saved: ${artifactPath}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ⚠  Could not write JSONL artifact (${artifactPath}): ${msg}`);
      }
    }

    if (openAfter && existsSync(outputPath)) {
      console.log(`📂  Opening in editor: ${outputPath}`);
      openInEditor(outputPath);
    }

    // ── Test Data Wizard post-record hook (Task #13 + #14) ──────────────────
    // The orchestrator handles the interactive confirm prompt; quiet mode
    // is respected (--quiet suppresses the diff preview and skips the prompt).
    if (doExtractData && latestActions.length > 0) {
      try {
        // Dynamic import — avoids pulling the wizard into the hot path when
        // --extract-data is not used.
        const { runExtractionOnActions } = await import('../wizard/extract-orchestrator.js');
        await runExtractionOnActions({
          sourceFile: outputPath,
          actions: latestActions,
          yes: quiet, // --quiet implies non-interactive (skip confirm prompt)
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  ⚠  --extract-data failed: ${msg}`);
        console.error('     The output file was saved; extraction can be retried with:');
        console.error(`     xlibrary extract ${outputPath}`);
      }
    }

    // Step 4 — delete tempDir and close viewer server.
    // tempDir is deleted LAST — only after ThrottledFile has finished all writes.
    await cleanup();
  }

  // ── Signal handlers ───────────────────────────────────────────────────────
  // Cover SIGINT (Ctrl+C), SIGTERM (kill / process manager), and SIGHUP
  // (terminal closed). Without SIGTERM/SIGHUP, those signals leak the temp
  // dir + viewer port and skip the final JSONL flush.
  const stopSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const sig of stopSignals) {
    process.once(sig, () => {
      void shutdown(`\n\n⏹  Recording stopped (${sig}) — finalising…`).then(() => {
        // POSIX convention: exit code 128 + signal number.
        const sigNo = sig === 'SIGINT' ? 2 : sig === 'SIGTERM' ? 15 : 1;
        process.exit(128 + sigNo);
      });
    });
  }

  // ── Wait for browser disconnect ───────────────────────────────────────────
  await donePromise;
  await shutdown('\n⏹  Browser closed — finalising…');

  if (!existsSync(outputPath)) {
    throw new Error(`runner.ts: expected output file was not created — path: ${outputPath}`);
  }
}
