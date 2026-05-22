/**
 * Tests for src/cli-emit.ts (runEmit)
 *
 * Covers:
 *   - emit -l robot produces valid Robot Framework output from fixture JSONL
 *   - emit -l selenium produces SeleniumLibrary output from the same fixture
 *   - --test-name overrides the header's test-name
 *   - ts/python hard-fail with the v0.2 message
 *   - Unknown lang hard-fails
 *   - Missing input file throws ENOENT-friendly message
 *   - Non-xlibrary JSONL (no header) throws clear message
 *
 * The fixture JSONL is: tests/fixtures/login-flow.jsonl
 * (header + 5 actions: openPage, fill×2, click, assertText)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEmit } from '../src/cli-emit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_JSONL = resolve(__dirname, 'fixtures/login-flow.jsonl');
const TMP_DIR = resolve(__dirname, '__emit-tmp__');

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function outPath(name: string): string {
  return resolve(TMP_DIR, name);
}

// ─────────────────────────────────────────────────────────────────────────────
// robot target
// ─────────────────────────────────────────────────────────────────────────────

describe('emit -l robot', () => {
  it('produces a .robot file with *** Settings *** and *** Test Cases ***', async () => {
    const output = outPath('robot-emit.robot');
    await runEmit({ actionsFile: FIXTURE_JSONL, lang: 'robot', output });

    expect(existsSync(output)).toBe(true);
    const content = readFileSync(output, 'utf8');
    expect(content).toContain('*** Settings ***');
    expect(content).toContain('Library    Browser');
    expect(content).toContain('*** Test Cases ***');
    // Test name comes from JSONL header
    expect(content).toContain('Login Flow');
  });

  it('includes expected keyword steps for login-flow fixture', async () => {
    const output = outPath('robot-emit-steps.robot');
    await runEmit({ actionsFile: FIXTURE_JSONL, lang: 'robot', output });

    const content = readFileSync(output, 'utf8');
    // openPage → New Page (collapsed with navigate; direct openPage url)
    expect(content).toContain('New Page');
    // fill actions
    expect(content).toContain('Fill Text');
    // click action
    expect(content).toContain('Click');
    // assertText action
    expect(content).toContain('Get Text');
    // footer
    expect(content).toContain('Close Browser');
  });

  it('--test-name overrides JSONL header test name', async () => {
    const output = outPath('robot-emit-testname.robot');
    await runEmit({
      actionsFile: FIXTURE_JSONL,
      lang: 'robot',
      output,
      testName: 'Custom Test Name',
    });

    const content = readFileSync(output, 'utf8');
    expect(content).toContain('Custom Test Name');
    // The JSONL header name should NOT appear as test name
    // (it may appear in comments, but not as the test case header)
    const lines = content.split('\n');
    const testCaseIdx = lines.findIndex((l) => l.includes('*** Test Cases ***'));
    expect(testCaseIdx).toBeGreaterThan(-1);
    // The line after *** Test Cases *** should be the test name
    const testNameLine = lines[testCaseIdx + 1];
    expect(testNameLine).toContain('Custom Test Name');
  });

  it('output ends with a trailing newline', async () => {
    const output = outPath('robot-emit-newline.robot');
    await runEmit({ actionsFile: FIXTURE_JSONL, lang: 'robot', output });
    const content = await readFile(output, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selenium target
// ─────────────────────────────────────────────────────────────────────────────

describe('emit -l selenium', () => {
  it('produces a .robot file with SeleniumLibrary import', async () => {
    const output = outPath('selenium-emit.robot');
    await runEmit({ actionsFile: FIXTURE_JSONL, lang: 'selenium', output });

    expect(existsSync(output)).toBe(true);
    const content = readFileSync(output, 'utf8');
    expect(content).toContain('*** Settings ***');
    expect(content).toContain('SeleniumLibrary');
    expect(content).toContain('*** Test Cases ***');
    expect(content).toContain('Login Flow');
  });

  it('uses SeleniumLibrary keywords (not Browser Library)', async () => {
    const output = outPath('selenium-emit-kw.robot');
    await runEmit({ actionsFile: FIXTURE_JSONL, lang: 'selenium', output });

    const content = readFileSync(output, 'utf8');
    // SeleniumLibrary does NOT use "Fill Text" — uses "Input Text"
    expect(content).not.toContain('Fill Text');
    expect(content).toContain('Input Text');
    // SeleniumLibrary does not use "Close Browser" via BL; uses "Close Browser" too but
    // the library import line is the key differentiator
    expect(content).toContain('SeleniumLibrary');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-target round-trip: same actions → different syntax
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-target round-trip', () => {
  it('robot and selenium outputs both have same number of non-empty lines (approx)', async () => {
    const robotOut = outPath('crosscheck-robot.robot');
    const seleniumOut = outPath('crosscheck-selenium.robot');
    await runEmit({ actionsFile: FIXTURE_JSONL, lang: 'robot', output: robotOut });
    await runEmit({ actionsFile: FIXTURE_JSONL, lang: 'selenium', output: seleniumOut });

    const robotLines = readFileSync(robotOut, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'));
    const seleniumLines = readFileSync(seleniumOut, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'));

    // They won't be identical but should be within a factor of 2 (same action count,
    // different header lines — SeleniumLibrary has no New Browser / New Context).
    expect(Math.abs(robotLines.length - seleniumLines.length)).toBeLessThan(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Post-v0.2 hard-fail
// ─────────────────────────────────────────────────────────────────────────────

describe('post-v0.2 hard-fail', () => {
  const expectedMsg = 'emit for ts/python is post-v0.2';

  it('ts throws with v0.2 message', async () => {
    const output = outPath('should-not-exist.ts');
    await expect(runEmit({ actionsFile: FIXTURE_JSONL, lang: 'ts', output })).rejects.toThrow(
      expectedMsg,
    );
    expect(existsSync(output)).toBe(false);
  });

  it('typescript throws with v0.2 message', async () => {
    const output = outPath('should-not-exist2.ts');
    await expect(
      runEmit({ actionsFile: FIXTURE_JSONL, lang: 'typescript', output }),
    ).rejects.toThrow(expectedMsg);
  });

  it('python throws with v0.2 message', async () => {
    const output = outPath('should-not-exist.py');
    await expect(runEmit({ actionsFile: FIXTURE_JSONL, lang: 'python', output })).rejects.toThrow(
      expectedMsg,
    );
  });

  it('python-pytest throws with v0.2 message', async () => {
    const output = outPath('should-not-exist2.py');
    await expect(
      runEmit({ actionsFile: FIXTURE_JSONL, lang: 'python-pytest', output }),
    ).rejects.toThrow(expectedMsg);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown target
// ─────────────────────────────────────────────────────────────────────────────

describe('unknown target', () => {
  it('throws with a clear message listing supported targets', async () => {
    const output = outPath('unknown.out');
    await expect(runEmit({ actionsFile: FIXTURE_JSONL, lang: 'java', output })).rejects.toThrow(
      /Unknown target "java"/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error cases: missing file / invalid header
// ─────────────────────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws friendly message when input file does not exist', async () => {
    const output = outPath('never.robot');
    await expect(
      runEmit({
        actionsFile: '/nonexistent/path/does-not-exist.jsonl',
        lang: 'robot',
        output,
      }),
    ).rejects.toThrow(/actions file not found/);
  });

  it('throws friendly message when file has no xlibrary header', async () => {
    // Write a plain Playwright JSONL (no xlib header)
    const badFile = outPath('bad-header.jsonl');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      badFile,
      `{"version":1,"browserName":"chromium"}\n{"name":"click","selector":"css=#a","signals":[]}\n`,
    );

    const output = outPath('from-bad.robot');
    await expect(runEmit({ actionsFile: badFile, lang: 'robot', output })).rejects.toThrow(
      /not a valid xlibrary header/,
    );
  });
});
