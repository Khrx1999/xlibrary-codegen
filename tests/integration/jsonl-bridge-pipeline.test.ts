/**
 * Integration tests for the JSONL bridge pipeline.
 *
 * Tests the full path:
 *   JSONL content (string) → parseJsonlContent → jsonlEntryToActionInContext
 *   → jsonlEntryToStepLines (via generator) → Robot Framework keyword lines
 *
 * This pipeline is what the runner uses in JSONL bridge mode (the fallback path
 * when the bundle-patcher regex misses). These tests exercise the module in
 * isolation — no browser required.
 *
 * Coverage targets: src/recorder/jsonl-bridge.ts
 */

import { describe, it, expect } from 'vitest';
import {
  parseJsonlContent,
  jsonlEntryToActionInContext,
  jsonlEntryToStepLines,
  type JsonlEntry,
} from '../../src/recorder/jsonl-bridge.js';
import { RobotFrameworkLanguageGenerator } from '../../src/codegen/robotframework.js';

// ─────────────────────────────────────────────────────────────────────────────
// parseJsonlContent
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonlContent', () => {
  const HEADER = JSON.stringify({ browserName: 'chromium' });

  it('skips line 0 (header metadata) and parses action lines', () => {
    const content = [
      HEADER,
      JSON.stringify({ name: 'navigate', url: 'https://example.com' }),
      JSON.stringify({ name: 'click', selector: 'css=#btn' }),
    ].join('\n');
    const entries = parseJsonlContent(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ name: 'navigate', url: 'https://example.com' });
    expect(entries[1]).toMatchObject({ name: 'click', selector: 'css=#btn' });
  });

  it('returns empty array for empty/whitespace-only content', () => {
    expect(parseJsonlContent('')).toHaveLength(0);
    expect(parseJsonlContent('   \n  \n')).toHaveLength(0);
  });

  it('returns empty array for header-only content (no action lines)', () => {
    const content = HEADER + '\n';
    expect(parseJsonlContent(content)).toHaveLength(0);
  });

  it('silently skips malformed JSON lines without dropping subsequent valid ones', () => {
    const content = [
      HEADER,
      JSON.stringify({ name: 'navigate', url: 'https://a.com' }),
      'NOT VALID JSON',
      JSON.stringify({ name: 'click', selector: 'css=#x' }),
      '{also-invalid',
    ].join('\n');
    const entries = parseJsonlContent(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ name: 'navigate' });
    expect(entries[1]).toMatchObject({ name: 'click' });
  });

  it('ignores blank lines interspersed between entries', () => {
    const content = [
      HEADER,
      '',
      JSON.stringify({ name: 'navigate', url: 'https://a.com' }),
      '',
      JSON.stringify({ name: 'fill', selector: '#x', text: 'hello' }),
      '',
    ].join('\n');
    const entries = parseJsonlContent(content);
    expect(entries).toHaveLength(2);
  });

  it('preserves all entry fields from the JSON', () => {
    const entry: JsonlEntry = {
      name: 'click',
      selector: 'css=#btn',
      button: 'left',
      clickCount: 2,
      modifiers: 0,
      signals: [],
      pageGuid: 'page-1',
      pageAlias: 'page',
      framePath: [],
    };
    const content = [HEADER, JSON.stringify(entry)].join('\n');
    const entries = parseJsonlContent(content);
    expect(entries[0]).toMatchObject(entry);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// jsonlEntryToActionInContext
// ─────────────────────────────────────────────────────────────────────────────

describe('jsonlEntryToActionInContext', () => {
  it('reconstructs frame from entry fields', () => {
    const entry: JsonlEntry = {
      name: 'navigate',
      url: 'https://example.com',
      signals: [],
      pageGuid: 'guid-42',
      pageAlias: 'myPage',
      framePath: ['iframe#0'],
    };
    const aic = jsonlEntryToActionInContext(entry);
    expect(aic).not.toBeUndefined();
    expect(aic!.frame.pageGuid).toBe('guid-42');
    expect(aic!.frame.pageAlias).toBe('myPage');
    expect(aic!.frame.framePath).toEqual(['iframe#0']);
  });

  it('returns undefined when entry has no name field', () => {
    const entry: JsonlEntry = { url: 'https://example.com', signals: [] };
    expect(jsonlEntryToActionInContext(entry)).toBeUndefined();
  });

  it('defaults pageGuid to empty string when missing', () => {
    const entry: JsonlEntry = { name: 'navigate', url: 'https://example.com', signals: [] };
    const aic = jsonlEntryToActionInContext(entry);
    expect(aic!.frame.pageGuid).toBe('');
  });

  it('defaults pageAlias to "page" when missing', () => {
    const entry: JsonlEntry = { name: 'navigate', url: 'https://example.com', signals: [] };
    const aic = jsonlEntryToActionInContext(entry);
    expect(aic!.frame.pageAlias).toBe('page');
  });

  it('defaults framePath to [] when missing', () => {
    const entry: JsonlEntry = { name: 'navigate', url: 'https://example.com', signals: [] };
    const aic = jsonlEntryToActionInContext(entry);
    expect(aic!.frame.framePath).toEqual([]);
  });

  it('strips the locator field from the reconstructed action', () => {
    const entry: JsonlEntry = {
      name: 'click',
      selector: 'css=#btn',
      signals: [],
      locator: { type: 'role', name: 'button' },
    };
    const aic = jsonlEntryToActionInContext(entry);
    // locator should not appear in action
    const action = aic!.action as Record<string, unknown>;
    expect('locator' in action).toBe(false);
  });

  it('defaults signals to [] when not an array', () => {
    const entry: JsonlEntry = {
      name: 'click',
      selector: 'css=#btn',
      // signals omitted intentionally
    };
    const aic = jsonlEntryToActionInContext(entry);
    expect(aic!.action.signals).toEqual([]);
  });

  it('startTime is a number (set to Date.now() at call time)', () => {
    const before = Date.now();
    const entry: JsonlEntry = { name: 'navigate', url: 'https://x.com', signals: [] };
    const aic = jsonlEntryToActionInContext(entry);
    const after = Date.now();
    expect(aic!.startTime).toBeGreaterThanOrEqual(before);
    expect(aic!.startTime).toBeLessThanOrEqual(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// jsonlEntryToStepLines — full pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('jsonlEntryToStepLines', () => {
  function makeGen(): RobotFrameworkLanguageGenerator {
    return new RobotFrameworkLanguageGenerator();
  }

  it('navigate entry → Go To keyword line', () => {
    const entry: JsonlEntry = {
      name: 'navigate',
      url: 'https://example.com',
      signals: [],
    };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    expect(lines.length).toBeGreaterThanOrEqual(1); // first line = keyword; subsequent may include `# xlib:step=N` marker
    expect(lines[0]).toContain('Go To');
    expect(lines[0]).toContain('https://example.com');
  });

  it('openPage(about:blank) entry → empty lines (collapsed)', () => {
    const entry: JsonlEntry = {
      name: 'openPage',
      url: 'about:blank',
      signals: [],
    };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    expect(lines).toHaveLength(0);
  });

  it('openPage(blank) + navigate → stateless generator emits New Page for navigate', () => {
    // The JSONL bridge calls with a fresh generator each render (stateless).
    // So blank-page + navigate each go through separate generators — this
    // mirrors the stateless render loop in runner.ts.
    const navEntry: JsonlEntry = {
      name: 'navigate',
      url: 'https://example.com/page',
      signals: [],
    };
    // When called on a fresh generator without a prior openPage, navigate → Go To
    const lines = jsonlEntryToStepLines(navEntry, makeGen());
    expect(lines[0]).toContain('Go To');
  });

  it('click entry → Click keyword line with selector', () => {
    const entry: JsonlEntry = {
      name: 'click',
      selector: 'css=#submit',
      button: 'left',
      clickCount: 1,
      modifiers: 0,
      signals: [],
    };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    expect(lines.length).toBeGreaterThanOrEqual(1); // first line = keyword; subsequent may include `# xlib:step=N` marker
    expect(lines[0]).toContain('Click');
    expect(lines[0]).toContain('css=#submit');
  });

  it('fill entry → Fill Text line with selector and text', () => {
    const entry: JsonlEntry = {
      name: 'fill',
      selector: 'css=#username',
      text: 'alice',
      signals: [],
    };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    expect(lines.length).toBeGreaterThanOrEqual(1); // first line = keyword; subsequent may include `# xlib:step=N` marker
    expect(lines[0]).toContain('Fill Text');
    expect(lines[0]).toContain('alice');
  });

  it('returns empty lines for entry with no name', () => {
    const entry: JsonlEntry = { url: 'https://example.com' };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    expect(lines).toHaveLength(0);
  });

  it('check entry → Check Checkbox line', () => {
    const entry: JsonlEntry = {
      name: 'check',
      selector: 'css=#agree',
      signals: [],
    };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    expect(lines.length).toBeGreaterThanOrEqual(1); // first line = keyword; subsequent may include `# xlib:step=N` marker
    expect(lines[0]).toContain('Check Checkbox');
  });

  it('assertText(exact) entry → Get Text with == operator', () => {
    const entry: JsonlEntry = {
      name: 'assertText',
      selector: 'css=#message',
      text: 'Success',
      substring: false,
      signals: [],
    };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    expect(lines.length).toBeGreaterThanOrEqual(1); // first line = keyword; subsequent may include `# xlib:step=N` marker
    expect(lines[0]).toContain('Get Text');
    expect(lines[0]).toContain('==');
  });

  it('assertText(substring) entry → Get Text with *= operator', () => {
    const entry: JsonlEntry = {
      name: 'assertText',
      selector: 'css=#message',
      text: 'Succ',
      substring: true,
      signals: [],
    };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    expect(lines.length).toBeGreaterThanOrEqual(1); // first line = keyword; subsequent may include `# xlib:step=N` marker
    expect(lines[0]).toContain('*=');
  });

  it('assertSnapshot → TODO comment line', () => {
    const entry: JsonlEntry = {
      name: 'assertSnapshot',
      selector: 'css=body',
      ariaSnapshot: '- heading: Hello',
      signals: [],
    };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    expect(lines.length).toBeGreaterThanOrEqual(1); // first line = keyword; subsequent may include `# xlib:step=N` marker
    expect(lines[0]).toContain('# TODO');
  });

  it('setInputFiles entry → Upload File By Selector line per file', () => {
    const entry: JsonlEntry = {
      name: 'setInputFiles',
      selector: 'css=#upload',
      files: ['/tmp/a.txt', '/tmp/b.txt'],
      signals: [],
    };
    const lines = jsonlEntryToStepLines(entry, makeGen());
    // 2 upload calls + 1 xlib:step marker = 3 lines
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const uploads = lines.filter((l) => l.includes('Upload File By Selector'));
    expect(uploads).toHaveLength(2);
  });

  it('all returned lines are non-empty strings', () => {
    const entries: JsonlEntry[] = [
      { name: 'navigate', url: 'https://x.com', signals: [] },
      {
        name: 'click',
        selector: 'css=#a',
        button: 'left',
        clickCount: 1,
        modifiers: 0,
        signals: [],
      },
      { name: 'fill', selector: 'css=#b', text: 'xyz', signals: [] },
    ];
    for (const entry of entries) {
      const lines = jsonlEntryToStepLines(entry, makeGen());
      for (const line of lines) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full JSONL content → rendered output round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('JSONL content → rendered output round-trip', () => {
  const HEADER_LINE = JSON.stringify({ browserName: 'chromium' });

  it('full login flow parses and renders correctly end-to-end', () => {
    const entries = [
      { name: 'openPage', url: 'about:blank', signals: [] },
      { name: 'navigate', url: 'https://example.com/login', signals: [] },
      { name: 'fill', selector: 'css=#user', text: 'admin', signals: [] },
      { name: 'fill', selector: 'css=#pass', text: 'secret', signals: [] },
      {
        name: 'click',
        selector: 'css=#login',
        button: 'left',
        clickCount: 1,
        modifiers: 0,
        signals: [],
      },
      {
        name: 'assertText',
        selector: 'css=#banner',
        text: 'Welcome',
        substring: false,
        signals: [],
      },
    ];
    const content = [HEADER_LINE, ...entries.map((e) => JSON.stringify(e))].join('\n');

    const parsed = parseJsonlContent(content);
    expect(parsed).toHaveLength(entries.length);

    const gen = new RobotFrameworkLanguageGenerator();
    const allLines: string[] = [];
    for (const entry of parsed) {
      allLines.push(...jsonlEntryToStepLines(entry, gen));
    }

    // The first entry (openPage blank) is skipped, navigate after pending blank
    // should be rendered (stateless render: navigate on fresh gen → Go To, not New Page)
    expect(allLines.some((l) => l.includes('Go To') || l.includes('New Page'))).toBe(true);
    expect(allLines.some((l) => l.includes('Fill Text'))).toBe(true);
    expect(allLines.some((l) => l.includes('Click'))).toBe(true);
    expect(allLines.some((l) => l.includes('Get Text'))).toBe(true);
  });

  it('ThrottledFile mutation simulation — final text value is captured', () => {
    // Simulates Playwright's ThrottledFile rewriting the last fill entry in place
    // as the user types. Stateless re-render always picks up the latest value.
    const partials = ['h', 'he', 'hel', 'hell', 'hello'];
    for (const text of partials) {
      const content = [
        HEADER_LINE,
        JSON.stringify({ name: 'navigate', url: 'https://example.com', signals: [] }),
        JSON.stringify({ name: 'fill', selector: '#input', text, signals: [] }),
      ].join('\n');

      const parsed = parseJsonlContent(content);
      const gen = new RobotFrameworkLanguageGenerator();
      const allLines: string[] = [];
      for (const entry of parsed) {
        allLines.push(...jsonlEntryToStepLines(entry, gen));
      }
      const fillLine = allLines.find((l) => l.includes('Fill Text'));
      expect(fillLine).toBeDefined();
      expect(fillLine!).toContain(text);
    }
  });
});
