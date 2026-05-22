/**
 * Tests for the `xlibrary extract` command orchestration.
 *
 * What we test here:
 *   - The VariableEmitter interface contract is satisfied by stubs
 *   - orchestrateExtraction() detects variables and calls the emitter
 *   - `--yes` skips the confirm prompt
 *   - No sidecar → actionable error message
 *   - In-place edit creates a .bak backup
 *   - `output` option writes to a different file (no .bak on source)
 *   - Empty detection (no variables found) → returns false, no file written
 *
 * The per-language VariableEmitter is mocked — this suite tests CLI orchestration
 * without depending on Task #14 implementations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Module under test ────────────────────────────────────────────────────────
import {
  orchestrateExtraction,
  getEmitterForLang,
  type VariableEmitter,
} from '../src/wizard/extract-orchestrator.js';
import type { DetectionResult } from '../src/wizard/detector.js';
import type { ActionInContext } from '../src/types.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Create a minimal ActionInContext for testing. */
function makeFillAction(selector: string, text: string, idx = 0): ActionInContext {
  return {
    frame: { pageGuid: 'page1', pageAlias: 'page', framePath: [] },
    action: {
      name: 'fill',
      selector,
      text,
      signals: [],
    } as unknown as ActionInContext['action'],
    startTime: 1000 + idx,
  };
}

/** Build a minimal JSONL sidecar with a header + fill actions. */
function buildSidecar(actions: Array<{ selector: string; text: string }>): string {
  const header = JSON.stringify({
    xlib: 1,
    'recorded-at': '2026-05-22T12:00:00.000Z',
    browser: 'chromium',
    'test-name': 'Test Flow',
  });
  const lines = [header];
  for (const a of actions) {
    lines.push(
      JSON.stringify({
        name: 'fill',
        selector: a.selector,
        text: a.text,
        signals: [],
        pageGuid: 'page1',
        pageAlias: 'page',
        framePath: [],
      }),
    );
  }
  return lines.join('\n') + '\n';
}

/** Create a temp directory, returning the path. */
async function createTempDir(prefix = 'xlibrary-test'): Promise<string> {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ── Spy on console to suppress wizard output in tests ────────────────────────

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// VariableEmitter interface
// ─────────────────────────────────────────────────────────────────────────────

describe('VariableEmitter stub (getEmitterForLang)', () => {
  it('returns an object with applyExtraction()', () => {
    const emitter = getEmitterForLang('robot');
    expect(typeof emitter.applyExtraction).toBe('function');
  });

  it('applyExtraction inserts *** Variables *** and substitutes literal values', () => {
    // After Task #14 merge: getEmitterForLang returns REAL emitters,
    // not stubs. This test now asserts the real behavior.
    const emitter = getEmitterForLang('robot');
    const source = '*** Test Cases ***\nLogin Flow\n    Fill Text    css=input    secret\n';
    const result: DetectionResult = {
      variables: [
        {
          name: 'VALID_PASSWORD',
          value: 'secret',
          occurrences: 1,
          sourceActions: [0],
          semantic: 'password',
        },
      ],
      substitutions: new Map([
        [0, [{ field: 'text', oldValue: 'secret', varName: 'VALID_PASSWORD' }]],
      ]),
    };
    const output = emitter.applyExtraction(source, result);
    expect(output).toContain('*** Variables ***');
    expect(output).toContain('${VALID_PASSWORD}    secret');
    expect(output).toContain('Fill Text    css=input    ${VALID_PASSWORD}');
    expect(output).not.toMatch(/Fill Text {4}css=input {4}secret/);
  });

  it('a custom VariableEmitter injected by tests can modify content', () => {
    // Demonstrates the injection point: Task #14 swaps getEmitterForLang.
    const customEmitter: VariableEmitter = {
      applyExtraction(content: string, _result: DetectionResult): string {
        return content.replace('secret', '${VALID_PASSWORD}');
      },
    };

    const source = '    Fill Text    css=input    secret';
    const result: DetectionResult = { variables: [], substitutions: new Map() };
    expect(customEmitter.applyExtraction(source, result)).toBe(
      '    Fill Text    css=input    ${VALID_PASSWORD}',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// orchestrateExtraction() — happy paths
// ─────────────────────────────────────────────────────────────────────────────

describe('orchestrateExtraction() — happy path', () => {
  it('detects variables from pre-loaded actions and applies with --yes', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'test.robot');

    const sourceContent =
      '*** Test Cases ***\nLogin\n    Fill Text    input[type="email"]    qa@example.com\n';
    await writeFile(sourceFile, sourceContent, 'utf8');

    const actions: ActionInContext[] = [makeFillAction('input[type="email"]', 'qa@example.com')];

    const applied = await orchestrateExtraction({
      sourceFile,
      actions,
      yes: true,
    });

    // Real emitter (Task #14) applies the extraction.
    expect(applied).toBe(true);

    // Backup should exist
    expect(existsSync(`${sourceFile}.bak`)).toBe(true);

    // Source file should now contain the *** Variables *** section + the substitution.
    const written = await readFile(sourceFile, 'utf8');
    expect(written).toContain('*** Variables ***');
    expect(written).toContain('${VALID_EMAIL}    qa@example.com');
    expect(written).toContain('${VALID_EMAIL}');
    expect(written).not.toMatch(/Fill Text {4}input\[type="email"\] {4}qa@example\.com/);

    await rm(dir, { recursive: true, force: true });
  });

  it('writes to a separate output file when --output is specified', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'test.robot');
    const outputFile = join(dir, 'test-extracted.robot');

    const sourceContent = '*** Test Cases ***\nLogin\n    Fill Text    css=input    secret\n';
    await writeFile(sourceFile, sourceContent, 'utf8');

    const actions: ActionInContext[] = [makeFillAction('[type="password"]', 'secret')];

    await orchestrateExtraction({
      sourceFile,
      actions,
      output: outputFile,
      yes: true,
    });

    // Output file written
    expect(existsSync(outputFile)).toBe(true);
    // Source NOT backed up (separate output → no .bak on source)
    expect(existsSync(`${sourceFile}.bak`)).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });

  it('loads actions from sidecar .jsonl when actions are not pre-loaded', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'flow.robot');
    const sidecarFile = `${sourceFile}.jsonl`;

    await writeFile(
      sourceFile,
      '*** Test Cases ***\nFlow\n    Fill Text    css=input    test@mail.com\n',
      'utf8',
    );
    await writeFile(
      sidecarFile,
      buildSidecar([{ selector: 'input[type="email"]', text: 'test@mail.com' }]),
      'utf8',
    );

    const applied = await orchestrateExtraction({
      sourceFile,
      yes: true,
    });

    expect(applied).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });

  it('uses --actions override instead of default sidecar path', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'test.robot');
    const customSidecar = join(dir, 'custom-actions.jsonl');

    await writeFile(
      sourceFile,
      '*** Test Cases ***\nTest\n    Fill Text    css=input    pa$$word\n',
      'utf8',
    );
    await writeFile(
      customSidecar,
      buildSidecar([{ selector: '[type="password"]', text: 'pa$$word' }]),
      'utf8',
    );

    const applied = await orchestrateExtraction({
      sourceFile,
      actionsFile: customSidecar,
      yes: true,
    });

    expect(applied).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// orchestrateExtraction() — empty detection
// ─────────────────────────────────────────────────────────────────────────────

describe('orchestrateExtraction() — empty detection', () => {
  it('returns false and writes nothing when no variables detected', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'no-vars.robot');
    const sourceContent = '*** Test Cases ***\nClick Only\n    Click    css=button\n';

    await writeFile(sourceFile, sourceContent, 'utf8');

    // A click action has no extractable text values
    const actions: ActionInContext[] = [
      {
        frame: { pageGuid: 'p', pageAlias: 'page', framePath: [] },
        action: {
          name: 'click',
          selector: 'css=button',
          button: 'left',
          modifiers: 0,
          clickCount: 1,
          signals: [],
        } as unknown as ActionInContext['action'],
        startTime: 1000,
      },
    ];

    const applied = await orchestrateExtraction({
      sourceFile,
      actions,
      yes: true,
    });

    expect(applied).toBe(false);
    // No .bak should be written when nothing was applied
    expect(existsSync(`${sourceFile}.bak`)).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// orchestrateExtraction() — error cases
// ─────────────────────────────────────────────────────────────────────────────

describe('orchestrateExtraction() — error cases', () => {
  it('throws an actionable error when the source file does not exist', async () => {
    await expect(
      orchestrateExtraction({
        sourceFile: '/nonexistent/path/test.robot',
        actions: [makeFillAction('css=input', 'value')],
        yes: true,
      }),
    ).rejects.toThrow('source file not found');
  });

  it('throws an actionable error when sidecar .jsonl is missing', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'test.robot');
    await writeFile(sourceFile, '*** Test Cases ***\n', 'utf8');

    await expect(
      orchestrateExtraction({
        sourceFile,
        // No actions provided and no sidecar file
        yes: true,
      }),
    ).rejects.toThrow('extract requires a sidecar .jsonl');

    await rm(dir, { recursive: true, force: true });
  });

  it('throws an actionable error when --actions path does not exist', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'test.robot');
    await writeFile(sourceFile, '*** Test Cases ***\n', 'utf8');

    await expect(
      orchestrateExtraction({
        sourceFile,
        actionsFile: join(dir, 'missing-actions.jsonl'),
        yes: true,
      }),
    ).rejects.toThrow('extract requires a sidecar .jsonl');

    await rm(dir, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// orchestrateExtraction() — user declines
// ─────────────────────────────────────────────────────────────────────────────

describe('orchestrateExtraction() — user declines', () => {
  it('returns false and writes nothing when _confirmFn returns false', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'test.robot');
    const sourceContent =
      '*** Test Cases ***\nLogin\n    Fill Text    input[type=email]    qa@test.com\n';
    await writeFile(sourceFile, sourceContent, 'utf8');

    const actions: ActionInContext[] = [makeFillAction('input[type=email]', 'qa@test.com')];
    const applied = await orchestrateExtraction({
      sourceFile,
      actions,
      yes: false,
      _confirmFn: () => Promise.resolve(false), // simulates user answering 'n'
    });

    expect(applied).toBe(false);
    expect(existsSync(`${sourceFile}.bak`)).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });

  it('returns true and writes when _confirmFn returns true', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'test.robot');
    const sourceContent =
      '*** Test Cases ***\nLogin\n    Fill Text    input[type=email]    qa@test.com\n';
    await writeFile(sourceFile, sourceContent, 'utf8');

    const actions: ActionInContext[] = [makeFillAction('input[type=email]', 'qa@test.com')];
    const applied = await orchestrateExtraction({
      sourceFile,
      actions,
      yes: false,
      _confirmFn: () => Promise.resolve(true), // simulates user answering 'y'
    });

    expect(applied).toBe(true);
    expect(existsSync(`${sourceFile}.bak`)).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dedup behaviour (via detectVariables integration)
// ─────────────────────────────────────────────────────────────────────────────

describe('orchestrateExtraction() — variable detection integration', () => {
  it('deduplicates same value across multiple actions', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'dedup.robot');
    await writeFile(
      sourceFile,
      '*** Test Cases ***\nDedup\n    Fill Text    css=input    qa@a.com\n',
      'utf8',
    );

    // Two fill actions with the same email value
    const actions: ActionInContext[] = [
      makeFillAction('input[type="email"]', 'qa@example.com', 0),
      makeFillAction('input[type="email"]', 'qa@example.com', 1),
    ];

    // Use _emitter injection to capture the DetectionResult without ESM spy issues.
    let capturedResult: DetectionResult | undefined;
    const capturingEmitter: VariableEmitter = {
      applyExtraction(content: string, result: DetectionResult): string {
        capturedResult = result;
        return content;
      },
    };

    await orchestrateExtraction({
      sourceFile,
      actions,
      yes: true,
      _emitter: capturingEmitter,
    });

    expect(capturedResult).toBeDefined();
    // Same value → single variable with occurrences=2
    expect(capturedResult!.variables).toHaveLength(1);
    expect(capturedResult!.variables[0].occurrences).toBe(2);
    expect(capturedResult!.variables[0].name).toBe('VALID_EMAIL');

    await rm(dir, { recursive: true, force: true });
  });

  it('multiple distinct values in same semantic → numbered suffix', async () => {
    const dir = await createTempDir();
    const sourceFile = join(dir, 'multi-email.robot');
    await writeFile(sourceFile, '*** Test Cases ***\nTest\n', 'utf8');

    const actions: ActionInContext[] = [
      makeFillAction('input[type="email"]', 'first@example.com', 0),
      makeFillAction('input[type="email"]', 'second@example.com', 1),
    ];

    let capturedResult: DetectionResult | undefined;
    const capturingEmitter: VariableEmitter = {
      applyExtraction(content: string, result: DetectionResult): string {
        capturedResult = result;
        return content;
      },
    };

    await orchestrateExtraction({
      sourceFile,
      actions,
      yes: true,
      _emitter: capturingEmitter,
    });

    expect(capturedResult).toBeDefined();
    expect(capturedResult!.variables).toHaveLength(2);
    expect(capturedResult!.variables[0].name).toBe('VALID_EMAIL');
    expect(capturedResult!.variables[1].name).toBe('VALID_EMAIL_2');

    await rm(dir, { recursive: true, force: true });
  });
});
