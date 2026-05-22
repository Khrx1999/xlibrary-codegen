/**
 * tests/cli-patch-ops.test.ts
 *
 * Integration tests for `xlibrary patch <file> --at <N>` end-to-end
 * (with the stub NewStepProvider callback).
 *
 * These tests exercise the full await runPatch() → operations → atomic write
 * pipeline using real temporary files on disk.  Each test creates its own
 * isolated fixture file so mutations don't interfere.
 *
 * Acceptance criteria:
 *   - --at <N>: file mutated (step replaced by stub content), .bak written
 *   - --insert-after <N>: file gains one more step, .bak written
 *   - --insert-before <N>: file gains one more step
 *   - --delete <N>: step removed, renumbered
 *   - --delete <N>-<M>: range removed
 *   - --move <X> to <Y>: step reordered
 *   - --no-backup: .bak not created
 *   - --at <N> --range <F>-<T>: range replaced
 *   - Atomicity: original content preserved on .bak, new content in file
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  mkdtempSync,
  rmdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPatch } from '../src/cli-patch.js';
import { parseSteps } from '../src/patch/step-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** 4-step Robot Framework file. */
const RF_FIXTURE = `*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=\${False}
    New Page    https://example.com/login
    # xlib:step=1
    Fill Text    css=#username    admin
    # xlib:step=2
    Fill Text    css=#password    secret
    # xlib:step=3
    Click    css=#login-btn
    # xlib:step=4
    Close Browser
`;

// ─────────────────────────────────────────────────────────────────────────────
// Per-test temp dir setup
// ─────────────────────────────────────────────────────────────────────────────

// Each test creates its own temp file and cleans up in afterEach.
const createdFiles: string[] = [];
let tmpDir: string;

function freshFile(name = 'test.robot', content = RF_FIXTURE): string {
  if (!tmpDir) {
    tmpDir = mkdtempSync(join(tmpdir(), 'xlibrary-ops-test-'));
  }
  const path = join(tmpDir, name);
  writeFileSync(path, content, 'utf8');
  createdFiles.push(path);
  createdFiles.push(`${path}.bak`); // pre-register bak for cleanup
  return path;
}

afterEach(() => {
  for (const f of createdFiles.splice(0)) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  if (tmpDir) {
    try {
      rmdirSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
    tmpDir = '';
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// --at <N>  (replace)
// ─────────────────────────────────────────────────────────────────────────────

describe('xlibrary patch --at integration', () => {
  it('--at 3 replaces step 3 (Fill Text password) with stub content', async () => {
    const file = freshFile();
    const origContent = readFileSync(file, 'utf8');

    const code = await runPatch(file, { at: '3' });
    expect(code).toBe(0);

    const newContent = readFileSync(file, 'utf8');
    // File has changed
    expect(newContent).not.toBe(origContent);
    // Step 3's original keyword is gone
    expect(newContent).not.toContain('Fill Text    css=#password    secret');
    // Stub content is present
    expect(newContent).toContain('NEW STEP via xlib patch');
    // Still 4 step markers
    const markers = newContent.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
    // Markers renumbered 1-4
    expect(markers).toEqual(['xlib:step=1', 'xlib:step=2', 'xlib:step=3', 'xlib:step=4']);
  });

  it('--at 1 replaces step 1 (New Page)', async () => {
    const file = freshFile();
    const code = await runPatch(file, { at: '1' });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    expect(content).not.toContain('New Page    https://example.com/login');
    expect(content).toContain('NEW STEP via xlib patch');
  });

  it('--at 4 replaces step 4 (Click)', async () => {
    const file = freshFile();
    const code = await runPatch(file, { at: '4' });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    expect(content).not.toContain('Click    css=#login-btn');
    expect(content).toContain('NEW STEP via xlib patch');
  });

  it('--at 2 with backup: .bak contains original content', async () => {
    const file = freshFile();
    const origContent = readFileSync(file, 'utf8');

    const code = await runPatch(file, { at: '2' }); // backup: true is default
    expect(code).toBe(0);

    const bakPath = `${file}.bak`;
    expect(existsSync(bakPath)).toBe(true);
    const bakContent = readFileSync(bakPath, 'utf8');
    expect(bakContent).toBe(origContent);
  });

  it('--at 1 --no-backup: .bak NOT created', async () => {
    const file = freshFile();
    const bakPath = `${file}.bak`;

    const code = await runPatch(file, { at: '1', backup: false });
    expect(code).toBe(0);
    expect(existsSync(bakPath)).toBe(false);
  });

  it('--at fuzzy "Click" replaces step 4 (unique match)', async () => {
    const file = freshFile();
    const code = await runPatch(file, { at: 'Click', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    expect(content).not.toContain('Click    css=#login-btn');
    expect(content).toContain('NEW STEP via xlib patch');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --at + --range  (range replace)
// ─────────────────────────────────────────────────────────────────────────────

describe('xlibrary patch --at + --range integration', () => {
  it('--at 2 --range 2-3 replaces steps 2-3 with single stub (3 steps remain)', async () => {
    const file = freshFile();
    const code = await runPatch(file, { at: '2', range: '2-3', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    const markers = content.match(/xlib:step=\d+/g);
    // Was 4 steps, replaced 2 with 1 → now 3 steps
    expect(markers).toHaveLength(3);
    expect(content).not.toContain('Fill Text    css=#username');
    expect(content).not.toContain('Fill Text    css=#password');
    expect(content).toContain('NEW STEP via xlib patch');
  });

  it('--range with invalid format → exit 1', async () => {
    const file = freshFile();
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(file, { at: '1', range: 'invalid', backup: false });
      expect(code).toBe(1);
      expect(errLogs.join('\n')).toContain('not a valid range');
    } finally {
      console.error = origErr;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --insert-after integration
// ─────────────────────────────────────────────────────────────────────────────

describe('xlibrary patch --insert-after integration', () => {
  it('--insert-after 2 adds stub after step 2 → 5 steps', async () => {
    const file = freshFile();
    const code = await runPatch(file, { insertAfter: '2', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    const markers = content.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
  });

  it('--insert-after 1 stub appears after step 1 marker', async () => {
    const file = freshFile();
    const code = await runPatch(file, { insertAfter: '1', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const step1MarkerIdx = lines.findIndex((l) => /xlib:step=1$/.test(l.trim()));
    const stubIdx = lines.findIndex((l) => l.includes('NEW STEP via xlib patch'));
    // stub appears after step=1 marker
    expect(stubIdx).toBeGreaterThan(step1MarkerIdx);
  });

  it('--insert-after 4 (last step) → stub becomes step 5', async () => {
    const file = freshFile();
    const code = await runPatch(file, { insertAfter: '4', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('xlib:step=5');
  });

  it('--insert-after: .bak written by default', async () => {
    const file = freshFile();
    const origContent = readFileSync(file, 'utf8');
    await runPatch(file, { insertAfter: '2' });
    const bakPath = `${file}.bak`;
    expect(existsSync(bakPath)).toBe(true);
    expect(readFileSync(bakPath, 'utf8')).toBe(origContent);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --insert-before integration
// ─────────────────────────────────────────────────────────────────────────────

describe('xlibrary patch --insert-before integration', () => {
  it('--insert-before 1 adds stub before step 1 → 5 steps', async () => {
    const file = freshFile();
    const code = await runPatch(file, { insertBefore: '1', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    const markers = content.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(5);
  });

  it('--insert-before 3 stub appears before step 3 keyword', async () => {
    const file = freshFile();
    const code = await runPatch(file, { insertBefore: '3', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const stubIdx = lines.findIndex((l) => l.includes('NEW STEP via xlib patch'));
    const fillPwdIdx = lines.findIndex((l) => l.includes('css=#password'));
    // stub appears before the original step 3 keyword
    expect(stubIdx).toBeLessThan(fillPwdIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --delete integration
// ─────────────────────────────────────────────────────────────────────────────

describe('xlibrary patch --delete integration', () => {
  it('--delete 2 removes step 2 → 3 steps remain', async () => {
    const file = freshFile();
    const code = await runPatch(file, { delete: '2', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    const markers = content.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(3);
    expect(content).not.toContain('Fill Text    css=#username    admin');
  });

  it('--delete 2-3 removes steps 2-3 → 2 steps remain', async () => {
    const file = freshFile();
    const code = await runPatch(file, { delete: '2-3', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    const markers = content.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(2);
    expect(content).not.toContain('Fill Text    css=#username');
    expect(content).not.toContain('Fill Text    css=#password');
  });

  it('--delete 1-4 (all steps) → no markers remain in file', async () => {
    const file = freshFile();
    const code = await runPatch(file, { delete: '1-4', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    expect(content).not.toContain('xlib:step=');
  });

  it('--delete: .bak written with original content', async () => {
    const file = freshFile();
    const origContent = readFileSync(file, 'utf8');
    await runPatch(file, { delete: '1' });
    const bakPath = `${file}.bak`;
    expect(existsSync(bakPath)).toBe(true);
    expect(readFileSync(bakPath, 'utf8')).toBe(origContent);
  });

  it('--delete 10 → exit 1 (step out of range)', async () => {
    const file = freshFile();
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(file, { delete: '10', backup: false });
      expect(code).toBe(1);
      expect(errLogs.join('\n')).toContain('step 10');
    } finally {
      console.error = origErr;
    }
  });

  it('--delete 4-2 (from > to) → exit 1', async () => {
    const file = freshFile();
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(file, { delete: '4-2', backup: false });
      expect(code).toBe(1);
    } finally {
      console.error = origErr;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --move integration
// ─────────────────────────────────────────────────────────────────────────────

describe('xlibrary patch --move integration', () => {
  it('--move "1 to 3" reorders: New Page appears after Fill Text password', async () => {
    const file = freshFile();
    const code = await runPatch(file, { move: '1 to 3', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const newPageIdx = lines.findIndex((l) => l.includes('New Page'));
    const fillPwdIdx = lines.findIndex((l) => l.includes('css=#password'));
    // New Page moved to after Fill Text css=#password
    expect(newPageIdx).toBeGreaterThan(fillPwdIdx);
    // Still 4 steps
    const markers = content.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });

  it('--move "3 to 1" reorders: Fill Text password appears after New Page', async () => {
    const file = freshFile();
    const code = await runPatch(file, { move: '3 to 1', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const fillPwdIdx = lines.findIndex((l) => l.includes('css=#password'));
    const newPageIdx = lines.findIndex((l) => l.includes('New Page'));
    // Fill Text css=#password moved to after New Page (which was step 1)
    expect(fillPwdIdx).toBeGreaterThan(newPageIdx);
    const markers = content.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });

  it('--move "2 to 2" (same step): file renumbered, content unchanged', async () => {
    const file = freshFile();
    const code = await runPatch(file, { move: '2 to 2', backup: false });
    expect(code).toBe(0);
    const content = readFileSync(file, 'utf8');
    // All original keyword lines still present
    expect(content).toContain('New Page');
    expect(content).toContain('Fill Text    css=#username');
    expect(content).toContain('Fill Text    css=#password');
    expect(content).toContain('Click    css=#login-btn');
    const markers = content.match(/xlib:step=\d+/g);
    expect(markers).toHaveLength(4);
  });

  it('--move: .bak written with original content', async () => {
    const file = freshFile();
    const origContent = readFileSync(file, 'utf8');
    await runPatch(file, { move: '1 to 4' });
    const bakPath = `${file}.bak`;
    expect(existsSync(bakPath)).toBe(true);
    expect(readFileSync(bakPath, 'utf8')).toBe(origContent);
  });

  it('--move "invalid spec" → exit 1', async () => {
    const file = freshFile();
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(file, { move: '1-4', backup: false }); // wrong format
      expect(code).toBe(1);
      expect(errLogs.join('\n')).toContain('valid move spec');
    } finally {
      console.error = origErr;
    }
  });

  it('--move "1 to 99" (target out of range) → exit 1', async () => {
    const file = freshFile();
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(file, { move: '1 to 99', backup: false });
      expect(code).toBe(1);
      expect(errLogs.join('\n')).toContain('step 99');
    } finally {
      console.error = origErr;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Atomicity: file is intact on success; .bak contains original
// ─────────────────────────────────────────────────────────────────────────────

describe('atomicity and .bak contract', () => {
  it('file content after replace is valid (parseable by parseSteps)', async () => {
    // parseSteps is imported at top of file
    const file = freshFile();
    await runPatch(file, { at: '2', backup: false });
    const content = readFileSync(file, 'utf8');
    const idx = parseSteps(content);
    // Should still have 4 steps
    expect(idx.steps).toHaveLength(4);
    // Step numbers should be 1-4 contiguous
    expect(idx.steps.map((s) => s.step)).toEqual([1, 2, 3, 4]);
  });

  it('.bak is overwritten by a second operation (not appended)', async () => {
    const file = freshFile();
    const originalContent = readFileSync(file, 'utf8');

    // First operation
    await runPatch(file, { at: '1' });
    const bakAfterFirst = readFileSync(`${file}.bak`, 'utf8');
    expect(bakAfterFirst).toBe(originalContent);

    // Second operation (file is now mutated from first op)
    const mutatedContent = readFileSync(file, 'utf8');
    await runPatch(file, { at: '2' });
    const bakAfterSecond = readFileSync(`${file}.bak`, 'utf8');
    // .bak now contains the result of the FIRST op (not the original)
    expect(bakAfterSecond).toBe(mutatedContent);
  });

  it('renumbering is correct after multiple sequential deletes', async () => {
    // parseSteps is imported at top of file
    const file = freshFile();

    // Delete step 2 first
    await runPatch(file, { delete: '2', backup: false });
    // Then delete (new) step 2 (was original step 3)
    await runPatch(file, { delete: '2', backup: false });

    const content = readFileSync(file, 'utf8');
    const idx = parseSteps(content);
    expect(idx.steps).toHaveLength(2);
    expect(idx.steps.map((s) => s.step)).toEqual([1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Language inference (inferLang)
// ─────────────────────────────────────────────────────────────────────────────

describe('language inference from file extension', () => {
  it('uses robot lang for .robot files — stub uses # comment', async () => {
    const file = freshFile('test.robot');
    await runPatch(file, { at: '1', backup: false });
    const content = readFileSync(file, 'utf8');
    // Stub for robot lang uses # prefix
    expect(content).toContain('# NEW STEP');
    expect(content).not.toContain('// NEW STEP');
  });

  it('uses ts lang for .ts files — stub uses // comment', async () => {
    const TS_CONTENT = `async function main() {
  await page.goto('https://example.com');
  // xlib:step=1
  await page.click('css=#btn');
  // xlib:step=2
}
`;
    const file = freshFile('test.spec.ts', TS_CONTENT);
    await runPatch(file, { at: '1', backup: false });
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('// NEW STEP');
    expect(content).not.toContain('# NEW STEP');
  });

  it('uses python lang for .py files — stub uses # comment', async () => {
    const PY_CONTENT = `def run():
    page.goto("https://example.com")
    # xlib:step=1
    page.click("css=#btn")
    # xlib:step=2
`;
    const file = freshFile('test.py', PY_CONTENT);
    await runPatch(file, { at: '1', backup: false });
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('# NEW STEP');
    expect(content).not.toContain('// NEW STEP');
  });
});
