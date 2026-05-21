/**
 * Tests for the replay engine.
 *
 * The engine launches a real Playwright browser, so these are integration
 * tests, not unit tests. We minimise their cost by:
 *   - Serving a tiny static HTML page locally (no internet)
 *   - Using a short `stepDelayMs` (50 ms) so each replay finishes fast
 *   - Closing the browser deterministically via stop() in afterEach
 *
 * Each test asserts on observable BEHAVIOUR (state transitions, final
 * status) rather than internal flags — that keeps tests robust against
 * future refactors of the engine internals.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';

import {
  createReplayController,
  type ReplayController,
  type ReplayState,
} from '../src/replay/replay-engine.js';
import type { ActionInContext } from '../src/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Local test fixture: a one-page server with input + button
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_HTML = `<!DOCTYPE html><html><body>
<h1 id="hi">Hello</h1>
<input id="name" type="text" placeholder="Name">
<button id="go" onclick="document.getElementById('hi').textContent='Clicked: '+document.getElementById('name').value">Go</button>
</body></html>`;

async function startTestServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_, res) => res.end(PAGE_HTML));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${addr.port}/` };
}

function mkAction(action: Record<string, unknown>): ActionInContext {
  return {
    frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
    action: { signals: [], ...action } as unknown as ActionInContext['action'],
    startTime: 0,
  };
}

/** Wait until predicate is true on the current state, or timeout. */
async function waitForState(
  ctrl: ReplayController,
  predicate: (s: ReplayState) => boolean,
  timeoutMs = 8_000,
): Promise<ReplayState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = ctrl.getState();
    if (predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitForState: timeout — last status=${ctrl.getState().status}`);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('replay-engine', () => {
  let server: Server;
  let url: string;
  let ctrl: ReplayController | null = null;

  beforeEach(async () => {
    ({ server, url } = await startTestServer());
  });

  afterEach(async () => {
    if (ctrl) {
      await ctrl.stop().catch(() => {
        /* ignore */
      });
      ctrl = null;
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('walks through a navigate → fill → click → assertText sequence to completion', async () => {
    const actions: ActionInContext[] = [
      mkAction({ name: 'navigate', url }),
      mkAction({ name: 'fill', selector: 'css=#name', text: 'Axe' }),
      mkAction({ name: 'click', selector: 'css=#go', clickCount: 1, button: 'left', modifiers: 0 }),
      mkAction({ name: 'assertText', selector: 'css=#hi', text: 'Clicked: Axe', substring: false }),
    ];

    ctrl = createReplayController({ actions, stepDelayMs: 50, actionTimeoutMs: 3000 });
    await ctrl.start();
    const final = await waitForState(ctrl, (s) => s.status === 'complete' || s.status === 'error');

    expect(final.status).toBe('complete');
    expect(final.currentIndex).toBe(actions.length - 1);
  }, 20_000);

  it('emits state transitions in order: idle → running → … → complete', async () => {
    const actions: ActionInContext[] = [
      mkAction({ name: 'navigate', url }),
      mkAction({ name: 'fill', selector: 'css=#name', text: 'X' }),
    ];

    const seen: ReplayState['status'][] = [];
    ctrl = createReplayController({ actions, stepDelayMs: 30, actionTimeoutMs: 3000 });
    ctrl.onStateChange((s) => seen.push(s.status));
    await ctrl.start();
    await waitForState(ctrl, (s) => s.status === 'complete' || s.status === 'error');

    expect(seen[0]).toBe('idle'); // first snapshot
    expect(seen).toContain('running');
    expect(seen[seen.length - 1]).toBe('complete');
  }, 20_000);

  it('starts in paused state when startPaused=true', async () => {
    const actions: ActionInContext[] = [mkAction({ name: 'navigate', url })];

    ctrl = createReplayController({
      actions,
      startPaused: true,
      stepDelayMs: 30,
      actionTimeoutMs: 3000,
    });
    await ctrl.start();
    const paused = await waitForState(ctrl, (s) => s.status === 'paused');
    expect(paused.status).toBe('paused');
  }, 20_000);

  it('step() advances exactly one action and pauses again', async () => {
    const actions: ActionInContext[] = [
      mkAction({ name: 'navigate', url }),
      mkAction({ name: 'fill', selector: 'css=#name', text: 'A' }),
      mkAction({ name: 'fill', selector: 'css=#name', text: 'AB' }),
    ];

    ctrl = createReplayController({
      actions,
      startPaused: true,
      stepDelayMs: 30,
      actionTimeoutMs: 3000,
    });
    await ctrl.start();
    await waitForState(ctrl, (s) => s.status === 'paused');

    ctrl.step();
    // After stepping, we should advance past 0 and pause again.
    const afterStep = await waitForState(ctrl, (s) => s.status === 'paused' && s.currentIndex >= 1);
    expect(afterStep.status).toBe('paused');
    expect(afterStep.currentIndex).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('resume() runs to completion from paused state', async () => {
    const actions: ActionInContext[] = [
      mkAction({ name: 'navigate', url }),
      mkAction({ name: 'fill', selector: 'css=#name', text: 'X' }),
    ];

    ctrl = createReplayController({
      actions,
      startPaused: true,
      stepDelayMs: 30,
      actionTimeoutMs: 3000,
    });
    await ctrl.start();
    await waitForState(ctrl, (s) => s.status === 'paused');

    ctrl.resume();
    const final = await waitForState(ctrl, (s) => s.status === 'complete' || s.status === 'error');
    expect(final.status).toBe('complete');
  }, 20_000);

  it('stop() transitions to stopped status and halts execution', async () => {
    const actions: ActionInContext[] = [
      mkAction({ name: 'navigate', url }),
      mkAction({ name: 'fill', selector: 'css=#name', text: 'X' }),
    ];

    ctrl = createReplayController({
      actions,
      startPaused: true,
      stepDelayMs: 30,
      actionTimeoutMs: 3000,
    });
    await ctrl.start();
    await waitForState(ctrl, (s) => s.status === 'paused');

    await ctrl.stop();
    expect(ctrl.getState().status).toBe('stopped');
  }, 20_000);

  it('errors on failing action surface via status=error', async () => {
    // Bad selector → click will time out → action throws → status='error'.
    const actions: ActionInContext[] = [
      mkAction({ name: 'navigate', url }),
      mkAction({
        name: 'click',
        selector: 'css=#nonexistent',
        clickCount: 1,
        button: 'left',
        modifiers: 0,
      }),
    ];

    ctrl = createReplayController({ actions, stepDelayMs: 30, actionTimeoutMs: 800 });
    await ctrl.start();
    const final = await waitForState(
      ctrl,
      (s) => s.status === 'error' || s.status === 'complete',
      15_000,
    );
    expect(final.status).toBe('error');
    expect(final.errorMessage).toBeTruthy();
  }, 25_000);
});
