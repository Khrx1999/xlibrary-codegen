/**
 * Integration tests for the TS/Python xlib marker post-processor.
 *
 * These tests cover src/codegen/xlib-post-processor.ts — the utility that
 * injects `xlib:step=N` markers into TypeScript (playwright-test) and Python
 * (pytest) output files produced by Playwright's built-in language generators.
 *
 * Note: Playwright's TS/Python generators run in direct mode (RecordActionTool,
 * `multiple: false`). As of v0.2, alternatives[] is empty in that mode — so
 * only `xlib:step=N` markers are emitted, no alts clause. This is the
 * "graceful degrade" path. The actionAlts map tests verify that the full
 * `alts=[...]` path works correctly when alternatives are available.
 */

import { describe, it, expect } from 'vitest';
import { injectXlibMarkers } from '../../src/codegen/xlib-post-processor.js';

// ---------------------------------------------------------------------------
// TypeScript / Playwright-test samples
// ---------------------------------------------------------------------------

const TS_SAMPLE = `import { test, expect } from '@playwright/test';

test('Recorded Flow', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.locator('css=#username').fill('admin');
  await page.locator('css=#password').fill('secret');
  await page.locator('css=#login-btn').click();
  await expect(page.locator('css=#welcome-banner')).toHaveText('Welcome admin');
});
`;

const TS_SAMPLE_WITH_CONTEXT = `import { test, expect } from '@playwright/test';

test('Multi-page flow', async ({ page, context }) => {
  await page.goto('https://example.com');
  await context.clearCookies();
  await page.locator('#btn').click();
});
`;

// ---------------------------------------------------------------------------
// Python / pytest-playwright samples
// ---------------------------------------------------------------------------

const PY_SAMPLE = `import re
from playwright.sync_api import Page, expect

def test_recorded_flow(page: Page) -> None:
    page.goto("https://example.com/login")
    page.locator("css=#username").fill("admin")
    page.locator("css=#password").fill("secret")
    page.locator("css=#login-btn").click()
    expect(page.locator("css=#welcome-banner")).to_have_text("Welcome admin")
`;

// ---------------------------------------------------------------------------
// TypeScript tests
// ---------------------------------------------------------------------------

describe('injectXlibMarkers — TypeScript', () => {
  it('tags all await page. lines with sequential step numbers', () => {
    const { content, linesTagged } = injectXlibMarkers({
      content: TS_SAMPLE,
      language: 'typescript',
    });

    // The TS_STEP_LINE_RE matches `await page.` and `await context.` directly.
    // `await expect(page.locator(...))` does NOT match (it starts with 'await expect').
    // So we get 4 tagged lines: goto, fill, fill, click.
    expect(linesTagged).toBe(4);

    // Each await page. line should have a // xlib:step=N suffix.
    // Note: TS_SAMPLE has semicolons at end of each statement.
    expect(content).toContain("await page.goto('https://example.com/login');  // xlib:step=1");
    expect(content).toContain("await page.locator('css=#username').fill('admin');  // xlib:step=2");
    expect(content).toContain(
      "await page.locator('css=#password').fill('secret');  // xlib:step=3",
    );
    expect(content).toContain("await page.locator('css=#login-btn').click();  // xlib:step=4");
    // The expect() assertion line is NOT tagged — it starts with 'await expect(' not 'await page.'
    expect(content).toContain(
      "await expect(page.locator('css=#welcome-banner')).toHaveText('Welcome admin')",
    );
  });

  it('handles context. method calls too', () => {
    const { content, linesTagged } = injectXlibMarkers({
      content: TS_SAMPLE_WITH_CONTEXT,
      language: 'typescript',
    });
    // page.goto + context.clearCookies + page.locator click = 3 lines
    expect(linesTagged).toBe(3);
    expect(content).toContain('// xlib:step=1');
    expect(content).toContain('// xlib:step=2');
    expect(content).toContain('// xlib:step=3');
  });

  it('does not double-tag already-tagged lines', () => {
    const already = `test('test', async ({ page }) => {
  await page.goto('https://example.com')  // xlib:step=1
  await page.click('css=#btn')
});
`;
    const { content, linesTagged } = injectXlibMarkers({
      content: already,
      language: 'typescript',
    });
    // Only the un-tagged click line should be tagged
    expect(linesTagged).toBe(1);
    expect(content).toContain('// xlib:step=1');
    expect(content).toContain('// xlib:step=2');
    // The original step=1 line should NOT become step=1 again (it's skipped)
    const step1Count = (content.match(/xlib:step=1/g) ?? []).length;
    expect(step1Count).toBe(1);
  });

  it('preserves non-step lines unchanged', () => {
    const { content } = injectXlibMarkers({ content: TS_SAMPLE, language: 'typescript' });
    expect(content).toContain("import { test, expect } from '@playwright/test'");
    expect(content).toContain("test('Recorded Flow', async ({ page }) => {");
    expect(content).toContain('});');
  });

  it('injects alts clause when actionAlts map is provided', () => {
    const altsMap = new Map<number, string[]>([
      [0, ['css=#username', '[data-testid="username"]', '[name="username"]']],
    ]);
    const content =
      "test('t', async ({ page }) => {\n  await page.locator('css=#username').fill('x');\n});\n";
    const { content: result } = injectXlibMarkers({
      content,
      language: 'typescript',
      actionAlts: altsMap,
    });
    // Primary is index 0, alts are 1..3 after ranking
    expect(result).toContain('xlib:step=1;alts=');
  });

  it('returns content unchanged when no step lines found', () => {
    const noSteps =
      "import { test } from '@playwright/test';\n\ntest.describe('suite', () => {\n  // empty\n});\n";
    const { content, linesTagged } = injectXlibMarkers({
      content: noSteps,
      language: 'typescript',
    });
    expect(linesTagged).toBe(0);
    expect(content).toBe(noSteps);
  });
});

// ---------------------------------------------------------------------------
// Python tests
// ---------------------------------------------------------------------------

describe('injectXlibMarkers — Python', () => {
  it('tags all page. method lines with sequential step numbers', () => {
    const { content, linesTagged } = injectXlibMarkers({
      content: PY_SAMPLE,
      language: 'python',
    });

    // page.goto, page.locator x3 (fill, fill, click) = 4 lines
    // Note: `expect(page.locator...).to_have_text(...)` — this starts with `expect(page`
    // not with `page.` directly, so PY_STEP_LINE_RE won't match it.
    expect(linesTagged).toBe(4);
    expect(content).toContain('page.goto("https://example.com/login")  # xlib:step=1');
    expect(content).toContain('page.locator("css=#username").fill("admin")  # xlib:step=2');
    expect(content).toContain('page.locator("css=#password").fill("secret")  # xlib:step=3');
    expect(content).toContain('page.locator("css=#login-btn").click()  # xlib:step=4');
  });

  it('uses # prefix (not //) for Python', () => {
    const { content } = injectXlibMarkers({ content: PY_SAMPLE, language: 'python' });
    expect(content).toContain('# xlib:step=');
    expect(content).not.toContain('// xlib:step=');
  });

  it('does not double-tag already-tagged Python lines', () => {
    const already = `def test_flow(page):\n    page.goto("https://example.com")  # xlib:step=1\n    page.click("css=#btn")\n`;
    const { linesTagged } = injectXlibMarkers({ content: already, language: 'python' });
    expect(linesTagged).toBe(1); // only the un-tagged click
  });

  it('preserves import and comment lines', () => {
    const { content } = injectXlibMarkers({ content: PY_SAMPLE, language: 'python' });
    expect(content).toContain('import re');
    expect(content).toContain('from playwright.sync_api import Page, expect');
    expect(content).toContain('def test_recorded_flow(page: Page) -> None:');
  });
});

// ---------------------------------------------------------------------------
// Multi-line statement guard
// ---------------------------------------------------------------------------

describe('injectXlibMarkers — multi-line statement handling', () => {
  it('does not tag continuation lines (no await page. prefix)', () => {
    // Multi-line TS assertion — only the first line starts with await page.
    const multi = `test('t', async ({ page }) => {
  await page.locator('css=#btn')
    .waitFor({ state: 'visible' });
  await page.click('css=#other');
});
`;
    const { linesTagged } = injectXlibMarkers({ content: multi, language: 'typescript' });
    // Line 1: `  await page.locator(...)` → tagged (step 1)
    // Line 2: `    .waitFor(...)` → NOT tagged (no 'await page.' prefix)
    // Line 3: `  await page.click(...)` → tagged (step 2)
    expect(linesTagged).toBe(2);
  });

  it('handles empty file without error', () => {
    const { content, linesTagged } = injectXlibMarkers({ content: '', language: 'typescript' });
    expect(content).toBe('');
    expect(linesTagged).toBe(0);
  });
});
