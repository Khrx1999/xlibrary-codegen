/**
 * Unit tests for the -l/--lang CLI flag and extension-based inference.
 *
 * Only the two pure helper functions are tested here:
 *   - inferLangFromOutput()  — extension → LangTarget table
 *   - resolveLang()          — explicit flag + extension → final LangTarget + warning
 *
 * These are pure (no I/O, no Commander, no browser) so they run instantly.
 * The acceptance criteria from docs/v0.2-spec.md §1.1-1.2 are annotated inline.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { inferLangFromOutput, resolveLang } from '../src/codegen/lang-inference.js';

// ---------------------------------------------------------------------------
// inferLangFromOutput — extension table
// ---------------------------------------------------------------------------

describe('inferLangFromOutput — extension table', () => {
  // spec: xlibrary codegen -o login.robot → options.lang === 'robot'
  it('.robot → robot', () => {
    expect(inferLangFromOutput('login.robot')).toBe('robot');
  });

  it('.robot with path prefix → robot', () => {
    expect(inferLangFromOutput('tests/login.robot')).toBe('robot');
  });

  // spec: xlibrary codegen -o foo.selenium.robot → 'selenium'
  it('.selenium.robot → selenium (multi-segment suffix takes priority over .robot)', () => {
    expect(inferLangFromOutput('foo.selenium.robot')).toBe('selenium');
  });

  it('.selenium.robot with path prefix → selenium', () => {
    expect(inferLangFromOutput('tests/foo.selenium.robot')).toBe('selenium');
  });

  // spec: xlibrary codegen -o test.spec.ts → 'ts'
  it('.spec.ts → ts', () => {
    expect(inferLangFromOutput('test.spec.ts')).toBe('ts');
  });

  // spec: xlibrary codegen -o test.ts → 'ts'
  it('.ts → ts', () => {
    expect(inferLangFromOutput('test.ts')).toBe('ts');
  });

  // spec: xlibrary codegen -o test.py → 'python'
  it('.py → python', () => {
    expect(inferLangFromOutput('test.py')).toBe('python');
  });

  // spec: xlibrary codegen (no -o, no -l) → 'robot', output default 'recorded.robot'
  it('undefined → robot (no output specified)', () => {
    expect(inferLangFromOutput(undefined)).toBe('robot');
  });

  it('empty string → robot', () => {
    expect(inferLangFromOutput('')).toBe('robot');
  });

  it('unknown extension → robot (default)', () => {
    expect(inferLangFromOutput('output.json')).toBe('robot');
    expect(inferLangFromOutput('output.txt')).toBe('robot');
    expect(inferLangFromOutput('noextension')).toBe('robot');
  });

  it('extension matching is case-insensitive', () => {
    expect(inferLangFromOutput('Test.ROBOT')).toBe('robot');
    expect(inferLangFromOutput('Test.PY')).toBe('python');
    expect(inferLangFromOutput('Test.TS')).toBe('ts');
    expect(inferLangFromOutput('Foo.Selenium.Robot')).toBe('selenium');
  });
});

// ---------------------------------------------------------------------------
// resolveLang — explicit flag + extension arbitration
// ---------------------------------------------------------------------------

describe('resolveLang — explicit flag wins, warns on mismatch', () => {
  beforeEach(() => {
    // resolveLang uses console.warn for mismatch warnings — silence and capture.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Silence console.error used for invalid-lang messages.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // spec: xlibrary codegen (no -o, no -l) → 'robot', output default 'recorded.robot'
  it('no flag, no output → robot', () => {
    expect(resolveLang(undefined, undefined)).toBe('robot');
  });

  it('no flag, -o login.robot → robot', () => {
    expect(resolveLang(undefined, 'login.robot')).toBe('robot');
  });

  it('no flag, -o test.py → python', () => {
    expect(resolveLang(undefined, 'test.py')).toBe('python');
  });

  it('no flag, -o test.spec.ts → ts', () => {
    expect(resolveLang(undefined, 'test.spec.ts')).toBe('ts');
  });

  it('no flag, -o test.ts → ts', () => {
    expect(resolveLang(undefined, 'test.ts')).toBe('ts');
  });

  it('no flag, -o foo.selenium.robot → selenium', () => {
    expect(resolveLang(undefined, 'foo.selenium.robot')).toBe('selenium');
  });

  // spec: xlibrary codegen -l ts -o test.robot → 'ts' + warn to stderr
  it('explicit -l ts + -o test.robot → ts (explicit wins), emits warning', () => {
    const result = resolveLang('ts', 'test.robot');
    expect(result).toBe('ts');

    // Warning should mention the conflict.
    const warnCalls = (console.warn as ReturnType<typeof vi.spyOn>).mock.calls;
    expect(warnCalls.length).toBeGreaterThan(0);
    const warnText = warnCalls.map((c) => String(c[0])).join('\n');
    expect(warnText).toContain('-l ts');
    expect(warnText).toContain('test.robot');
    expect(warnText).toContain('robot'); // "which implies 'robot'"
  });

  // When explicit flag agrees with extension, no warning.
  it('explicit -l robot + -o login.robot → robot, no warning', () => {
    const result = resolveLang('robot', 'login.robot');
    expect(result).toBe('robot');
    const warnCalls = (console.warn as ReturnType<typeof vi.spyOn>).mock.calls;
    expect(warnCalls.length).toBe(0);
  });

  it('explicit -l python + no -o → python, no warning', () => {
    const result = resolveLang('python', undefined);
    expect(result).toBe('python');
    const warnCalls = (console.warn as ReturnType<typeof vi.spyOn>).mock.calls;
    expect(warnCalls.length).toBe(0);
  });

  it('explicit -l selenium + -o any.selenium.robot → selenium, no warning', () => {
    const result = resolveLang('selenium', 'any.selenium.robot');
    expect(result).toBe('selenium');
    const warnCalls = (console.warn as ReturnType<typeof vi.spyOn>).mock.calls;
    expect(warnCalls.length).toBe(0);
  });

  it('explicit -l ts + -o test.spec.ts → ts, no warning', () => {
    const result = resolveLang('ts', 'test.spec.ts');
    expect(result).toBe('ts');
    const warnCalls = (console.warn as ReturnType<typeof vi.spyOn>).mock.calls;
    expect(warnCalls.length).toBe(0);
  });

  // Mismatch cases other than the one in the spec.
  it('explicit -l robot + -o test.py → robot, emits warning', () => {
    const result = resolveLang('robot', 'test.py');
    expect(result).toBe('robot');
    const warnCalls = (console.warn as ReturnType<typeof vi.spyOn>).mock.calls;
    expect(warnCalls.length).toBeGreaterThan(0);
  });

  it('explicit -l selenium + -o test.robot → selenium, emits warning', () => {
    const result = resolveLang('selenium', 'test.robot');
    expect(result).toBe('selenium');
    const warnCalls = (console.warn as ReturnType<typeof vi.spyOn>).mock.calls;
    expect(warnCalls.length).toBeGreaterThan(0);
  });

  // Invalid lang value — resolveLang calls process.exit(1).
  it('invalid -l value → calls process.exit(1)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    expect(() => resolveLang('java', 'test.robot')).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
