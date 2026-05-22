/**
 * Snapshot tests for the Robot Framework variable emitter.
 *
 * Each group exercises one scenario with a "before" (input) content and
 * verifies the "after" (output) matches the expected snapshot string.
 *
 * Scenarios:
 *   1. No Variables section exists yet — section is inserted above Test Cases
 *   2. Variables section already exists — new vars are appended, existing preserved
 *   3. Multiple substitutions for the same variable — dedup correct
 *   4. Collision: var already defined in source — skipped with stderr warning
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  robotEmitter,
  insertVariablesSection,
  existingVarNames,
  buildVarBlock,
} from '../../../src/wizard/emitters/robot.js';
import type { DetectionResult } from '../../../src/wizard/types.js';

// ── Helper to build a DetectionResult ───────────────────────────────────────

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
  return {
    variables: vars.map((v) => ({
      name: v.name,
      value: v.value,
      occurrences: 1,
      sourceActions: [],
      semantic: 'unknown' as const,
    })),
    substitutions: subMap,
  };
}

// ── 1. No Variables section ──────────────────────────────────────────────────

describe('robotEmitter — no Variables section', () => {
  const SOURCE = `*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=\${False}
    Fill Text    role=textbox[name="Email"]    qa@example.com
    Fill Text    role=textbox[name="Password"]    Hunter2!
    Click    role=button[name="Sign in"]
    Close Browser
`;

  it('inserts *** Variables *** above *** Test Cases ***', () => {
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

    const output = robotEmitter.applyExtraction(SOURCE, result);

    // Variables section must be present and above Test Cases.
    expect(output).toContain('*** Variables ***');
    const varIdx = output.indexOf('*** Variables ***');
    const tcIdx = output.indexOf('*** Test Cases ***');
    expect(varIdx).toBeLessThan(tcIdx);

    // Correct variable lines.
    expect(output).toContain('${VALID_EMAIL}    qa@example.com');
    expect(output).toContain('${VALID_PASSWORD}    Hunter2!');

    // Inline substitutions applied.
    expect(output).toContain('Fill Text    role=textbox[name="Email"]    ${VALID_EMAIL}');
    expect(output).toContain('Fill Text    role=textbox[name="Password"]    ${VALID_PASSWORD}');

    // Original literals no longer appear as keyword arguments (4-space separated
    // from a keyword name).  The value still appears inside the Variables section
    // definition line `${VALID_EMAIL}    qa@example.com` — that is intentional.
    expect(output).not.toContain('Fill Text    role=textbox[name="Email"]    qa@example.com');
    expect(output).not.toContain('Fill Text    role=textbox[name="Password"]    Hunter2!');
  });

  it('snapshot — no Variables section before/after', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = robotEmitter.applyExtraction(SOURCE, result);
    expect(output).toMatchInlineSnapshot(`
"*** Settings ***
Library    Browser

*** Variables ***
\${VALID_EMAIL}    qa@example.com

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=\${False}
    Fill Text    role=textbox[name="Email"]    \${VALID_EMAIL}
    Fill Text    role=textbox[name="Password"]    Hunter2!
    Click    role=button[name="Sign in"]
    Close Browser
"`);
  });
});

// ── 2. Variables section already exists ──────────────────────────────────────

describe('robotEmitter — Variables section already exists', () => {
  const SOURCE = `*** Settings ***
Library    Browser

*** Variables ***
\${BASE_URL}    https://example.com

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=\${False}
    Fill Text    role=textbox[name="Email"]    qa@example.com
    Close Browser
`;

  it('appends new variable after existing variable, preserves existing', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = robotEmitter.applyExtraction(SOURCE, result);

    // Existing var preserved.
    expect(output).toContain('${BASE_URL}    https://example.com');
    // New var added.
    expect(output).toContain('${VALID_EMAIL}    qa@example.com');
    // New var is in the Variables section, not duplicated.
    const varSectionEnd = output.indexOf('*** Test Cases ***');
    const varSection = output.slice(0, varSectionEnd);
    expect(varSection).toContain('${VALID_EMAIL}');
    // Inline substitution applied.
    expect(output).toContain('Fill Text    role=textbox[name="Email"]    ${VALID_EMAIL}');
  });

  it('snapshot — Variables section extended', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = robotEmitter.applyExtraction(SOURCE, result);
    expect(output).toMatchInlineSnapshot(`
"*** Settings ***
Library    Browser

*** Variables ***
\${BASE_URL}    https://example.com

\${VALID_EMAIL}    qa@example.com
*** Test Cases ***
Login Flow
    New Browser    chromium    headless=\${False}
    Fill Text    role=textbox[name="Email"]    \${VALID_EMAIL}
    Close Browser
"`);
  });
});

// ── 3. Multiple substitutions — same variable, multiple occurrences ───────────

describe('robotEmitter — multiple substitutions same variable', () => {
  const SOURCE = `*** Settings ***
Library    Browser

*** Test Cases ***
Password Reset Flow
    Fill Text    css=input#email    qa@example.com
    Fill Text    css=input#confirm    qa@example.com
    Close Browser
`;

  it('deduplicates: one variable declaration, all occurrences replaced', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [
        { actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
        { actionIdx: 1, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
      ],
    );
    const output = robotEmitter.applyExtraction(SOURCE, result);

    // Only one definition in the Variables section.
    const matches = output.match(/\$\{VALID_EMAIL\}\s{4}qa@example\.com/g);
    expect(matches).toHaveLength(1);

    // Both fill lines substituted.
    const fillMatches = output.match(/Fill Text.*\$\{VALID_EMAIL\}/g);
    expect(fillMatches).toHaveLength(2);
  });
});

// ── 4. Collision: variable already defined in source ─────────────────────────

describe('robotEmitter — collision handling', () => {
  const SOURCE = `*** Settings ***
Library    Browser

*** Variables ***
\${VALID_EMAIL}    existing@example.com

*** Test Cases ***
Login Flow
    Fill Text    role=textbox[name="Email"]    qa@example.com
    Close Browser
`;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips inserting a duplicate variable and warns on stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = robotEmitter.applyExtraction(SOURCE, result);

    // The existing definition is preserved with the OLD value.
    expect(output).toContain('${VALID_EMAIL}    existing@example.com');
    // The new value is NOT added as a second definition.
    const defCount = (output.match(/\$\{VALID_EMAIL\}\s{4}/g) ?? []).length;
    expect(defCount).toBe(1);

    // The literal `qa@example.com` in the test body is NOT replaced
    // (because the var was skipped).
    expect(output).toContain('    qa@example.com');

    // A warning was written to stderr.
    expect(stderrSpy).toHaveBeenCalledOnce();
    const warnMsg = (stderrSpy.mock.calls[0] as unknown[])[0] as string;
    expect(warnMsg).toContain('VALID_EMAIL');
    expect(warnMsg).toContain('already defined');
  });

  it('inserts only non-colliding vars when collision is partial', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = makeResult(
      [
        { name: 'VALID_EMAIL', value: 'qa@example.com' }, // collision
        { name: 'VALID_PASSWORD', value: 'Hunter2!' }, // safe
      ],
      [
        { actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
        { actionIdx: 1, field: 'text', oldValue: 'Hunter2!', varName: 'VALID_PASSWORD' },
      ],
    );
    const output = robotEmitter.applyExtraction(SOURCE, result);

    // Safe var was inserted.
    expect(output).toContain('${VALID_PASSWORD}    Hunter2!');
    // Collision var NOT re-added.
    const emailDefs = (output.match(/\$\{VALID_EMAIL\}\s{4}/g) ?? []).length;
    expect(emailDefs).toBe(1); // only the existing definition
    // Only one stderr warning.
    expect(stderrSpy).toHaveBeenCalledOnce();
  });
});

// ── Unit tests for helper exports ────────────────────────────────────────────

describe('existingVarNames', () => {
  it('finds variables defined in Variables section', () => {
    const content = `*** Variables ***\n\${FOO}    bar\n\${BAZ}    qux\n`;
    const names = existingVarNames(content);
    expect(names.has('FOO')).toBe(true);
    expect(names.has('BAZ')).toBe(true);
  });

  it('returns empty set for content with no variable definitions', () => {
    const names = existingVarNames('*** Test Cases ***\nSome Test\n    Log    hello\n');
    expect(names.size).toBe(0);
  });
});

describe('buildVarBlock', () => {
  it('formats variable lines with 4-space separator', () => {
    const block = buildVarBlock([
      { name: 'EMAIL', value: 'a@b.com' },
      { name: 'PASS', value: 'secret' },
    ]);
    expect(block).toBe('${EMAIL}    a@b.com\n${PASS}    secret');
  });

  it('returns empty string for empty array', () => {
    expect(buildVarBlock([])).toBe('');
  });
});

describe('insertVariablesSection — edge cases', () => {
  it('appends at EOF when neither Variables nor Test Cases section exists', () => {
    const content = `Some content\nwithout sections`;
    const output = insertVariablesSection(content, [{ name: 'X', value: 'y' }]);
    expect(output).toContain('*** Variables ***');
    expect(output).toContain('${X}    y');
  });
});
