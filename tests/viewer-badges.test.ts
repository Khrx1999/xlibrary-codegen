/**
 * viewer-badges.test.ts
 *
 * Unit tests for the viewer badge pipeline:
 *   - parseXlibComment  (src/codegen/xlib-comment.ts)
 *   - gradeCandidate    (src/codegen/locator-grader.ts)
 *   - buildViewerPayload (src/recorder/viewer-renderer.ts)
 *
 * Acceptance criteria (task #8):
 *   - Steps with # xlib: markers get badge entries with correct grade + alts
 *   - Steps without markers produce no badge entry (no crash)
 *   - Single-candidate steps (no alts key) still produce a grade chip entry
 *   - Grade colours map correctly (A+ deep-green, A green, B yellow, C orange, D red)
 */

import { describe, it, expect } from 'vitest';

import { buildViewerPayload } from '../src/recorder/viewer-renderer.js';

// ─────────────────────────────────────────────────────────────────────────────
// parseXlibComment
// ─────────────────────────────────────────────────────────────────────────────

// parseXlibComment + gradeCandidate are tested in tests/xlib-comment.test.ts + tests/locator-grader.test.ts.
// Only the buildViewerPayload integration is unique to this file.

describe('buildViewerPayload', () => {
  it('returns the raw text unchanged', () => {
    const raw = '*** Test Cases ***\nRecorded Flow\n    Click    css=.btn\n';
    const result = buildViewerPayload(raw);
    expect(result.text).toBe(raw);
  });

  it('returns an empty badges array when no xlib markers are present', () => {
    const raw =
      '*** Settings ***\nLibrary    Browser\n\n*** Test Cases ***\nRecorded Flow\n    Click    css=.btn\n';
    const result = buildViewerPayload(raw);
    expect(result.badges).toHaveLength(0);
  });

  it('does not crash on empty input', () => {
    const result = buildViewerPayload('');
    expect(result.badges).toHaveLength(0);
    expect(result.text).toBe('');
  });

  it('extracts one badge for a single xlib marker', () => {
    const raw =
      '*** Test Cases ***\n' +
      'Recorded Flow\n' +
      '    Click    role=button[name="Go"]\n' +
      '    # xlib:step=1;alts=["role=button[name=\\"Go\\"]","css=#go-btn"]\n';
    const result = buildViewerPayload(raw);
    expect(result.badges).toHaveLength(1);
    expect(result.badges[0].lineIdx).toBe(3); // 0-based line 3
    expect(result.badges[0].grade).toBe('A'); // role+name = A per main's #6 rubric
    expect(result.badges[0].alts).toHaveLength(2);
    expect(result.badges[0].alts[0]).toBe('role=button[name="Go"]');
  });

  it('extracts multiple badges in the correct line order', () => {
    const raw =
      '*** Test Cases ***\n' + // line 0
      'Recorded Flow\n' + // line 1
      '    New Page    https://example.com\n' + // line 2
      '    Click    role=button[name="Go"]\n' + // line 3
      '    # xlib:step=1;alts=["role=button[name=\\"Go\\"]"]\n' + // line 4
      '    Fill Text    label=Email    test@example.com\n' + // line 5
      '    # xlib:step=2;alts=["label=Email","css=#email"]\n'; // line 6

    const result = buildViewerPayload(raw);
    expect(result.badges).toHaveLength(2);

    expect(result.badges[0].lineIdx).toBe(4);
    expect(result.badges[0].grade).toBe('A'); // role+name = A per main's #6 rubric // role= is A+

    expect(result.badges[1].lineIdx).toBe(6);
    expect(result.badges[1].grade).toBe('A'); // label= is A per main's #6 rubric
    expect(result.badges[1].alts[1]).toBe('css=#email');
  });

  it('produces a grade chip for a step-only marker (no alts key)', () => {
    const raw = '    Click    css=.some-btn\n' + '    # xlib:step=1\n';
    const result = buildViewerPayload(raw);
    expect(result.badges).toHaveLength(1);
    expect(result.badges[0].alts).toHaveLength(0);
    // No primary selector → empty string → grade D
    expect(result.badges[0].grade).toBe('D');
  });

  it('skips badge entry when alts array is empty (no primary to grade)', () => {
    // Empty alts means there's nothing to display — the viewer-renderer
    // correctly produces no badge entry rather than a misleading "D grade
    // for nothing" chip. The step still appears in the text content.
    const raw = '    # xlib:step=1;alts=[]\n';
    const result = buildViewerPayload(raw);
    expect(result.badges).toHaveLength(0);
  });

  it('handles legacy / non-xlib lines without crashing', () => {
    const raw =
      '*** Settings ***\n' +
      'Library    Browser\n' +
      '\n' +
      '*** Test Cases ***\n' +
      'Recorded Flow\n' +
      '    New Browser    chromium    headless=${False}\n' +
      '    New Context    viewport=None\n' +
      '    Click    css=.btn\n' +
      '    Close Browser\n';
    const result = buildViewerPayload(raw);
    expect(result.badges).toHaveLength(0);
  });

  it('grades css-id selectors as C', () => {
    const raw = '    # xlib:step=1;alts=["css=#my-button"]\n';
    const result = buildViewerPayload(raw);
    expect(result.badges[0].grade).toBe('C');
  });

  it('grades xpath selectors as D', () => {
    const raw = '    # xlib:step=1;alts=["xpath=//button[@id=\'submit\']"]\n';
    const result = buildViewerPayload(raw);
    expect(result.badges[0].grade).toBe('D');
  });
});
