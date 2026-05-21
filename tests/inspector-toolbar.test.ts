/**
 * Inspector toolbar integration test.
 *
 * The 5-button toolbar (Replay / Pause / Resume / Step / Stop) is injected
 * by `buildInspectorInjection()` into the Playwright Inspector's HTML.
 * Because the Inspector lives in a separate chromium process we can't drive
 * from this test, we INSTEAD render the same HTML payload in a Playwright
 * context we control and verify two contracts:
 *
 *   1. Each button click sends the expected `replay-*` command to our
 *      viewer-server (via the WebSocket the injected JS opens).
 *   2. Incoming `replay-state` broadcasts from the server flip the button
 *      enable/disable matrix appropriately.
 *
 * This stays one step removed from the real Inspector, but it tests the
 * actual injection bytes — drift between the toolbar code and this test is
 * impossible because we reuse `buildInspectorInjection()` directly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { buildInspectorInjection } from '../src/recorder/runner.js';
import {
  startViewerServer,
  type ViewerServer,
  type ReplayCommand,
} from '../src/recorder/viewer-server.js';

describe('Inspector toolbar (5-button replay controls)', () => {
  let viewer: ViewerServer;
  let received: string[];
  let browser: Browser;
  let ctx: BrowserContext;
  let page: Page;

  beforeEach(async () => {
    received = [];
    viewer = await startViewerServer();
    viewer.setCommandHandler((cmd: ReplayCommand) => {
      received.push(cmd.type);
    });

    browser = await chromium.launch({ headless: true });
    ctx = await browser.newContext();
    page = await ctx.newPage();

    // Wrap the injection in a minimal HTML doc so it can stand alone.
    const injection = buildInspectorInjection(viewer.url);
    await page.setContent(`<!DOCTYPE html><html><body>${injection}</body></html>`);

    // Wait for the toolbar to mount and the WebSocket to connect.
    // The badge transitions from `offline` to `idle` once `ws.onopen` fires.
    await page.waitForFunction(
      () => document.getElementById('xlib-badge')?.textContent === 'idle',
      null,
      { timeout: 5000 },
    );
  });

  afterEach(async () => {
    await browser?.close();
    viewer?.close();
  });

  it('renders all 5 toolbar buttons', async () => {
    const ids = ['xlib-replay', 'xlib-pause', 'xlib-resume', 'xlib-step', 'xlib-stop'];
    for (const id of ids) {
      const exists = await page.locator(`#${id}`).count();
      expect(exists, `button #${id} should exist`).toBe(1);
    }
  });

  it('starts with only Replay enabled (others disabled until running/paused)', async () => {
    expect(await page.locator('#xlib-replay').isDisabled()).toBe(false);
    expect(await page.locator('#xlib-pause').isDisabled()).toBe(true);
    expect(await page.locator('#xlib-resume').isDisabled()).toBe(true);
    expect(await page.locator('#xlib-step').isDisabled()).toBe(true);
    expect(await page.locator('#xlib-stop').isDisabled()).toBe(true);
  });

  it('sends replay-start when Replay button is clicked', async () => {
    await page.click('#xlib-replay');
    await page.waitForTimeout(150);
    expect(received).toContain('replay-start');
  });

  it('sends each command in order when its button is clicked', async () => {
    // Stage state transitions server→client so the buttons become enabled.
    // Driving via broadcastReplayState avoids running an actual replay browser.
    viewer.broadcastReplayState({
      status: 'running',
      currentIndex: 0,
      totalActions: 3,
      currentName: 'navigate',
    });
    await page.waitForFunction(
      () => !document.getElementById('xlib-pause')?.hasAttribute('disabled'),
      null,
      { timeout: 3000 },
    );
    await page.click('#xlib-pause');

    viewer.broadcastReplayState({
      status: 'paused',
      currentIndex: 0,
      totalActions: 3,
      currentName: 'navigate',
    });
    await page.waitForFunction(
      () => !document.getElementById('xlib-resume')?.hasAttribute('disabled'),
      null,
      { timeout: 3000 },
    );
    await page.click('#xlib-resume');
    await page.click('#xlib-step');

    viewer.broadcastReplayState({
      status: 'running',
      currentIndex: 1,
      totalActions: 3,
      currentName: 'fill',
    });
    await page.waitForFunction(
      () => !document.getElementById('xlib-stop')?.hasAttribute('disabled'),
      null,
      { timeout: 3000 },
    );
    await page.click('#xlib-stop');

    // Allow socket flush.
    await page.waitForTimeout(200);

    // Replay-start NOT in this scenario; we only test pause/resume/step/stop.
    expect(received).toEqual(['replay-pause', 'replay-resume', 'replay-step', 'replay-stop']);
  });

  it('updates the badge text on incoming replay-state messages', async () => {
    viewer.broadcastReplayState({
      status: 'running',
      currentIndex: 2,
      totalActions: 5,
      currentName: 'click',
    });
    await page.waitForFunction(
      () => document.getElementById('xlib-badge')?.textContent === 'running',
      null,
      { timeout: 3000 },
    );
    const badgeText = await page.locator('#xlib-badge').textContent();
    expect(badgeText).toBe('running');

    const progress = await page.locator('#xlib-progress').textContent();
    expect(progress).toBe('click • 3 / 5');
  });

  it('flips button enable/disable based on incoming status', async () => {
    // paused → Resume + Step + Stop enabled, others disabled
    viewer.broadcastReplayState({ status: 'paused', currentIndex: 1, totalActions: 5 });
    await page.waitForFunction(
      () => document.getElementById('xlib-resume')?.hasAttribute('disabled') === false,
      null,
      { timeout: 3000 },
    );
    expect(await page.locator('#xlib-replay').isDisabled()).toBe(true);
    expect(await page.locator('#xlib-pause').isDisabled()).toBe(true);
    expect(await page.locator('#xlib-resume').isDisabled()).toBe(false);
    expect(await page.locator('#xlib-step').isDisabled()).toBe(false);
    expect(await page.locator('#xlib-stop').isDisabled()).toBe(false);

    // running → Pause + Step + Stop enabled
    viewer.broadcastReplayState({ status: 'running', currentIndex: 2, totalActions: 5 });
    await page.waitForFunction(
      () => document.getElementById('xlib-pause')?.hasAttribute('disabled') === false,
      null,
      { timeout: 3000 },
    );
    expect(await page.locator('#xlib-pause').isDisabled()).toBe(false);
    expect(await page.locator('#xlib-step').isDisabled()).toBe(false);
    expect(await page.locator('#xlib-stop').isDisabled()).toBe(false);

    // complete → only Replay enabled again
    viewer.broadcastReplayState({ status: 'complete', currentIndex: 4, totalActions: 5 });
    await page.waitForFunction(
      () => document.getElementById('xlib-replay')?.hasAttribute('disabled') === false,
      null,
      { timeout: 3000 },
    );
    expect(await page.locator('#xlib-replay').isDisabled()).toBe(false);
  });
});
