/**
 * replay-engine.ts
 *
 * Executes a previously-recorded Playwright action stream in a FRESH browser
 * window, with play / pause / step / stop controls. This is the "test before
 * you commit" loop — verify your recording does what you expect WITHOUT
 * having to spin up a Robot Framework runtime.
 *
 * Design:
 *   - One controller per replay session.
 *   - `start()` launches a Playwright browser and kicks off an internal
 *     async loop that walks the action list.
 *   - Before each action the loop checks pause/step flags and may suspend
 *     on a Promise that the next `resume()` / `step()` call resolves.
 *   - State changes are delivered to subscribers via `onStateChange`.
 *
 * Why a fresh browser (not the recording browser):
 *   The recording browser still has the Inspector overlay attached; replay
 *   actions there would race with the recorder's own event handlers. A
 *   separate window avoids that and lets the user keep recording / replaying
 *   side-by-side.
 */

import { chromium, firefox, webkit } from 'playwright-core';
import type { Browser, BrowserContext, Page, BrowserType } from 'playwright-core';
import { debuglog } from 'node:util';
import type { ActionInContext, Action } from '../types.js';
import { decodeModifiers, formatKeyWithModifiers } from '../codegen/keyboard-modifiers.js';

const dlog = debuglog('xlibrary');

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type ReplayStatus =
  | 'idle' // start() not called yet
  | 'running' // executing actions automatically
  | 'paused' // suspended between actions, waiting for resume/step
  | 'complete' // walked through all actions without error
  | 'error' // an action threw and replay stopped
  | 'stopped'; // user called stop()

export interface ReplayState {
  status: ReplayStatus;
  currentIndex: number; // 0-based; -1 before first action begins
  totalActions: number; // total in queue when start() was called
  currentName?: string; // action name being executed / last completed
  errorMessage?: string; // populated when status === 'error'
}

export interface ReplayController {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  step(): void;
  stop(): Promise<void>;
  getState(): ReplayState;
  onStateChange(cb: (state: ReplayState) => void): () => void;
}

export interface ReplayOptions {
  /** Ordered action list to replay. */
  actions: ActionInContext[];
  /** Playwright browser engine (defaults to chromium). */
  browserName?: 'chromium' | 'firefox' | 'webkit';
  /** Start in paused state so the user steps through manually. Default false. */
  startPaused?: boolean;
  /** Milliseconds to wait between actions in 'running' mode (default 500). */
  stepDelayMs?: number;
  /** Per-action timeout in ms (default 5000). */
  actionTimeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/** Select a Playwright BrowserType by name. */
function selectBrowserType(name: ReplayOptions['browserName']): BrowserType {
  switch (name) {
    case 'firefox':
      return firefox;
    case 'webkit':
      return webkit;
    default:
      return chromium;
  }
}

/**
 * Build a replay controller. Does NOT launch the browser yet — `start()`
 * does. Subscribers attached via `onStateChange` get an immediate `idle`
 * snapshot so the UI can render the initial total-actions count.
 */
export function createReplayController(opts: ReplayOptions): ReplayController {
  const stepDelayMs = opts.stepDelayMs ?? 500;
  const actionTimeoutMs = opts.actionTimeoutMs ?? 5000;
  const browserType = selectBrowserType(opts.browserName);
  const totalActions = opts.actions.length;

  let state: ReplayState = {
    status: 'idle',
    currentIndex: -1,
    totalActions,
  };

  const subscribers = new Set<(s: ReplayState) => void>();
  let pauseGate: { resolve: () => void } | null = null;
  let stepRequested = false;
  let stopRequested = false;
  let browser: Browser | null = null;
  let ctx: BrowserContext | null = null;
  let page: Page | null = null;
  let loopRunning = false;

  function setState(patch: Partial<ReplayState>): void {
    state = { ...state, ...patch };
    for (const cb of subscribers) {
      try {
        cb(state);
      } catch (err) {
        dlog('replay: subscriber threw: %s', err instanceof Error ? err.message : err);
      }
    }
  }

  function waitForGate(): Promise<void> {
    return new Promise((resolve) => {
      pauseGate = { resolve };
    });
  }

  function openGate(): void {
    if (pauseGate) {
      pauseGate.resolve();
      pauseGate = null;
    }
  }

  // ── runLoop: the heart of the controller ──────────────────────────────────
  async function runLoop(): Promise<void> {
    if (!page) return;
    loopRunning = true;
    try {
      for (let i = 0; i < opts.actions.length; i++) {
        if (stopRequested) break;

        const entry = opts.actions[i];
        setState({
          currentIndex: i,
          currentName: entry.action.name,
          status: state.status === 'paused' ? 'paused' : 'running',
        });

        // Pause-gate before executing the action.
        if (state.status === 'paused') {
          await waitForGate();
          if (stopRequested) break;
        }

        try {
          await executeAction(page, entry, actionTimeoutMs);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setState({ status: 'error', errorMessage: `action "${entry.action.name}" — ${msg}` });
          return;
        }

        // If step was requested, pause AFTER this action.
        if (stepRequested) {
          stepRequested = false;
          setState({ status: 'paused' });
          continue; // next iter will pause at the gate
        }

        // Auto-pace between actions when running normally.
        if (stepDelayMs > 0) await sleep(stepDelayMs);
      }

      if (!stopRequested && state.status !== 'error') {
        setState({ status: 'complete' });
      }
    } finally {
      loopRunning = false;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  const ctrl: ReplayController = {
    async start() {
      if (state.status !== 'idle') {
        throw new Error(`Replay already started (status=${state.status})`);
      }
      if (totalActions === 0) {
        setState({ status: 'complete' });
        return;
      }
      try {
        browser = await browserType.launch({ headless: false });
        ctx = await browser.newContext();
        page = await ctx.newPage();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', errorMessage: `failed to launch browser: ${msg}` });
        return;
      }

      setState({
        status: opts.startPaused ? 'paused' : 'running',
        currentIndex: -1,
      });

      // Fire-and-forget; the loop drives state changes from within.
      runLoop().catch((err) => {
        dlog('replay: runLoop threw: %s', err instanceof Error ? err.stack : err);
        setState({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });
    },

    pause() {
      if (state.status !== 'running' && state.status !== 'paused') return;
      setState({ status: 'paused' });
    },

    resume() {
      if (state.status !== 'paused') return;
      stepRequested = false;
      setState({ status: 'running' });
      openGate();
    },

    step() {
      // step() is meaningful both from paused (advance one) and from running
      // (request a single-action stop after the current). For simplicity we
      // only support the paused-case explicitly.
      if (state.status === 'paused') {
        stepRequested = true;
        // status stays 'paused' visually; runLoop will set 'running' for the
        // one action, then back to 'paused' via stepRequested branch.
        openGate();
      } else if (state.status === 'running') {
        stepRequested = true;
      }
    },

    async stop() {
      if (state.status === 'stopped') return;
      stopRequested = true;
      openGate();

      // Give the loop up to 200 ms to exit cleanly.
      const deadline = Date.now() + 200;
      while (loopRunning && Date.now() < deadline) {
        await sleep(20);
      }

      try {
        await browser?.close();
      } catch {
        /* ignore */
      }
      browser = null;
      ctx = null;
      page = null;
      setState({ status: 'stopped' });
    },

    getState() {
      return state;
    },

    onStateChange(cb) {
      subscribers.add(cb);
      // Send current snapshot immediately so UI doesn't need a separate poll.
      try {
        cb(state);
      } catch {
        /* ignore */
      }
      return () => subscribers.delete(cb);
    },
  };

  return ctrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a single recorded action against the live Page.
 *
 * Playwright's Locator API accepts the same selector format the recorder
 * emits (`internal:role=…`, `internal:text=…`, etc.), so no selector
 * translation is needed here — we hand it straight back.
 *
 * Assertions are best-effort during replay: a failed assertion logs but
 * does NOT abort the replay (the user is verifying flow, not asserting
 * correctness yet). Hard failures (element missing for click) DO abort.
 */
async function executeAction(page: Page, ctx: ActionInContext, timeoutMs: number): Promise<void> {
  const action = ctx.action as Action & {
    name: string;
    selector?: string;
    url?: string;
    text?: string;
    key?: string;
    options?: string[];
    files?: string[];
    value?: string;
    checked?: boolean;
    clickCount?: number;
    modifiers?: number;
    substring?: boolean;
  };

  switch (action.name) {
    case 'openPage':
      // Playwright records an openPage(url=about:blank) when the recording
      // tab is first created. The replay browser already has its own first
      // page; we skip the blank one and let the next navigate handle the URL.
      if (action.url && action.url !== 'about:blank' && action.url !== 'chrome://newtab/') {
        await page.goto(action.url, { timeout: timeoutMs });
      }
      return;

    case 'navigate':
      await page.goto(action.url, { timeout: timeoutMs });
      return;

    case 'closePage':
      // Don't actually close — we want the page alive for inspection at the
      // end of the replay. Closing also kills any subsequent re-runs.
      return;

    case 'click': {
      const loc = page.locator(action.selector);
      const clickOptions: {
        timeout: number;
        clickCount?: number;
        modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
      } = { timeout: timeoutMs };
      if (action.clickCount === 2) clickOptions.clickCount = 2;
      const mods = decodeModifiers(action.modifiers ?? 0);
      if (mods.length) clickOptions.modifiers = mods;
      await loc.click(clickOptions);
      return;
    }

    case 'fill':
      await page.locator(action.selector).fill(action.text ?? '', { timeout: timeoutMs });
      return;

    case 'press':
      await page
        .locator(action.selector)
        .press(formatKeyWithModifiers(action.key, action.modifiers ?? 0), { timeout: timeoutMs });
      return;

    case 'check':
      await page.locator(action.selector).check({ timeout: timeoutMs });
      return;

    case 'uncheck':
      await page.locator(action.selector).uncheck({ timeout: timeoutMs });
      return;

    case 'select':
      await page
        .locator(action.selector)
        .selectOption(action.options ?? [], { timeout: timeoutMs });
      return;

    case 'hover':
      await page.locator(action.selector).hover({ timeout: timeoutMs });
      return;

    case 'setInputFiles':
      await page.locator(action.selector).setInputFiles(action.files ?? [], { timeout: timeoutMs });
      return;

    // Assertions are visualised (we wait for the element) but failures are
    // not treated as fatal — replay continues.
    case 'assertVisible':
      await page
        .locator(action.selector)
        .waitFor({ state: 'visible', timeout: timeoutMs })
        .catch(() => {
          /* best effort */
        });
      return;

    case 'assertText':
    case 'assertValue':
    case 'assertChecked':
      await page
        .locator(action.selector)
        .waitFor({ state: 'attached', timeout: timeoutMs })
        .catch(() => {
          /* best effort */
        });
      return;

    case 'assertSnapshot':
      // No replay-time validation needed — this is an ARIA snapshot diff.
      return;

    default: {
      // Exhaustiveness sentinel — every Action variant has a case above.
      // The cast keeps the dlog runtime-useful if a new variant slips in
      // before this switch is updated.
      const _exhaustive: never = action;
      void _exhaustive;
      const stray = action as { name?: string };
      dlog('replay: skipping unsupported action %s', stray.name ?? '?');
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
