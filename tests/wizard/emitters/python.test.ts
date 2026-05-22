/**
 * Tests for the Python (pytest-playwright) variable emitter.
 *
 * Scenarios:
 *   1. No existing constants — block inserted above first def test_
 *   2. Constants already present in source — position still found correctly
 *   3. Multiple substitutions — deduplication
 *   4. Collision: constant already defined — skipped with stderr warning
 *   5. No test function — prepended to the file (with shebang skip)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  pythonEmitter,
  existingPyVarNames,
  buildPyConstBlock,
  findPyInsertionIndex,
} from '../../../src/wizard/emitters/python.js';
import type { DetectionResult } from '../../../src/wizard/types.js';

function makeResult(
  vars: Array<{ name: string; value: string }>,
  substitutions: Array<{ actionIdx: number; field: string; oldValue: string; varName: string }>,
): DetectionResult {
  const subMap = new Map<number, { field: string; oldValue: string; varName: string }[]>();
  for (const s of substitutions) {
    const entry = subMap.get(s.actionIdx) ?? [];
    entry.push({ field: s.field, oldValue: s.oldValue, varName: s.varName });
    subMap.set(s.actionIdx, entry);
  }
  return { variables: vars, substitutions: subMap };
}

// Typical pytest-playwright Python file.
const PY_SOURCE = `import re
from playwright.sync_api import Page, expect


def test_login(page: Page) -> None:
    page.goto("https://example.com")
    page.fill('input[name="email"]', "qa@example.com")
    page.fill('input[name="password"]', "Hunter2!")
    page.click('button[type="submit"]')
`;

// ── 1. No existing constants — inserts above first def test_ ─────────────────

describe('pythonEmitter — no existing constants', () => {
  it('inserts constant block above first def test_ function', () => {
    const result = makeResult(
      [
        { name: 'VALID_EMAIL', value: 'qa@example.com' },
        { name: 'VALID_PASSWORD', value: 'Hunter2!' },
      ],
      [
        { actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
        { actionIdx: 1, field: 'text', oldValue: 'Hunter2!', varName: 'VALID_PASSWORD' },
      ],
    );
    const output = pythonEmitter.applyExtraction(PY_SOURCE, result);

    // Constants present.
    expect(output).toContain('VALID_EMAIL = "qa@example.com"');
    expect(output).toContain('VALID_PASSWORD = "Hunter2!"');

    // Constants before first test function.
    const constPos = output.indexOf('VALID_EMAIL = ');
    const defPos = output.indexOf('def test_login');
    expect(constPos).toBeLessThan(defPos);

    // Inline substitutions.
    expect(output).toContain('page.fill(\'input[name="email"]\', VALID_EMAIL)');
    expect(output).toContain('page.fill(\'input[name="password"]\', VALID_PASSWORD)');
  });

  it('snapshot — before/after with two constants', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = pythonEmitter.applyExtraction(PY_SOURCE, result);
    expect(output).toMatchInlineSnapshot(`
"import re
from playwright.sync_api import Page, expect


VALID_EMAIL = "qa@example.com"

def test_login(page: Page) -> None:
    page.goto("https://example.com")
    page.fill('input[name="email"]', VALID_EMAIL)
    page.fill('input[name="password"]', "Hunter2!")
    page.click('button[type="submit"]')
"`);
  });
});

// ── 2. Constants already present ─────────────────────────────────────────────

describe('pythonEmitter — source already has module-level constants', () => {
  const SOURCE_WITH_CONST = `import re
from playwright.sync_api import Page

BASE_URL = "https://example.com"


def test_login(page: Page) -> None:
    page.fill('input[name="email"]', "qa@example.com")
`;

  it('inserts new constant above def test_ and preserves existing', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = pythonEmitter.applyExtraction(SOURCE_WITH_CONST, result);

    expect(output).toContain('BASE_URL = "https://example.com"');
    expect(output).toContain('VALID_EMAIL = "qa@example.com"');
    expect(output).toContain('page.fill(\'input[name="email"]\', VALID_EMAIL)');
  });
});

// ── 3. Multiple substitutions — deduplication ────────────────────────────────

describe('pythonEmitter — multiple substitutions same variable', () => {
  const SOURCE = `from playwright.sync_api import Page


def test_emails(page: Page) -> None:
    page.fill('#email1', 'qa@example.com')
    page.fill('#email2', 'qa@example.com')
`;

  it('emits one constant, replaces all occurrences', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [
        { actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
        { actionIdx: 1, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
      ],
    );
    const output = pythonEmitter.applyExtraction(SOURCE, result);

    const decls = (output.match(/VALID_EMAIL = /g) ?? []).length;
    expect(decls).toBe(1);

    // Both fill lines use the variable.
    const refs = (output.match(/page\.fill\('#email[12]', VALID_EMAIL\)/g) ?? []).length;
    expect(refs).toBe(2);
  });
});

// ── 4. Collision ──────────────────────────────────────────────────────────────

describe('pythonEmitter — collision handling', () => {
  const SOURCE_WITH_COLLISION = `from playwright.sync_api import Page

VALID_EMAIL = "old@example.com"


def test_login(page: Page) -> None:
    page.fill('#email', 'qa@example.com')
`;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips duplicate and warns on stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = pythonEmitter.applyExtraction(SOURCE_WITH_COLLISION, result);

    // Existing value preserved.
    expect(output).toContain('VALID_EMAIL = "old@example.com"');
    // Only one declaration.
    const decls = (output.match(/VALID_EMAIL = /g) ?? []).length;
    expect(decls).toBe(1);
    // Literal not replaced.
    expect(output).toContain("'qa@example.com'");
    // Warning issued.
    expect(stderrSpy).toHaveBeenCalledOnce();
    const warnMsg = (stderrSpy.mock.calls[0] as unknown[])[0] as string;
    expect(warnMsg).toContain('VALID_EMAIL');
    expect(warnMsg).toContain('already defined');
  });
});

// ── 5. No test function — prepend ─────────────────────────────────────────────

describe('pythonEmitter — no def test_ function', () => {
  const SOURCE_NO_DEF = `# A helper module
import re

def helper():
    return True
`;

  it('prepends constants to the file when no test function found', () => {
    const result = makeResult([{ name: 'VALID_EMAIL', value: 'qa@example.com' }], []);
    const output = pythonEmitter.applyExtraction(SOURCE_NO_DEF, result);
    expect(output).toContain('VALID_EMAIL = "qa@example.com"');
  });
});

// ── Unit tests for helper exports ────────────────────────────────────────────

describe('existingPyVarNames', () => {
  it('detects SCREAMING_SNAKE assignments', () => {
    const content = `BASE_URL = "https://example.com"\nVALID_EMAIL = "a@b.com"\n`;
    const names = existingPyVarNames(content);
    expect(names.has('BASE_URL')).toBe(true);
    expect(names.has('VALID_EMAIL')).toBe(true);
  });

  it('detects indented SCREAMING_SNAKE assignments inside functions', () => {
    const content = `def setup():\n    API_KEY = "secret"\n`;
    const names = existingPyVarNames(content);
    expect(names.has('API_KEY')).toBe(true);
  });

  it('ignores snake_case names', () => {
    const names = existingPyVarNames(`my_var = 1\nfoo_bar = "baz"\n`);
    expect(names.size).toBe(0);
  });
});

describe('buildPyConstBlock', () => {
  it('formats constant assignments with double quotes', () => {
    const block = buildPyConstBlock([{ name: 'EMAIL', value: 'a@b.com' }]);
    expect(block).toBe('EMAIL = "a@b.com"');
  });

  it('uses triple-quoted string for multi-line values', () => {
    const block = buildPyConstBlock([{ name: 'MULTI', value: 'line1\nline2' }]);
    expect(block).toContain('"""line1\nline2"""');
  });
});

describe('findPyInsertionIndex', () => {
  it('returns index of first def test_ line', () => {
    const content = `import re\n\ndef test_foo():\n    pass\n`;
    const idx = findPyInsertionIndex(content);
    expect(content.slice(idx)).toContain('def test_foo');
  });

  it('returns 0 when no def test_ or class exists', () => {
    const content = `x = 1\n`;
    expect(findPyInsertionIndex(content)).toBe(0);
  });
});
