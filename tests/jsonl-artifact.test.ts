/**
 * Unit tests for src/recorder/jsonl-artifact.ts
 *
 * Verifies:
 *   - Header build + serialize round-trip
 *   - Header parse (happy path, missing xlib field, malformed JSON)
 *   - Action serialization preserves all fields
 *   - Full artifact build + parse round-trip (direct mode)
 *   - Bridge-mode artifact: action lines from Playwright temp content
 *   - parseArtifactContent throws on empty / non-xlibrary content
 */

import { describe, it, expect } from 'vitest';
import type { ActionInContext } from '../src/types.js';
import {
  buildArtifactHeader,
  serializeHeader,
  parseArtifactHeader,
  serializeAction,
  buildArtifactContent,
  buildArtifactFromBridgeContent,
  parseArtifactContent,
  XLIB_SCHEMA_VERSION,
} from '../src/recorder/jsonl-artifact.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_TIME = '2026-05-22T19:23:45.123Z';

function makeAction(overrides: Partial<ActionInContext['action']> = {}): ActionInContext {
  return {
    frame: { pageGuid: 'pg-1', pageAlias: 'page', framePath: [] },
    action: {
      name: 'click',
      selector: 'css=#btn',
      button: 'left',
      modifiers: 0,
      clickCount: 1,
      signals: [],
      ...overrides,
    } as ActionInContext['action'],
    startTime: 1000,
    endTime: 1200,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Header: build + serialize
// ─────────────────────────────────────────────────────────────────────────────

describe('buildArtifactHeader', () => {
  it('produces expected shape', () => {
    const h = buildArtifactHeader('chromium', 'Login Flow', FIXED_TIME);
    expect(h.xlib).toBe(XLIB_SCHEMA_VERSION);
    expect(h['recorded-at']).toBe(FIXED_TIME);
    expect(h.browser).toBe('chromium');
    expect(h['test-name']).toBe('Login Flow');
  });

  it('uses current time when not provided', () => {
    const before = Date.now();
    const h = buildArtifactHeader('firefox', 'My Test');
    const after = Date.now();
    const ts = new Date(h['recorded-at']).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe('serializeHeader', () => {
  it('round-trips through JSON.parse', () => {
    const h = buildArtifactHeader('chromium', 'Login Flow', FIXED_TIME);
    const line = serializeHeader(h);
    const parsed = JSON.parse(line) as typeof h;
    expect(parsed.xlib).toBe(1);
    expect(parsed['recorded-at']).toBe(FIXED_TIME);
    expect(parsed.browser).toBe('chromium');
    expect(parsed['test-name']).toBe('Login Flow');
  });

  it('produces a single line (no newlines)', () => {
    const h = buildArtifactHeader('chromium', 'Test', FIXED_TIME);
    expect(serializeHeader(h)).not.toContain('\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Header: parse
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArtifactHeader', () => {
  it('parses a valid xlibrary header line', () => {
    const line = `{"xlib":1,"recorded-at":"${FIXED_TIME}","browser":"chromium","test-name":"Login Flow"}`;
    const h = parseArtifactHeader(line);
    expect(h).not.toBeUndefined();
    expect(h?.xlib).toBe(1);
    expect(h?.['recorded-at']).toBe(FIXED_TIME);
    expect(h?.browser).toBe('chromium');
    expect(h?.['test-name']).toBe('Login Flow');
  });

  it('returns undefined for empty string', () => {
    expect(parseArtifactHeader('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(parseArtifactHeader('   ')).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    expect(parseArtifactHeader('{not json}')).toBeUndefined();
  });

  it('returns undefined when xlib field is missing', () => {
    const line = `{"recorded-at":"${FIXED_TIME}","browser":"chromium","test-name":"T"}`;
    expect(parseArtifactHeader(line)).toBeUndefined();
  });

  it('returns undefined when xlib field is not a number', () => {
    const line = `{"xlib":"1","recorded-at":"${FIXED_TIME}","browser":"chromium","test-name":"T"}`;
    expect(parseArtifactHeader(line)).toBeUndefined();
  });

  it('returns undefined for a Playwright action entry (not a header)', () => {
    const line = `{"name":"click","selector":"css=#btn","signals":[],"pageGuid":"pg-1","pageAlias":"page","framePath":[]}`;
    expect(parseArtifactHeader(line)).toBeUndefined();
  });

  it('applies defaults for missing optional fields', () => {
    const line = `{"xlib":1}`;
    const h = parseArtifactHeader(line);
    expect(h).not.toBeUndefined();
    expect(h?.browser).toBe('chromium');
    expect(h?.['test-name']).toBe('Recorded Flow');
    expect(h?.['recorded-at']).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Action serialization
// ─────────────────────────────────────────────────────────────────────────────

describe('serializeAction', () => {
  it('produces a single-line JSON string', () => {
    const line = serializeAction(makeAction());
    expect(line).not.toContain('\n');
    // Should be valid JSON
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it('merges action fields and frame fields into one flat object', () => {
    const line = serializeAction(makeAction());
    const obj = JSON.parse(line) as Record<string, unknown>;
    // Frame fields
    expect(obj['pageGuid']).toBe('pg-1');
    expect(obj['pageAlias']).toBe('page');
    expect(Array.isArray(obj['framePath'])).toBe(true);
    // Action fields
    expect(obj['name']).toBe('click');
    expect(obj['selector']).toBe('css=#btn');
    expect(obj['button']).toBe('left');
    expect(obj['modifiers']).toBe(0);
    expect(obj['clickCount']).toBe(1);
  });

  it('preserves startTime and endTime', () => {
    const line = serializeAction(makeAction());
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect(obj['startTime']).toBe(1000);
    expect(obj['endTime']).toBe(1200);
  });

  it('omits endTime when not set', () => {
    const action = makeAction();
    delete action.endTime;
    const line = serializeAction(action);
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect('endTime' in obj).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full artifact: build + parse round-trip (direct mode)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildArtifactContent + parseArtifactContent round-trip', () => {
  it('header on line 0; actions on subsequent lines', () => {
    const header = buildArtifactHeader('chromium', 'Login Flow', FIXED_TIME);
    const actions = [
      makeAction(),
      makeAction({ name: 'fill', selector: 'css=#email', text: 'a@b.com', signals: [] }),
    ];
    const content = buildArtifactContent(header, actions);

    const lines = content.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(3); // 1 header + 2 actions
  });

  it('content ends with newline', () => {
    const header = buildArtifactHeader('chromium', 'T', FIXED_TIME);
    const content = buildArtifactContent(header, []);
    expect(content.endsWith('\n')).toBe(true);
  });

  it('parseArtifactContent recovers header and action line count', () => {
    const header = buildArtifactHeader('chromium', 'Login Flow', FIXED_TIME);
    const actions = [makeAction(), makeAction()];
    const content = buildArtifactContent(header, actions);

    const result = parseArtifactContent(content);
    expect(result.header.xlib).toBe(1);
    expect(result.header['test-name']).toBe('Login Flow');
    expect(result.header.browser).toBe('chromium');
    expect(result.header['recorded-at']).toBe(FIXED_TIME);
    expect(result.actionLines).toHaveLength(2);
  });

  it('parseArtifactContent: empty file throws', () => {
    expect(() => parseArtifactContent('')).toThrow(/file is empty/);
  });

  it('parseArtifactContent: no xlib field throws', () => {
    const noHeader = `{"recorded-at":"${FIXED_TIME}","browser":"chromium","test-name":"T"}\n`;
    expect(() => parseArtifactContent(noHeader)).toThrow(/not a valid xlibrary header/);
  });

  it('parseArtifactContent: skips empty action lines', () => {
    const header = buildArtifactHeader('chromium', 'T', FIXED_TIME);
    const content = serializeHeader(header) + '\n\n   \n' + serializeAction(makeAction()) + '\n';
    const result = parseArtifactContent(content);
    expect(result.actionLines).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bridge-mode artifact
// ─────────────────────────────────────────────────────────────────────────────

describe('buildArtifactFromBridgeContent', () => {
  it('replaces Playwright header with xlibrary header; action lines preserved', () => {
    const playwrightHeader = '{"version":1,"browserName":"chromium"}';
    const action1 = `{"name":"click","selector":"css=#btn","signals":[],"pageGuid":"pg","pageAlias":"page","framePath":[]}`;
    const action2 = `{"name":"navigate","url":"https://example.com","signals":[],"pageGuid":"pg","pageAlias":"page","framePath":[]}`;
    const tempContent = [playwrightHeader, action1, action2, ''].join('\n');

    const header = buildArtifactHeader('chromium', 'Bridge Test', FIXED_TIME);
    const artifactContent = buildArtifactFromBridgeContent(header, tempContent);

    const result = parseArtifactContent(artifactContent);
    expect(result.header['test-name']).toBe('Bridge Test');
    expect(result.actionLines).toHaveLength(2);
    expect(result.actionLines[0]).toBe(action1);
    expect(result.actionLines[1]).toBe(action2);
  });

  it('handles empty bridge content gracefully', () => {
    const header = buildArtifactHeader('chromium', 'Empty', FIXED_TIME);
    const content = buildArtifactFromBridgeContent(header, '');
    const result = parseArtifactContent(content);
    expect(result.actionLines).toHaveLength(0);
  });

  it('result content ends with newline', () => {
    const header = buildArtifactHeader('chromium', 'T', FIXED_TIME);
    const content = buildArtifactFromBridgeContent(header, '');
    expect(content.endsWith('\n')).toBe(true);
  });
});
