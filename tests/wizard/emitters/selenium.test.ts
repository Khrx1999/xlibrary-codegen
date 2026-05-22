/**
 * Tests for the Selenium `.robot` variable emitter.
 *
 * SeleniumLibrary files share identical Robot Framework syntax with Browser
 * Library files — only the keyword names and Library import line differ.
 * These tests verify that seleniumEmitter correctly processes `.robot` files
 * that contain `Library    SeleniumLibrary` and SeleniumLibrary-style keywords.
 *
 * Structural equivalence is verified by confirming seleniumEmitter produces
 * the same output as robotEmitter when given the same input.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { seleniumEmitter } from '../../../src/wizard/emitters/selenium.js';
import { robotEmitter } from '../../../src/wizard/emitters/robot.js';
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

const SELENIUM_SOURCE = `*** Settings ***
Library    SeleniumLibrary

*** Test Cases ***
Login Flow
    Open Browser    https://example.com    chrome
    Input Text    id:email    qa@example.com
    Input Password    id:password    Hunter2!
    Click Button    id:submit
    Close Browser
`;

// ── 1. No Variables section — inserts above Test Cases ───────────────────────

describe('seleniumEmitter — no Variables section', () => {
  it('inserts *** Variables *** section with correct format', () => {
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
    const output = seleniumEmitter.applyExtraction(SELENIUM_SOURCE, result);

    expect(output).toContain('*** Variables ***');
    expect(output).toContain('${VALID_EMAIL}    qa@example.com');
    expect(output).toContain('${VALID_PASSWORD}    Hunter2!');
    expect(output).toContain('Input Text    id:email    ${VALID_EMAIL}');
    expect(output).toContain('Input Password    id:password    ${VALID_PASSWORD}');
  });

  it('produces identical output to robotEmitter for the same input', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const robotOut = robotEmitter.applyExtraction(SELENIUM_SOURCE, result);
    const seleniumOut = seleniumEmitter.applyExtraction(SELENIUM_SOURCE, result);
    expect(seleniumOut).toBe(robotOut);
  });
});

// ── 2. Variables section already exists ──────────────────────────────────────

describe('seleniumEmitter — Variables section already exists', () => {
  const SOURCE_WITH_VARS = `*** Settings ***
Library    SeleniumLibrary

*** Variables ***
\${BASE_URL}    https://example.com

*** Test Cases ***
Login Flow
    Open Browser    \${BASE_URL}    chrome
    Input Text    id:email    qa@example.com
    Close Browser
`;

  it('appends new variable and preserves existing', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = seleniumEmitter.applyExtraction(SOURCE_WITH_VARS, result);

    expect(output).toContain('${BASE_URL}    https://example.com');
    expect(output).toContain('${VALID_EMAIL}    qa@example.com');
    expect(output).toContain('Input Text    id:email    ${VALID_EMAIL}');
  });

  it('snapshot — selenium Variables section extended', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = seleniumEmitter.applyExtraction(SOURCE_WITH_VARS, result);
    expect(output).toMatchInlineSnapshot(`
"*** Settings ***
Library    SeleniumLibrary

*** Variables ***
\${BASE_URL}    https://example.com

\${VALID_EMAIL}    qa@example.com
*** Test Cases ***
Login Flow
    Open Browser    \${BASE_URL}    chrome
    Input Text    id:email    \${VALID_EMAIL}
    Close Browser
"`);
  });
});

// ── 3. Multiple substitutions — deduplication ────────────────────────────────

describe('seleniumEmitter — multiple substitutions same variable', () => {
  const SOURCE = `*** Settings ***
Library    SeleniumLibrary

*** Test Cases ***
Email Verification
    Input Text    id:email1    qa@example.com
    Input Text    id:email2    qa@example.com
    Close Browser
`;

  it('emits one variable declaration, replaces all occurrences', () => {
    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [
        { actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
        { actionIdx: 1, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' },
      ],
    );
    const output = seleniumEmitter.applyExtraction(SOURCE, result);

    const defs = (output.match(/\$\{VALID_EMAIL\}\s{4}qa@example\.com/g) ?? []).length;
    expect(defs).toBe(1);
    const refs = (output.match(/Input Text.*\$\{VALID_EMAIL\}/g) ?? []).length;
    expect(refs).toBe(2);
  });
});

// ── 4. Collision handling ─────────────────────────────────────────────────────

describe('seleniumEmitter — collision handling', () => {
  const SOURCE_WITH_COLLISION = `*** Settings ***
Library    SeleniumLibrary

*** Variables ***
\${VALID_EMAIL}    old@example.com

*** Test Cases ***
Login Flow
    Input Text    id:email    qa@example.com
    Close Browser
`;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips duplicate variable and warns on stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = makeResult(
      [{ name: 'VALID_EMAIL', value: 'qa@example.com' }],
      [{ actionIdx: 0, field: 'text', oldValue: 'qa@example.com', varName: 'VALID_EMAIL' }],
    );
    const output = seleniumEmitter.applyExtraction(SOURCE_WITH_COLLISION, result);

    // Existing definition preserved.
    expect(output).toContain('${VALID_EMAIL}    old@example.com');
    // Only one definition.
    const defCount = (output.match(/\$\{VALID_EMAIL\}\s{4}/g) ?? []).length;
    expect(defCount).toBe(1);
    // Literal NOT replaced.
    expect(output).toContain('    qa@example.com');
    // Warning issued.
    expect(stderrSpy).toHaveBeenCalledOnce();
  });
});
