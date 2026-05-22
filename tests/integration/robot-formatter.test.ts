/**
 * Integration tests for RobotFormatter.
 *
 * The formatter is used by every language generator to build .robot output.
 * No dedicated test file existed before — this covers the formatter's API
 * in isolation and verifies the invariants that snapshots rely on.
 *
 * Coverage target: src/codegen/robot-formatter.ts
 */

import { describe, it, expect } from 'vitest';
import { RobotFormatter, INDENT, ARG_SEP } from '../../src/codegen/robot-formatter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('INDENT is 4 spaces', () => {
    expect(INDENT).toBe('    ');
    expect(INDENT.length).toBe(4);
  });

  it('ARG_SEP is 4 spaces', () => {
    expect(ARG_SEP).toBe('    ');
    expect(ARG_SEP.length).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// section()
// ─────────────────────────────────────────────────────────────────────────────

describe('RobotFormatter.section()', () => {
  it('emits *** Name *** at column 0', () => {
    const fmt = new RobotFormatter();
    fmt.section('Settings');
    expect(fmt.format()).toBe('*** Settings ***');
  });

  it('section name appears between *** delimiters', () => {
    const fmt = new RobotFormatter();
    fmt.section('Test Cases');
    expect(fmt.format()).toBe('*** Test Cases ***');
  });

  it('is chainable', () => {
    const fmt = new RobotFormatter();
    const result = fmt.section('Settings').section('Test Cases').format();
    expect(result).toBe('*** Settings ***\n*** Test Cases ***');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// blank()
// ─────────────────────────────────────────────────────────────────────────────

describe('RobotFormatter.blank()', () => {
  it('emits an empty line', () => {
    const fmt = new RobotFormatter();
    fmt.section('Settings').blank().section('Test Cases');
    const lines = fmt.format().split('\n');
    expect(lines[1]).toBe('');
  });

  it('is chainable', () => {
    const fmt = new RobotFormatter();
    fmt.blank().blank();
    expect(fmt.format()).toBe('\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// raw()
// ─────────────────────────────────────────────────────────────────────────────

describe('RobotFormatter.raw()', () => {
  it('emits line verbatim at column 0', () => {
    const fmt = new RobotFormatter();
    fmt.raw('Library    Browser');
    expect(fmt.format()).toBe('Library    Browser');
  });

  it('does not add indentation', () => {
    const fmt = new RobotFormatter();
    fmt.raw('Recorded Flow');
    expect(fmt.format()).toBe('Recorded Flow');
  });

  it('is chainable', () => {
    const fmt = new RobotFormatter();
    fmt.raw('Library    Browser').raw('Suite Setup    Open Browser');
    expect(fmt.format()).toBe('Library    Browser\nSuite Setup    Open Browser');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// keyword()
// ─────────────────────────────────────────────────────────────────────────────

describe('RobotFormatter.keyword()', () => {
  it('emits 4-space indented keyword with no args', () => {
    const fmt = new RobotFormatter();
    fmt.keyword('Close Browser');
    expect(fmt.format()).toBe('    Close Browser');
  });

  it('joins keyword + args with 4-space ARG_SEP', () => {
    const fmt = new RobotFormatter();
    fmt.keyword('Click', 'css=#btn');
    expect(fmt.format()).toBe('    Click    css=#btn');
  });

  it('multiple args are each separated by 4 spaces', () => {
    const fmt = new RobotFormatter();
    fmt.keyword('Fill Text', 'css=#user', 'admin');
    expect(fmt.format()).toBe('    Fill Text    css=#user    admin');
  });

  it('filters out undefined args', () => {
    const fmt = new RobotFormatter();
    fmt.keyword('New Browser', 'chromium', undefined, 'headless=${False}');
    expect(fmt.format()).toBe('    New Browser    chromium    headless=${False}');
  });

  it('filters out empty string args', () => {
    const fmt = new RobotFormatter();
    fmt.keyword('Click', '', 'css=#btn', '');
    expect(fmt.format()).toBe('    Click    css=#btn');
  });

  it('is chainable', () => {
    const fmt = new RobotFormatter();
    fmt.keyword('New Browser', 'chromium').keyword('New Context');
    expect(fmt.format()).toBe('    New Browser    chromium\n    New Context');
  });

  it('handles many args correctly', () => {
    const fmt = new RobotFormatter();
    fmt.keyword('Select Options By', 'css=#sel', 'value', 'opt1', 'opt2');
    expect(fmt.format()).toBe('    Select Options By    css=#sel    value    opt1    opt2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// comment()
// ─────────────────────────────────────────────────────────────────────────────

describe('RobotFormatter.comment()', () => {
  it('emits indented # comment', () => {
    const fmt = new RobotFormatter();
    fmt.comment('This is a comment');
    expect(fmt.format()).toBe('    # This is a comment');
  });

  it('comment is 4-space indented (matches body indent)', () => {
    const fmt = new RobotFormatter();
    fmt.comment('hello');
    expect(fmt.format()).toMatch(/^ {4}# /);
  });

  it('is chainable', () => {
    const fmt = new RobotFormatter();
    fmt.comment('First').comment('Second');
    expect(fmt.format()).toBe('    # First\n    # Second');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rawLine()
// ─────────────────────────────────────────────────────────────────────────────

describe('RobotFormatter.rawLine()', () => {
  it('pushes a pre-built line verbatim', () => {
    const fmt = new RobotFormatter();
    fmt.rawLine('    # Navigation to: https://example.com');
    expect(fmt.format()).toBe('    # Navigation to: https://example.com');
  });

  it('is chainable', () => {
    const fmt = new RobotFormatter();
    fmt.rawLine('    # line1').rawLine('    # line2');
    expect(fmt.format()).toBe('    # line1\n    # line2');
  });

  it('preserves any indentation in the supplied string', () => {
    const fmt = new RobotFormatter();
    fmt.rawLine('no-indent');
    expect(fmt.format()).toBe('no-indent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// format()
// ─────────────────────────────────────────────────────────────────────────────

describe('RobotFormatter.format()', () => {
  it('returns empty string when no lines added', () => {
    expect(new RobotFormatter().format()).toBe('');
  });

  it('joins lines with \\n (no trailing newline)', () => {
    const fmt = new RobotFormatter();
    fmt.raw('A').raw('B').raw('C');
    expect(fmt.format()).toBe('A\nB\nC');
    expect(fmt.format().endsWith('\n')).toBe(false);
  });

  it('single line has no newline', () => {
    const fmt = new RobotFormatter();
    fmt.raw('Only');
    expect(fmt.format()).toBe('Only');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Composite — typical .robot header shape
// ─────────────────────────────────────────────────────────────────────────────

describe('RobotFormatter — composite header shape', () => {
  it('produces canonical .robot Settings+Test Cases header', () => {
    const fmt = new RobotFormatter();
    fmt
      .section('Settings')
      .raw('Library    Browser')
      .blank()
      .section('Test Cases')
      .raw('Recorded Flow')
      .keyword('New Browser', 'chromium', 'headless=${False}')
      .keyword('New Context', 'viewport=None');

    const output = fmt.format();
    expect(output).toBe(
      [
        '*** Settings ***',
        'Library    Browser',
        '',
        '*** Test Cases ***',
        'Recorded Flow',
        '    New Browser    chromium    headless=${False}',
        '    New Context    viewport=None',
      ].join('\n'),
    );
  });

  it('body lines all start with 4-space indent', () => {
    const fmt = new RobotFormatter();
    fmt
      .section('Settings')
      .raw('Library    Browser')
      .blank()
      .section('Test Cases')
      .raw('Test Name')
      .keyword('Click', 'css=#btn')
      .keyword('Fill Text', 'css=#inp', 'hello')
      .comment('This is a comment');

    const bodyLines = fmt
      .format()
      .split('\n')
      .filter((l) => l.startsWith('    '));
    expect(bodyLines.every((l) => /^ {4}\S/.test(l))).toBe(true);
  });

  it('keyword argument separator is exactly 4 spaces', () => {
    const fmt = new RobotFormatter();
    fmt.keyword('Get Text', 'css=#el', '==', 'Expected Value');
    const line = fmt.format();
    // Each arg separated by 4 spaces
    expect(line).toContain('Get Text    css=#el    ==    Expected Value');
    expect(line).not.toMatch(/Get Text {1,3}\S/);
    expect(line).not.toMatch(/Get Text {5,}\S/);
  });
});
