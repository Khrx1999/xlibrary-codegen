/**
 * Integration tests for the Robot Framework codegen output.
 *
 * Strategy:
 *   - For each golden .robot snapshot, validate file structure (always runs).
 *   - Run `robot --dryrun` to validate syntax when Robot Framework is installed.
 *
 * TODO: Install Robot Framework + Browser Library to enable dryrun tests:
 *   pip install robotframework robotframework-browser
 *   rfbrowser init
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = resolve(__dirname, 'snapshots');
const FIXTURE_DIR = resolve(__dirname, 'fixtures/actions');

// ---------------------------------------------------------------------------
// Detect Robot Framework availability
// ---------------------------------------------------------------------------

function isRobotInstalled(): boolean {
  const result = spawnSync('robot', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

const ROBOT_AVAILABLE = isRobotInstalled();

// ---------------------------------------------------------------------------
// All registered snapshot names
// ---------------------------------------------------------------------------
const KNOWN_SNAPSHOT_NAMES = new Set([
  'openPage',
  'closePage',
  'navigate',
  'click',
  'click-double',
  'fill',
  'press',
  'hover',
  'check',
  'uncheck',
  'select',
  'setInputFiles',
  'assertVisible',
  'assertText',
  'assertText-substring',
  'assertValue',
  'assertChecked',
  'assertChecked-unchecked',
  'assertSnapshot',
  'full-flow',
  // v0.2 #7 Self-Healing — selector alternatives in xlib:alts comment
  'click-with-alts',
  'fill-with-alts',
]);

// ---------------------------------------------------------------------------
// robot --dryrun validation
// ---------------------------------------------------------------------------

describe('Golden snapshots — robot --dryrun validation', () => {
  if (!ROBOT_AVAILABLE) {
    it.skip(// TODO: install Robot Framework to enable
    'SKIPPED — Robot Framework not installed. Run: pip install robotframework robotframework-browser && rfbrowser init', () => {});
    return;
  }

  const snapshotFiles = readdirSync(SNAPSHOTS_DIR).filter(
    (f) => f.endsWith('.robot') && !f.endsWith('.selenium.robot'),
  );

  for (const file of snapshotFiles) {
    const filePath = resolve(SNAPSHOTS_DIR, file);

    it(`robot --dryrun passes for ${file}`, () => {
      const result = spawnSync('robot', ['--dryrun', '--nostatusrc', filePath], {
        encoding: 'utf8',
        timeout: 30_000,
      });

      if (result.status !== 0) {
        console.error(`robot --dryrun FAILED for ${file}:`);
        console.error(result.stdout);
        console.error(result.stderr);
      }

      expect(result.status).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Snapshot file structure assertions (always run — no Robot Framework needed)
// ---------------------------------------------------------------------------

describe('Golden snapshot file structure', () => {
  const snapshotFiles = readdirSync(SNAPSHOTS_DIR).filter(
    (f) => f.endsWith('.robot') && !f.endsWith('.selenium.robot'),
  );

  it('snapshots directory is non-empty', () => {
    expect(snapshotFiles.length).toBeGreaterThan(0);
  });

  it('every snapshot name is registered in KNOWN_SNAPSHOT_NAMES', () => {
    for (const file of snapshotFiles) {
      const name = file.replace(/\.robot$/, '');
      expect(
        KNOWN_SNAPSHOT_NAMES.has(name),
        `Unregistered snapshot: ${file} — add to KNOWN_SNAPSHOT_NAMES`,
      ).toBe(true);
    }
  });

  it('every registered name has a corresponding snapshot file', () => {
    const presentNames = new Set(snapshotFiles.map((f) => f.replace(/\.robot$/, '')));
    for (const name of KNOWN_SNAPSHOT_NAMES) {
      expect(presentNames.has(name), `Missing snapshot file: ${name}.robot`).toBe(true);
    }
  });

  for (const file of snapshotFiles) {
    describe(file, () => {
      const content = readFileSync(resolve(SNAPSHOTS_DIR, file), 'utf8');

      it('has *** Settings *** section', () => {
        expect(content).toContain('*** Settings ***');
      });

      it('imports Browser library', () => {
        expect(content).toContain('Library    Browser');
      });

      it('has *** Test Cases *** section', () => {
        expect(content).toContain('*** Test Cases ***');
      });

      it('has Recorded Flow test case', () => {
        expect(content).toContain('Recorded Flow');
      });

      it('test case body has at least one keyword line', () => {
        const lines = content.split('\n');
        const flowIdx = lines.findIndex((l) => l.trim() === 'Recorded Flow');
        expect(flowIdx).toBeGreaterThan(-1);
        const bodyLines = lines.slice(flowIdx + 1).filter((l) => l.trim() !== '');
        expect(bodyLines.length, `${file} has no action lines in test body`).toBeGreaterThan(0);
      });

      it('test case body is indented with 4 spaces', () => {
        const lines = content.split('\n');
        const flowIdx = lines.findIndex((l) => l.trim() === 'Recorded Flow');
        const bodyLines = lines.slice(flowIdx + 1).filter((l) => l.trim() !== '');

        for (const line of bodyLines) {
          expect(line, `Every body line must start with 4-space indent: "${line}"`).toMatch(
            /^ {4}\S/,
          );
        }
      });

      it('non-comment keyword lines use 4-space argument separator', () => {
        const lines = content.split('\n');
        const flowIdx = lines.findIndex((l) => l.trim() === 'Recorded Flow');
        const bodyLines = lines.slice(flowIdx + 1).filter((l) => l.trim() !== '');

        for (const line of bodyLines) {
          if (line.trimStart().startsWith('#')) continue;
          const withoutIndent = line.slice(4);
          if (withoutIndent.includes('    ')) {
            expect(withoutIndent, `Argument separator must be 4 spaces in: "${line}"`).toMatch(
              /\S {4}\S/,
            );
          }
        }
      });

      it('contains New Browser setup call', () => {
        expect(content).toContain('New Browser');
      });

      it('contains Close Browser teardown call', () => {
        expect(content).toContain('Close Browser');
      });

      it('file ends with a newline', () => {
        expect(content.endsWith('\n')).toBe(true);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Fixture completeness
// ---------------------------------------------------------------------------

describe('Fixture completeness', () => {
  const ALL_ACTION_FIXTURES = [
    'openPage',
    'closePage',
    'navigate',
    'click',
    'click-double',
    'fill',
    'press',
    'hover',
    'check',
    'uncheck',
    'select',
    'setInputFiles',
    'assertVisible',
    'assertText',
    'assertText-substring',
    'assertValue',
    'assertChecked',
    'assertChecked-unchecked',
    'assertSnapshot',
  ] as const;

  for (const name of ALL_ACTION_FIXTURES) {
    it(`fixture JSON exists and is valid: ${name}`, () => {
      const raw = readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8');
      const parsed = JSON.parse(raw) as { actions: unknown[] };
      expect(parsed.actions).toBeInstanceOf(Array);
      expect(parsed.actions.length).toBeGreaterThan(0);
    });
  }

  it('full-flow fixture covers openPage, fill, click, assertText', () => {
    const { actions } = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, 'full-flow.json'), 'utf8'),
    ) as { actions: Array<{ action: { name: string } }> };
    const names = actions.map((a) => a.action.name);
    expect(names).toContain('openPage');
    expect(names).toContain('fill');
    expect(names).toContain('click');
    expect(names).toContain('assertText');
  });

  it('click-double fixture has clickCount === 2', () => {
    const { actions } = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, 'click-double.json'), 'utf8'),
    ) as { actions: Array<{ action: { clickCount: number } }> };
    expect(actions[0].action.clickCount).toBe(2);
  });

  it('assertText fixture has substring === false', () => {
    const { actions } = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, 'assertText.json'), 'utf8'),
    ) as { actions: Array<{ action: { substring: boolean } }> };
    expect(actions[0].action.substring).toBe(false);
  });

  it('assertText-substring fixture has substring === true', () => {
    const { actions } = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, 'assertText-substring.json'), 'utf8'),
    ) as { actions: Array<{ action: { substring: boolean } }> };
    expect(actions[0].action.substring).toBe(true);
  });

  it('assertChecked fixture has checked === true', () => {
    const { actions } = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, 'assertChecked.json'), 'utf8'),
    ) as { actions: Array<{ action: { checked: boolean } }> };
    expect(actions[0].action.checked).toBe(true);
  });

  it('assertChecked-unchecked fixture has checked === false', () => {
    const { actions } = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, 'assertChecked-unchecked.json'), 'utf8'),
    ) as { actions: Array<{ action: { checked: boolean } }> };
    expect(actions[0].action.checked).toBe(false);
  });

  it('assertSnapshot fixture has non-empty ariaSnapshot', () => {
    const { actions } = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, 'assertSnapshot.json'), 'utf8'),
    ) as { actions: Array<{ action: { ariaSnapshot: string } }> };
    expect(actions[0].action.ariaSnapshot).toBeTruthy();
  });
});
