/**
 * Tests for src/cli-patch.ts (runPatch handler).
 *
 * Task #9 acceptance criteria tests remain in place and are updated where
 * Task #10 changed the observable behaviour (operations now execute and
 * mutate files rather than printing a plan).
 *
 * Tests that write to disk use per-test temporary files so each test is
 * isolated — a mutation in one test cannot affect another.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdtempSync,
  rmdirSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPatch } from '../src/cli-patch.js';
import type { PatchOptions } from '../src/cli-patch.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ROBOT_CONTENT = `*** Settings ***
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

const NO_MARKERS_CONTENT = `*** Test Cases ***
Example
    Log    no markers here
`;

let tmpDir: string;
let robotFile: string;
let noMarkersFile: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'xlibrary-patch-test-'));
  robotFile = join(tmpDir, 'login.robot');
  noMarkersFile = join(tmpDir, 'no-markers.robot');
  writeFileSync(robotFile, ROBOT_CONTENT, 'utf8');
  writeFileSync(noMarkersFile, NO_MARKERS_CONTENT, 'utf8');
});

// Restore the shared robotFile before each test that mutates it.
// Tests that only READ (no operation flag) are safe without this guard,
// but we reset unconditionally to keep tests independent.
beforeEach(() => {
  writeFileSync(robotFile, ROBOT_CONTENT, 'utf8');
});

afterAll(() => {
  try {
    unlinkSync(robotFile);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(noMarkersFile);
  } catch {
    /* ignore */
  }
  try {
    rmdirSync(tmpDir);
  } catch {
    /* ignore */
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance criteria: step lookup (Task #9 — still valid in Task #10)
// ─────────────────────────────────────────────────────────────────────────────

describe('runPatch — step lookup', () => {
  it('--at 5 → error "No step 5 in file (file has 4 steps)", exit 1', async () => {
    const logs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: '5' });
      expect(code).toBe(1);
      const allOutput = logs.join('\n');
      expect(allOutput).toContain('No step 5');
      expect(allOutput).toContain('4 steps');
    } finally {
      console.error = origErr;
    }
  });

  it('--at 1 → exit 0 (operation executed, success message printed)', async () => {
    const logs: string[] = [];
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: '1' });
      expect(code).toBe(0);
      // Task #10: operation executes; success message includes file name
      const allOutput = logs.join('\n');
      expect(allOutput).toContain('login.robot');
    } finally {
      console.log = origLog;
    }
  });

  it('--at 4 → exit 0 (replace step 4)', async () => {
    const logs: string[] = [];
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: '4' });
      expect(code).toBe(0);
      const allOutput = logs.join('\n');
      expect(allOutput).toContain('replace step 4');
    } finally {
      console.log = origLog;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance criteria: fuzzy matching (Task #9 — still valid in Task #10)
// ─────────────────────────────────────────────────────────────────────────────

describe('runPatch — fuzzy matching', () => {
  it('"Click" matches step 4 uniquely — operation executed, exit 0', async () => {
    const logs: string[] = [];
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: 'Click' });
      expect(code).toBe(0);
      // Task #10: operation executed successfully (no error)
      const allOutput = logs.join('\n');
      expect(allOutput).toContain('login.robot');
    } finally {
      console.log = origLog;
    }
  });

  it('"Fill Text" → disambiguation table (matches steps 2 and 3)', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: 'Fill Text' });
      // Multiple matches → disambiguation → exit 1
      expect(code).toBe(1);
      const allOutput = errLogs.join('\n');
      expect(allOutput).toContain('Fill Text');
      expect(allOutput).toContain('matches');
      // Both step 2 and step 3 should appear
      expect(allOutput).toContain('2');
      expect(allOutput).toContain('3');
    } finally {
      console.error = origErr;
    }
  });

  it('"NonExistent" → error exit 1', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: 'NonExistent' });
      expect(code).toBe(1);
      expect(errLogs.join('\n')).toContain('NonExistent');
    } finally {
      console.error = origErr;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance criteria: conflict detection (Task #9 — still valid)
// ─────────────────────────────────────────────────────────────────────────────

describe('runPatch — flag conflict detection', () => {
  it('--at 5 --insert-after 3 → conflict error, exit 1', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: '5', insertAfter: '3' });
      expect(code).toBe(1);
      expect(errLogs.join('\n').toLowerCase()).toContain('conflict');
    } finally {
      console.error = origErr;
    }
  });

  it('--at 5 --delete 3 → conflict error, exit 1', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: '5', delete: '3' });
      expect(code).toBe(1);
      expect(errLogs.join('\n').toLowerCase()).toContain('conflict');
    } finally {
      console.error = origErr;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance criteria: no markers (Task #9 — still valid)
// ─────────────────────────────────────────────────────────────────────────────

describe('runPatch — no markers', () => {
  it('exits 1 with a clear message when file has no xlib:step markers', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(noMarkersFile, { at: '1' });
      expect(code).toBe(1);
      const allErr = errLogs.join('\n');
      expect(allErr).toContain('xlib:step');
    } finally {
      console.error = origErr;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance criteria: missing file (Task #9 — still valid)
// ─────────────────────────────────────────────────────────────────────────────

describe('runPatch — missing file', () => {
  it('exits 1 with file-path in error when file does not exist', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch('/tmp/does-not-exist-xlibrary-test.robot', {});
      expect(code).toBe(1);
      const allErr = errLogs.join('\n');
      expect(allErr).toContain('does-not-exist-xlibrary-test.robot');
    } finally {
      console.error = origErr;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #10: output format — success messages and backup behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('runPatch — Task #10 output format', () => {
  it('operation success prints file name in message', async () => {
    const logs: string[] = [];
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: '1' });
      expect(code).toBe(0);
      expect(logs.join('\n')).toContain('login.robot');
    } finally {
      console.log = origLog;
    }
  });

  it('operation success with backup prints .bak note', async () => {
    const logs: string[] = [];
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { at: '1' }); // backup: true by default
      expect(code).toBe(0);
      const out = logs.join('\n');
      expect(out).toContain('.bak');
    } finally {
      console.log = origLog;
    }
  });

  it('--no-backup: success message does not mention .bak', async () => {
    const logs: string[] = [];
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    try {
      await runPatch(robotFile, { at: '1', backup: false });
      const out = logs.join('\n');
      expect(out).not.toContain('.bak');
    } finally {
      console.log = origLog;
    }
  });

  it('no operation → lists all steps and exits 0', async () => {
    const logs: string[] = [];
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, {});
      expect(code).toBe(0);
      const allOutput = logs.join('\n');
      expect(allOutput).toContain('4 steps');
    } finally {
      console.log = origLog;
    }
  });

  it('--at 2: success message contains "replace step 2"', async () => {
    const logs: string[] = [];
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    try {
      await runPatch(robotFile, { at: '2' });
      expect(logs.join('\n')).toContain('replace step 2');
    } finally {
      console.log = origLog;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #10: backup file written by default
// ─────────────────────────────────────────────────────────────────────────────

describe('runPatch — backup behaviour', () => {
  it('writes .bak file containing original content', async () => {
    const origContent = readFileSync(robotFile, 'utf8');
    await runPatch(robotFile, { at: '1' });
    const bakPath = `${robotFile}.bak`;
    expect(existsSync(bakPath)).toBe(true);
    const bakContent = readFileSync(bakPath, 'utf8');
    expect(bakContent).toBe(origContent);
    // Clean up
    try {
      unlinkSync(bakPath);
    } catch {
      /* ignore */
    }
  });

  it('--no-backup: .bak file is NOT written', async () => {
    const bakPath = `${robotFile}.bak`;
    // Remove any previous .bak
    try {
      unlinkSync(bakPath);
    } catch {
      /* ignore */
    }
    await runPatch(robotFile, { at: '1', backup: false });
    expect(existsSync(bakPath)).toBe(false);
  });

  it('existing .bak is overwritten on next run', async () => {
    // First operation — creates a .bak
    await runPatch(robotFile, { at: '1' });
    const bakPath = `${robotFile}.bak`;
    const firstBakContent = readFileSync(bakPath, 'utf8');

    // Restore file for second operation
    writeFileSync(robotFile, ROBOT_CONTENT, 'utf8');

    // Second operation — overwrites .bak with current content
    await runPatch(robotFile, { at: '2' });
    const secondBakContent = readFileSync(bakPath, 'utf8');

    // Both baks should equal the original (since we restored each time)
    expect(firstBakContent).toBe(secondBakContent);
    // Clean up
    try {
      unlinkSync(bakPath);
    } catch {
      /* ignore */
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #10: file is actually mutated
// ─────────────────────────────────────────────────────────────────────────────

describe('runPatch — file mutation', () => {
  it('--at 1: file content changes after replace', async () => {
    const before = readFileSync(robotFile, 'utf8');
    await runPatch(robotFile, { at: '1', backup: false });
    const after = readFileSync(robotFile, 'utf8');
    expect(after).not.toBe(before);
  });

  it('--delete 1: file no longer contains step 1 marker', async () => {
    await runPatch(robotFile, { delete: '1', backup: false });
    const content = readFileSync(robotFile, 'utf8');
    // After delete and renumber, we still have markers but renumbered
    const lines = content.split('\n');
    const markerLines = lines.filter((l) => /xlib:step=/.test(l));
    // Was 4 steps, now 3
    expect(markerLines).toHaveLength(3);
    // All markers should be 1, 2, 3 (renumbered)
    expect(content).toContain('xlib:step=1');
    expect(content).toContain('xlib:step=2');
    expect(content).toContain('xlib:step=3');
    expect(content).not.toContain('xlib:step=4');
  });

  it('--insert-after 2: file has 5 steps after insert', async () => {
    await runPatch(robotFile, { insertAfter: '2', backup: false });
    const content = readFileSync(robotFile, 'utf8');
    const markerLines = content.split('\n').filter((l) => /xlib:step=/.test(l));
    expect(markerLines).toHaveLength(5);
  });

  it('--insert-before 1: file has 5 steps after insert', async () => {
    await runPatch(robotFile, { insertBefore: '1', backup: false });
    const content = readFileSync(robotFile, 'utf8');
    const markerLines = content.split('\n').filter((l) => /xlib:step=/.test(l));
    expect(markerLines).toHaveLength(5);
  });

  it('--delete 2-3: removes 2 steps, leaving 2', async () => {
    await runPatch(robotFile, { delete: '2-3', backup: false });
    const content = readFileSync(robotFile, 'utf8');
    const markerLines = content.split('\n').filter((l) => /xlib:step=/.test(l));
    expect(markerLines).toHaveLength(2);
    expect(content).toContain('xlib:step=1');
    expect(content).toContain('xlib:step=2');
  });

  it('--move 1 to 3: step order changes (step 1 content moves to position 3)', async () => {
    await runPatch(robotFile, { move: '1 to 3', backup: false });
    const content = readFileSync(robotFile, 'utf8');
    const lines = content.split('\n');
    // After move, the file still has 4 step markers renumbered 1-4
    const markerLines = lines.filter((l) => /xlib:step=/.test(l));
    expect(markerLines).toHaveLength(4);
    // The original step 1 keyword was "New Page    https://example.com/login"
    // After moving to position 3, it should appear after what was step 2 and 3
    // Step 2 = Fill Text username, Step 3 = Fill Text password → New Page should be after them
    const newPageIdx = lines.findIndex((l) => l.includes('New Page'));
    const fillUsernameIdx = lines.findIndex((l) => l.includes('#username'));
    const fillPasswordIdx = lines.findIndex((l) => l.includes('#password'));
    expect(newPageIdx).toBeGreaterThan(fillUsernameIdx);
    expect(newPageIdx).toBeGreaterThan(fillPasswordIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #10: --delete and --move error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('runPatch — delete/move error handling', () => {
  it('--delete 10 → error (step out of range)', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { delete: '10' });
      expect(code).toBe(1);
      expect(errLogs.join('\n')).toContain('step 10');
    } finally {
      console.error = origErr;
    }
  });

  it('--delete invalid → error', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { delete: 'abc' });
      expect(code).toBe(1);
    } finally {
      console.error = origErr;
    }
  });

  it('--move "invalid spec" → error', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { move: '1-3' }); // wrong format
      expect(code).toBe(1);
      expect(errLogs.join('\n')).toContain('valid move spec');
    } finally {
      console.error = origErr;
    }
  });

  it('--move 1 to 10 → error (target step out of range)', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { move: '1 to 10' });
      expect(code).toBe(1);
      expect(errLogs.join('\n')).toContain('step 10');
    } finally {
      console.error = origErr;
    }
  });

  it('--delete 3-1 → error (from > to)', async () => {
    const errLogs: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errLogs.push(args.join(' '));
    };
    try {
      const code = await runPatch(robotFile, { delete: '3-1' });
      expect(code).toBe(1);
      expect(errLogs.join('\n').toLowerCase()).toContain('invalid');
    } finally {
      console.error = origErr;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PatchOptions type completeness (compile-time contract for Tasks #10/#11)
// ─────────────────────────────────────────────────────────────────────────────

describe('PatchOptions interface', () => {
  it('accepts all documented flags without type error', () => {
    const opts: PatchOptions = {
      at: '5',
      insertAfter: '3',
      insertBefore: '2',
      delete: '4',
      move: '1 to 6',
      range: '2-4',
      nonInteractive: true,
      backup: false,
    };
    expect(opts.at).toBe('5');
  });
});
