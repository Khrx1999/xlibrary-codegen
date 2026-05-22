/**
 * Tests for the TypeScript (Playwright Test) variable emitter.
 *
 * Scenarios:
 *   1. No existing const declarations — block inserted after last import
 *   2. Const declarations already present — correct position still found
 *   3. Multiple substitutions — deduplication
 *   4. Collision: var already declared — skipped with stderr warning
 *   5. No imports — block inserted before first test()
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  typescriptEmitter,
  existingTsVarNames,
  buildConstBlock,
  findInsertionIndex,
} from '../../../src/wizard/emitters/typescript.js';
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

// Typical Playwright Test TS file.
const TS_SOURCE = `import { test, expect } from '@playwright/test';

test('login', async ({ page }) => {
  await page.goto('https://example.com');
  await page.fill('input[name="email"]', 'qa@example.com');
  await page.fill('input[name="password"]', 'Hunter2!');
  await page.click('button[type="submit"]');
});
`;

// ── 1. No existing consts — inserts after imports ────────────────────────────

describe('typescriptEmitter — no existing consts', () => {
  it('inserts const block after the last import', () => {
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
    const output = typescriptEmitter.applyExtraction(TS_SOURCE, result);

    // Consts are present.
    expect(output).toContain("const VALID_EMAIL = 'qa@example.com';");
    expect(output).toContain("const VALID_PASSWORD = 'Hunter2!';");

    // Consts come after import, before test block.
    const importEnd =
      output.indexOf("from '@playwright/test';") + "from '@playwright/test';".length;
    const constPos = output.indexOf('const VALID_EMAIL');
    const testPos = output.indexOf("test('login'");
    expect(constPos).toBeGreaterThan(importEnd);
    expect(constPos).toBeLessThan(testPos);

    // Inline substitutions applied.
    expect(output).toContain('page.fill(\'input[name="email"]\', VALID_EMAIL)');
    expect(output).toContain('page.fill(\'input[name="password"]\', VALID_PASSWORD)');
  });

  it('snapshot — before/after with two variables', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = typescriptEmitter.applyExtraction(TS_SOURCE, result);
    expect(output).toMatchInlineSnapshot(`
"import { test, expect } from '@playwright/test';

const VALID_EMAIL = 'qa@example.com';

test('login', async ({ page }) => {
  await page.goto('https://example.com');
  await page.fill('input[name="email"]', VALID_EMAIL);
  await page.fill('input[name="password"]', 'Hunter2!');
  await page.click('button[type="submit"]');
});
"`);
  });
});

// ── 2. Already has consts — still finds correct insertion position ────────────

describe('typescriptEmitter — source already has const at top', () => {
  const SOURCE_WITH_CONST = `import { test, expect } from '@playwright/test';

const BASE_URL = 'https://example.com';

test('login', async ({ page }) => {
  await page.fill('input[name="email"]', 'qa@example.com');
});
`;

  it('inserts new const after import (not after existing const)', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = typescriptEmitter.applyExtraction(SOURCE_WITH_CONST, result);

    expect(output).toContain("const VALID_EMAIL = 'qa@example.com';");
    expect(output).toContain("const BASE_URL = 'https://example.com';");
    expect(output).toContain('page.fill(\'input[name="email"]\', VALID_EMAIL)');
  });
});

// ── 3. Multiple substitutions — deduplication ────────────────────────────────

describe('typescriptEmitter — multiple substitutions same variable', () => {
  const SOURCE = `import { test } from '@playwright/test';

test('check email', async ({ page }) => {
  await page.fill('#email1', 'qa@example.com');
  await page.fill('#email2', 'qa@example.com');
});
`;

  it('emits one const declaration, replaces all occurrences', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [
        { actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
        { actionIdx: 1, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
      ],
    );
    const output = typescriptEmitter.applyExtraction(SOURCE, result);

    const decls = (output.match(/const VALID_EMAIL/g) ?? []).length;
    expect(decls).toBe(1);
    const refs = (output.match(/VALID_EMAIL/g) ?? []).length;
    expect(refs).toBe(3); // 1 decl + 2 usage
  });
});

// ── 4. Collision ──────────────────────────────────────────────────────────────

describe('typescriptEmitter — collision handling', () => {
  const SOURCE_WITH_COLLISION = `import { test } from '@playwright/test';

const VALID_EMAIL = 'old@example.com';

test('login', async ({ page }) => {
  await page.fill('#email', 'qa@example.com');
});
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
    const output = typescriptEmitter.applyExtraction(SOURCE_WITH_COLLISION, result);

    // Existing value preserved.
    expect(output).toContain("const VALID_EMAIL = 'old@example.com';");
    // No second declaration.
    const decls = (output.match(/const VALID_EMAIL/g) ?? []).length;
    expect(decls).toBe(1);
    // Literal not replaced.
    expect(output).toContain("'qa@example.com'");
    // Warning issued.
    expect(stderrSpy).toHaveBeenCalledOnce();
    const warnMsg = (stderrSpy.mock.calls[0] as unknown[])[0] as string;
    expect(warnMsg).toContain('VALID_EMAIL');
  });
});

// ── 5. No imports — inserts before test() ────────────────────────────────────

describe('typescriptEmitter — no imports', () => {
  const SOURCE_NO_IMPORTS = `test('login', async ({ page }) => {
  await page.fill('#email', 'qa@example.com');
});
`;

  it('inserts const block before the first test( call', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = typescriptEmitter.applyExtraction(SOURCE_NO_IMPORTS, result);

    const constIdx = output.indexOf('const VALID_EMAIL');
    const testIdx = output.indexOf("test('login'");
    expect(constIdx).toBeLessThan(testIdx);
    expect(output).toContain("page.fill('#email', VALID_EMAIL)");
  });
});

// ── Unit tests for helper exports ────────────────────────────────────────────

describe('existingTsVarNames', () => {
  it('detects const / let / var SCREAMING_SNAKE identifiers', () => {
    const content = `const VALID_EMAIL = 'a@b.com';\nlet COUNTER = 0;\nvar LEGACY = true;\n`;
    const names = existingTsVarNames(content);
    expect(names.has('VALID_EMAIL')).toBe(true);
    expect(names.has('COUNTER')).toBe(true);
    expect(names.has('LEGACY')).toBe(true);
  });

  it('ignores camelCase identifiers', () => {
    const names = existingTsVarNames(`const myVar = 'foo';\n`);
    expect(names.size).toBe(0);
  });
});

describe('buildConstBlock', () => {
  it('formats const declarations with single quotes', () => {
    const block = buildConstBlock([{ name: 'EMAIL', value: 'a@b.com' }]);
    expect(block).toBe("const EMAIL = 'a@b.com';");
  });

  it('uses template literal for multi-line values', () => {
    const block = buildConstBlock([{ name: 'MULTI', value: 'line1\nline2' }]);
    expect(block).toContain('`line1\nline2`');
  });
});

describe('findInsertionIndex', () => {
  it('returns index after the last import statement', () => {
    const content = `import a from 'a';\nimport b from 'b';\n\ntest(() => {});\n`;
    const idx = findInsertionIndex(content);
    const before = content.slice(0, idx);
    expect(before).toContain("import b from 'b';");
    expect(content.slice(idx).trimStart()).toContain('test(');
  });
});
