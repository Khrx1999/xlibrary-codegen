/**
 * Regression tests for the JSONL→steps pipeline in `src/recorder/runner.ts`.
 *
 * The runner uses a STATELESS full re-render strategy: every poll, it re-reads
 * the entire JSONL file, re-parses all entries, and re-renders them through a
 * fresh generator. This handles Playwright's ThrottledFile behaviour where the
 * LAST entry in the JSONL is mutated in place while the user is mid-action
 * (e.g. while typing into a `fill`, the `text` field of that line grows
 * letter-by-letter — same line index, not appended).
 *
 * These tests reproduce the read loop in isolation so the rendering correctness
 * is testable without launching a browser.
 */

import { describe, it, expect } from 'vitest';

/**
 * Faithful re-implementation of the stateless render loop in `flushOutput`
 * (src/recorder/runner.ts). Inputs: a stream of full JSONL snapshots the
 * recorder would write. Output: the rendered action names from the LAST
 * snapshot only (which is what gets written to the .robot file at the end).
 */
function renderEachTick(snapshots: string[]): string[][] {
  const renders: string[][] = [];

  for (const content of snapshots) {
    if (!content.trim()) {
      // Empty content tick — preserve last render
      renders.push(renders.length > 0 ? renders[renders.length - 1] : []);
      continue;
    }

    const rawLines = content.split('\n');
    const entries: Array<{ name?: string; text?: string }> = [];
    for (let i = 1; i < rawLines.length; i++) {
      const raw = rawLines[i].trim();
      if (!raw) continue;
      try {
        entries.push(JSON.parse(raw) as { name?: string; text?: string });
      } catch {
        // skip malformed
      }
    }

    // Render each entry to a step descriptor — for the test we render to a
    // simple "name(text?)" string so we can assert on both shape and content.
    const steps = entries
      .filter((e) => !!e.name)
      .map((e) => (e.text !== undefined ? `${e.name}(${e.text})` : e.name!));
    renders.push(steps);
  }

  return renders;
}

const HEADER = JSON.stringify({ browserName: 'chromium' });

function snapshot(actions: string[]): string {
  return [HEADER, ...actions].join('\n') + '\n';
}

describe('runner.ts JSONL render loop — stateless re-render', () => {
  it('captures every action when Playwright appends one per tick', () => {
    const actions = [
      '{"name":"openPage","url":"about:blank"}',
      '{"name":"navigate","url":"https://example.com"}',
      '{"name":"click","selector":"button#a"}',
      '{"name":"click","selector":"button#b"}',
      '{"name":"click","selector":"button#c"}',
      '{"name":"closePage"}',
    ];

    const ticks = actions.map((_, i) => snapshot(actions.slice(0, i + 1)));
    const renders = renderEachTick(ticks);

    // Final tick should contain all 6 actions in order.
    expect(renders[renders.length - 1]).toEqual([
      'openPage',
      'navigate',
      'click',
      'click',
      'click',
      'closePage',
    ]);
  });

  it('captures every action when batched into one tick', () => {
    const actions = [
      '{"name":"openPage","url":"about:blank"}',
      '{"name":"navigate","url":"https://example.com"}',
      '{"name":"click","selector":"#x"}',
      '{"name":"fill","selector":"#y","text":"abc"}',
    ];

    const renders = renderEachTick([snapshot(actions)]);
    expect(renders[0]).toEqual(['openPage', 'navigate', 'click', 'fill(abc)']);
  });

  it('CRITICAL: captures final fill text when ThrottledFile mutates the line in place', () => {
    // Simulate Playwright recorder behaviour: user types "hello" letter by letter,
    // recorder rewrites the SAME fill entry with growing text on every keystroke.
    // The cursor-based implementation would have captured only "h" — the very
    // first snapshot — and never re-read the mutated line. Stateless re-render
    // must always reflect the LATEST text value.
    const partialFills = ['h', 'he', 'hel', 'hell', 'hello'];
    const ticks = partialFills.map((text) =>
      snapshot([
        '{"name":"openPage","url":"about:blank"}',
        '{"name":"navigate","url":"https://example.com"}',
        `{"name":"fill","selector":"#input","text":"${text}"}`,
      ]),
    );
    const renders = renderEachTick(ticks);

    // After the last tick the final render must contain `fill(hello)`, not `fill(h)`.
    expect(renders[renders.length - 1]).toEqual(['openPage', 'navigate', 'fill(hello)']);
  });

  it('handles file shrink gracefully (no orphaned steps)', () => {
    const full = snapshot([
      '{"name":"openPage","url":"about:blank"}',
      '{"name":"navigate","url":"https://example.com"}',
      '{"name":"click","selector":"#a"}',
    ]);
    const shrunk = snapshot(['{"name":"openPage","url":"about:blank"}']);

    const renders = renderEachTick([full, shrunk]);
    // The render reflects the file exactly as it is at the time of the read.
    expect(renders[0]).toEqual(['openPage', 'navigate', 'click']);
    expect(renders[1]).toEqual(['openPage']);
  });

  it('handles empty content gracefully (atomic-rename race)', () => {
    const snap = snapshot(['{"name":"openPage","url":"about:blank"}']);
    const renders = renderEachTick(['', snap]);
    // Empty tick preserves last render; second tick captures the action.
    expect(renders[1]).toEqual(['openPage']);
  });

  it('skips malformed JSONL lines without dropping subsequent entries', () => {
    const content =
      HEADER +
      '\n{"name":"openPage","url":"about:blank"}' +
      '\nNOT VALID JSON' +
      '\n{"name":"click","selector":"#x"}' +
      '\n';
    const renders = renderEachTick([content]);
    expect(renders[0]).toEqual(['openPage', 'click']);
  });
});
