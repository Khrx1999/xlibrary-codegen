/**
 * Tests for SeleniumLibraryLanguageGenerator.
 *
 * Strategy: reuse the existing action fixtures (tests/fixtures/actions/*.json)
 * which describe Playwright recorder actions in a language-agnostic shape, then
 * assert on the generator output. We keep expected outputs inline (rather than
 * golden files) for the initial cut — adding fully-curated snapshots later is
 * an easy follow-up but not blocking.
 *
 * IMPORTANT: If any of these tests start failing after a refactor, fix the
 * generator — never relax the test to match buggy output.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SeleniumLibraryLanguageGenerator } from '../src/codegen/selenium.js';
import { translateSelectorForSelenium, xpathLiteral } from '../src/codegen/selenium-locator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const defaultOptions = {
  browserName: 'chromium',
  launchOptions: {},
  contextOptions: {},
} as const;

type ActionInContext = {
  frame: { pageGuid: string; pageAlias: string; framePath: string[] };
  action: Record<string, unknown>;
  startTime: number;
};

function loadFixture(name: string): ActionInContext[] {
  const path = resolve(__dirname, `fixtures/actions/${name}.json`);
  const raw = readFileSync(path, 'utf8');
  return (JSON.parse(raw) as { actions: ActionInContext[] }).actions;
}

function render(fixtureName: string, testName = 'Recorded Flow'): string {
  const gen = new SeleniumLibraryLanguageGenerator(testName);
  const actions = loadFixture(fixtureName);
  const header = gen.generateHeader(defaultOptions);
  const body = actions
    .map((a) => gen.generateAction(a as unknown as Parameters<typeof gen.generateAction>[0]))
    .filter((s) => s !== '')
    .join('\n');
  const footer = gen.generateFooter();
  return [header, body, footer].filter((s) => s).join('\n');
}

// ===========================================================================
// Selector translation
// ===========================================================================

describe('translateSelectorForSelenium', () => {
  it('role+name → XPath with normalize-space equality', () => {
    expect(translateSelectorForSelenium('internal:role=button[name="Sign In" s]')).toBe(
      "xpath=//button[normalize-space(.)='Sign In']",
    );
  });

  it('role+name with "i" flag → contains() XPath', () => {
    expect(translateSelectorForSelenium('internal:role=link[name="Home" i]')).toBe(
      "xpath=//a[contains(normalize-space(.), 'Home')]",
    );
  });

  it('plain text → XPath with normalize-space', () => {
    expect(translateSelectorForSelenium('internal:text="Submit"')).toBe(
      "xpath=//*[normalize-space(.)='Submit']",
    );
  });

  it('label → following input/textarea/select XPath', () => {
    expect(translateSelectorForSelenium('internal:label="Email"')).toContain(
      "xpath=//label[contains(normalize-space(.), 'Email')]",
    );
  });

  it('testid → CSS', () => {
    expect(translateSelectorForSelenium('internal:testid=[data-testid="submit"]')).toBe(
      'css=[data-testid="submit"]',
    );
  });

  it('placeholder via internal:attr → CSS', () => {
    expect(translateSelectorForSelenium('internal:attr[name="placeholder"][value="Search"]')).toBe(
      'css=[placeholder="Search"]',
    );
  });

  it('already-prefixed css= passes through', () => {
    expect(translateSelectorForSelenium('css=#submit-btn')).toBe('css=#submit-btn');
  });

  it('already-prefixed xpath= passes through', () => {
    expect(translateSelectorForSelenium('xpath=//div')).toBe('xpath=//div');
  });

  it('plain CSS without prefix gets css= prefix', () => {
    expect(translateSelectorForSelenium('#submit')).toBe('css=#submit');
  });

  it('plain XPath without prefix gets xpath= prefix', () => {
    expect(translateSelectorForSelenium('//button[@id="x"]')).toBe('xpath=//button[@id="x"]');
  });
});

describe('xpathLiteral', () => {
  it('plain string → single-quoted', () => {
    expect(xpathLiteral('Hello')).toBe("'Hello'");
  });

  it('string with apostrophe → double-quoted', () => {
    expect(xpathLiteral("It's fine")).toBe(`"It's fine"`);
  });

  it('string with quotes → double-quoted', () => {
    expect(xpathLiteral('He said "hi"')).toBe(`'He said "hi"'`);
  });

  it('string with both quotes → concat()', () => {
    expect(xpathLiteral(`O'Brien "X"`)).toContain('concat(');
  });
});

// ===========================================================================
// Header / Footer
// ===========================================================================

describe('SeleniumLibraryLanguageGenerator: header & footer', () => {
  it('header has Settings + SeleniumLibrary + Test Cases', () => {
    const gen = new SeleniumLibraryLanguageGenerator('My Test');
    const header = gen.generateHeader(defaultOptions);
    expect(header).toContain('*** Settings ***');
    expect(header).toContain('Library    SeleniumLibrary');
    expect(header).toContain('*** Test Cases ***');
    expect(header).toContain('My Test');
    expect(header).not.toContain('New Browser'); // BL keyword should NOT appear
    expect(header).not.toContain('New Context');
  });

  it('footer is empty when browser was never opened', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    expect(gen.generateFooter()).toBe('');
  });

  it('footer emits Close Browser after Open Browser was emitted', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    // Trigger Open Browser by sending a real navigate
    gen.generateAction({
      action: { name: 'navigate', url: 'https://example.com', signals: [] },
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      startTime: 0,
    } as unknown as Parameters<typeof gen.generateAction>[0]);
    expect(gen.generateFooter()).toContain('Close Browser');
  });
});

// ===========================================================================
// Action generation (via existing fixtures)
// ===========================================================================

describe('SeleniumLibraryLanguageGenerator: action coverage', () => {
  it('openPage with real URL → Open Browser', () => {
    const out = render('openPage');
    expect(out).toContain('Open Browser    https://example.com    chrome');
  });

  it('openPage(about:blank)+navigate collapses into single Open Browser', () => {
    // The full-flow fixture starts with openPage('https://example.com/login') which
    // is treated as the initial Open Browser by our generator.
    const out = render('full-flow');
    const openBrowsers = (out.match(/Open Browser/g) || []).length;
    expect(openBrowsers).toBe(1);
    expect(out).toContain('Open Browser    https://example.com/login    chrome');
  });

  it('click → Click Element', () => {
    const out = render('click');
    expect(out).toContain('Click Element');
  });

  it('double-click → Double Click Element', () => {
    const out = render('click-double');
    expect(out).toContain('Double Click Element');
  });

  it('fill → Input Text', () => {
    const out = render('fill');
    expect(out).toContain('Input Text');
  });

  it('check → Select Checkbox', () => {
    const out = render('check');
    expect(out).toContain('Select Checkbox');
  });

  it('hover → Mouse Over', () => {
    const out = render('hover');
    expect(out).toContain('Mouse Over');
  });

  it('navigate (after open) → Go To', () => {
    const gen = new SeleniumLibraryLanguageGenerator();
    // First open the browser
    const open = gen.generateAction({
      action: { name: 'navigate', url: 'https://example.com', signals: [] },
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      startTime: 0,
    } as unknown as Parameters<typeof gen.generateAction>[0]);
    expect(open).toContain('Open Browser');

    // Then a second navigate
    const goTo = gen.generateAction({
      action: { name: 'navigate', url: 'https://example.com/page2', signals: [] },
      frame: { pageGuid: 'g', pageAlias: 'page', framePath: [] },
      startTime: 0,
    } as unknown as Parameters<typeof gen.generateAction>[0]);
    expect(goTo).toContain('Go To    https://example.com/page2');
    expect(goTo).not.toContain('Open Browser');
  });

  it('assertVisible → Element Should Be Visible', () => {
    const out = render('assertVisible');
    expect(out).toContain('Element Should Be Visible');
  });

  it('assertText (exact) → Element Text Should Be', () => {
    const out = render('assertText');
    expect(out).toContain('Element Text Should Be');
  });

  it('assertText (substring) → Element Should Contain', () => {
    const out = render('assertText-substring');
    expect(out).toContain('Element Should Contain');
  });

  it('assertChecked (true) → Checkbox Should Be Selected', () => {
    const out = render('assertChecked');
    expect(out).toContain('Checkbox Should Be Selected');
  });

  it('assertChecked (false) → Checkbox Should Not Be Selected', () => {
    const out = render('assertChecked-unchecked');
    expect(out).toContain('Checkbox Should Not Be Selected');
  });

  it('assertSnapshot has no SL equivalent → TODO comment', () => {
    const out = render('assertSnapshot');
    expect(out).toContain('# TODO: assertSnapshot');
  });
});

// ===========================================================================
// Integration with bundle-patcher (Selenium target visible in languageSet)
// ===========================================================================

describe('SeleniumLibraryLanguageGenerator integration', () => {
  it('is exposable to the recorder via registerLanguageGenerator', async () => {
    const { registerLanguageGenerator, isBundlePatchApplied } =
      await import('../src/recorder/bundle-patcher.js');
    const gen = new SeleniumLibraryLanguageGenerator('Integration Test');
    registerLanguageGenerator(gen);

    const pw = await import('playwright-core');
    const browser = await pw.chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext();
      await (
        ctx as unknown as {
          _enableRecorder: (p: Record<string, unknown>) => Promise<void>;
        }
      )._enableRecorder({
        language: 'selenium',
        mode: 'recording',
        launchOptions: {},
        contextOptions: {},
      });
      await new Promise((r) => setTimeout(r, 500));
      // languageSet() ran inside the recorder constructor → flag set
      expect(isBundlePatchApplied()).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
