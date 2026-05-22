/**
 * Comprehensive unit tests for the Test Data Wizard detection engine.
 *
 * Test organisation:
 *  1. Field-context detection (selector semantics drive variable name)
 *  2. Value-regex fallback (no selector context → pattern match on value)
 *  3. Dedup — same value (occurrences accumulate, one var)
 *  4. Dedup — different values same semantic (numbered suffixes)
 *  5. Action-type coverage (navigate, openPage, assertText, assertValue)
 *  6. Skip rules (empty, single char, key names, booleans)
 *  7. Substitution plan correctness
 *  8. Snapshot-style integration (full fixture flows)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectVariables } from '../../src/wizard/detector.js';
import type {
  ActionInContext,
  FillAction,
  NavigateAction,
  OpenPageAction,
  AssertTextAction,
  AssertValueAction,
  PressAction,
  ClickAction,
} from '../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Fixture helpers ────────────────────────────────────────────────────────────

function loadFixture(name: string): ActionInContext[] {
  const p = resolve(__dirname, 'fixtures', `${name}.json`);
  const raw = readFileSync(p, 'utf8');
  return (JSON.parse(raw) as { actions: ActionInContext[] }).actions;
}

// ─── Inline action builders ─────────────────────────────────────────────────────

const FRAME = { pageGuid: 'p1', pageAlias: 'page', framePath: [] as string[] };

function makeFill(selector: string, text: string): ActionInContext {
  const action: FillAction = { name: 'fill', selector, text, signals: [] };
  return { frame: FRAME, action, startTime: 0 };
}

function makeNavigate(url: string): ActionInContext {
  const action: NavigateAction = { name: 'navigate', url, signals: [] };
  return { frame: FRAME, action, startTime: 0 };
}

function makeOpenPage(url: string): ActionInContext {
  const action: OpenPageAction = { name: 'openPage', url, signals: [] };
  return { frame: FRAME, action, startTime: 0 };
}

function makeAssertText(selector: string, text: string): ActionInContext {
  const action: AssertTextAction = {
    name: 'assertText',
    selector,
    text,
    substring: false,
    signals: [],
  };
  return { frame: FRAME, action, startTime: 0 };
}

function makeAssertValue(selector: string, value: string): ActionInContext {
  const action: AssertValueAction = { name: 'assertValue', selector, value, signals: [] };
  return { frame: FRAME, action, startTime: 0 };
}

function makePress(selector: string, key: string): ActionInContext {
  const action: PressAction = { name: 'press', selector, key, modifiers: 0, signals: [] };
  return { frame: FRAME, action, startTime: 0 };
}

function makeClick(selector: string): ActionInContext {
  const action: ClickAction = {
    name: 'click',
    selector,
    button: 'left',
    modifiers: 0,
    clickCount: 1,
    signals: [],
  };
  return { frame: FRAME, action, startTime: 0 };
}

// ─── 1. Field-context detection ─────────────────────────────────────────────────

describe('field-context detection', () => {
  it('CSS [type=email] → VALID_EMAIL (no quotes)', () => {
    const result = detectVariables([makeFill('input[type=email]', 'qa@example.com')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({
      name: 'VALID_EMAIL',
      value: 'qa@example.com',
      semantic: 'email',
      occurrences: 1,
      sourceActions: [0],
    });
  });

  it('CSS [type="email"] → VALID_EMAIL (double-quoted attr)', () => {
    const result = detectVariables([makeFill('input[type="email"]', 'qa@example.com')]);
    expect(result.variables[0].name).toBe('VALID_EMAIL');
    expect(result.variables[0].semantic).toBe('email');
  });

  it('CSS [type="password"] → VALID_PASSWORD', () => {
    const result = detectVariables([makeFill('input[type="password"]', 'S3cr3t!')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'VALID_PASSWORD', semantic: 'password' });
  });

  it('CSS [type=tel] → VALID_PHONE', () => {
    const result = detectVariables([makeFill('input[type=tel]', '+66812345678')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'VALID_PHONE', semantic: 'phone' });
  });

  it('CSS [autocomplete=username] → USERNAME', () => {
    const result = detectVariables([makeFill('input[autocomplete=username]', 'john_doe')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'USERNAME', semantic: 'username' });
  });

  it('CSS [autocomplete=current-password] → CURRENT_PASSWORD', () => {
    const result = detectVariables([makeFill('input[autocomplete=current-password]', 'OldP@ss99')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({
      name: 'CURRENT_PASSWORD',
      semantic: 'current-password',
    });
  });

  it('[name=email] selector → email semantic', () => {
    const result = detectVariables([makeFill('input[name=email]', 'user@site.io')]);
    expect(result.variables[0]).toMatchObject({ name: 'VALID_EMAIL', semantic: 'email' });
  });

  it('Playwright internal selector internal:attr=[type="email"] → VALID_EMAIL', () => {
    const result = detectVariables([makeFill('internal:attr=[type="email"]', 'user@test.io')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe('VALID_EMAIL');
  });

  it('Playwright internal selector internal:attr=[type="password"] → VALID_PASSWORD', () => {
    const result = detectVariables([makeFill('internal:attr=[type="password"]', 'MyP@ssw0rd')]);
    expect(result.variables[0].name).toBe('VALID_PASSWORD');
  });

  it('[autocomplete="current-password"] double-quoted attr → CURRENT_PASSWORD', () => {
    const result = detectVariables([
      makeFill('input[autocomplete="current-password"]', 'P@ssOld!'),
    ]);
    expect(result.variables[0].name).toBe('CURRENT_PASSWORD');
  });

  it('internal:label containing "email" → VALID_EMAIL', () => {
    const result = detectVariables([makeFill('internal:label="Email address"', 'a@b.com')]);
    expect(result.variables[0]).toMatchObject({ name: 'VALID_EMAIL', semantic: 'email' });
  });

  it('[aria-label="password"] → VALID_PASSWORD', () => {
    const result = detectVariables([makeFill('[aria-label="password"]', 'secret123')]);
    expect(result.variables[0]).toMatchObject({ name: 'VALID_PASSWORD', semantic: 'password' });
  });

  it('field-context wins over value-regex: email value in [type=email] → VALID_EMAIL not EMAIL fallback', () => {
    // Both mechanisms would produce 'email' semantic here, but field-context should be authoritative.
    const result = detectVariables([makeFill('input[type=email]', 'qa@example.com')]);
    expect(result.variables[0].name).toBe('VALID_EMAIL');
    expect(result.variables[0].semantic).toBe('email');
  });
});

// ─── 2. Value-regex fallback ─────────────────────────────────────────────────────

describe('value-regex fallback', () => {
  it('email-shaped value in generic selector → VALID_EMAIL (fallback)', () => {
    const result = detectVariables([makeFill('#search-box', 'someone@domain.org')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'VALID_EMAIL', semantic: 'email' });
  });

  it('URL in NavigateAction → BASE_URL', () => {
    const result = detectVariables([makeNavigate('https://example.com/login')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'BASE_URL', semantic: 'url' });
  });

  it('URL in OpenPageAction → BASE_URL', () => {
    const result = detectVariables([makeOpenPage('https://app.example.com/')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'BASE_URL', semantic: 'url' });
  });

  it('non-email non-URL in generic selector → no extraction', () => {
    const result = detectVariables([makeFill('#notes', 'some plain text here')]);
    expect(result.variables).toHaveLength(0);
  });

  it('http URL (not https) → BASE_URL', () => {
    const result = detectVariables([makeNavigate('http://staging.example.com/')]);
    expect(result.variables[0].semantic).toBe('url');
    expect(result.variables[0].name).toBe('BASE_URL');
  });
});

// ─── 3. Dedup — same value ────────────────────────────────────────────────────────

describe('dedup — same value repeated', () => {
  it('same email twice → 1 variable, occurrences=2, both indices in sourceActions', () => {
    const result = detectVariables([
      makeFill('input[type=email]', 'qa@example.com'),
      makeFill('#confirm-email', 'qa@example.com'),
    ]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({
      name: 'VALID_EMAIL',
      occurrences: 2,
      sourceActions: [0, 1],
    });
  });

  it('same URL in navigate + openPage → 1 variable, occurrences=2', () => {
    const result = detectVariables([
      makeNavigate('https://example.com/login'),
      makeOpenPage('https://example.com/login'),
    ]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({
      name: 'BASE_URL',
      occurrences: 2,
      sourceActions: [0, 1],
    });
  });

  it('same value appearing 3 times → occurrences=3, sourceActions has all 3 indices', () => {
    const actions = [
      makeFill('input[type=email]', 'qa@example.com'),
      makeFill('input[type=email]', 'qa@example.com'),
      makeFill('input[type=email]', 'qa@example.com'),
    ];
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].occurrences).toBe(3);
    expect(result.variables[0].sourceActions).toEqual([0, 1, 2]);
  });

  it('assertText same email as fill → shared variable', () => {
    const result = detectVariables([
      makeFill('input[type=email]', 'qa@example.com'),
      makeAssertText('#profile-email', 'qa@example.com'),
    ]);
    // Both actions reference the same email value
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].occurrences).toBe(2);
  });
});

// ─── 4. Dedup — different values same semantic ────────────────────────────────────

describe('dedup — different values, same semantic', () => {
  it('two different emails in [type=email] fields → VALID_EMAIL + VALID_EMAIL_2', () => {
    const result = detectVariables([
      makeFill('input[type=email]', 'alice@example.com'),
      makeFill('input[type=email]', 'bob@example.com'),
    ]);
    expect(result.variables).toHaveLength(2);
    expect(result.variables[0]).toMatchObject({
      name: 'VALID_EMAIL',
      value: 'alice@example.com',
      occurrences: 1,
      sourceActions: [0],
    });
    expect(result.variables[1]).toMatchObject({
      name: 'VALID_EMAIL_2',
      value: 'bob@example.com',
      occurrences: 1,
      sourceActions: [1],
    });
  });

  it('two different URLs → BASE_URL + BASE_URL_2', () => {
    const result = detectVariables([
      makeNavigate('https://example.com/login'),
      makeNavigate('https://example.com/dashboard'),
    ]);
    expect(result.variables).toHaveLength(2);
    expect(result.variables[0].name).toBe('BASE_URL');
    expect(result.variables[1].name).toBe('BASE_URL_2');
  });

  it('three distinct emails → VALID_EMAIL, VALID_EMAIL_2, VALID_EMAIL_3', () => {
    const result = detectVariables([
      makeFill('input[type=email]', 'a@x.com'),
      makeFill('input[type=email]', 'b@x.com'),
      makeFill('input[type=email]', 'c@x.com'),
    ]);
    expect(result.variables.map((v) => v.name)).toEqual([
      'VALID_EMAIL',
      'VALID_EMAIL_2',
      'VALID_EMAIL_3',
    ]);
  });

  it('first email repeated then a second distinct email → VALID_EMAIL(×2) + VALID_EMAIL_2', () => {
    const result = detectVariables([
      makeFill('input[type=email]', 'alice@example.com'),
      makeFill('input[type=email]', 'alice@example.com'), // repeat
      makeFill('input[type=email]', 'bob@example.com'),
    ]);
    expect(result.variables).toHaveLength(2);
    expect(result.variables[0]).toMatchObject({
      name: 'VALID_EMAIL',
      occurrences: 2,
      sourceActions: [0, 1],
    });
    expect(result.variables[1]).toMatchObject({ name: 'VALID_EMAIL_2', occurrences: 1 });
  });

  it('two passwords → VALID_PASSWORD + VALID_PASSWORD_2', () => {
    const result = detectVariables([
      makeFill('input[type=password]', 'OldPass1!'),
      makeFill('input[type=password]', 'NewPass2@'),
    ]);
    expect(result.variables[0].name).toBe('VALID_PASSWORD');
    expect(result.variables[1].name).toBe('VALID_PASSWORD_2');
  });

  it('different semantics share no ordinal counter — email + URL each start at ordinal 0', () => {
    const result = detectVariables([
      makeNavigate('https://example.com/login'),
      makeFill('input[type=email]', 'qa@example.com'),
    ]);
    expect(result.variables).toHaveLength(2);
    // Both should be unsuffixed (first of their category)
    const names = result.variables.map((v) => v.name);
    expect(names).toContain('BASE_URL');
    expect(names).toContain('VALID_EMAIL');
  });
});

// ─── 5. Action-type coverage ─────────────────────────────────────────────────────

describe('action-type coverage', () => {
  it('FillAction.text is extracted', () => {
    const result = detectVariables([makeFill('input[type=email]', 'qa@example.com')]);
    expect(result.variables).toHaveLength(1);
  });

  it('NavigateAction.url is extracted', () => {
    const result = detectVariables([makeNavigate('https://example.com')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].semantic).toBe('url');
  });

  it('OpenPageAction.url is extracted', () => {
    const result = detectVariables([makeOpenPage('https://example.com')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].semantic).toBe('url');
  });

  it('AssertTextAction.text is extracted when it matches a pattern', () => {
    const result = detectVariables([makeAssertText('#display', 'qa@example.com')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].semantic).toBe('email');
  });

  it('AssertValueAction.value is extracted (selector-context)', () => {
    const result = detectVariables([makeAssertValue('input[type=email]', 'qa@example.com')]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'VALID_EMAIL', semantic: 'email' });
  });

  it('PressAction.key is NOT extracted', () => {
    const result = detectVariables([makePress('#form', 'Enter')]);
    expect(result.variables).toHaveLength(0);
  });

  it('ClickAction produces no variables', () => {
    const result = detectVariables([makeClick('button[type=submit]')]);
    expect(result.variables).toHaveLength(0);
  });

  it('empty action list → empty result', () => {
    const result = detectVariables([]);
    expect(result.variables).toHaveLength(0);
    expect(result.substitutions.size).toBe(0);
  });
});

// ─── 6. Skip rules ───────────────────────────────────────────────────────────────

describe('skip rules', () => {
  it('empty string is skipped', () => {
    const result = detectVariables([makeFill('input[type=email]', '')]);
    expect(result.variables).toHaveLength(0);
  });

  it('single-character value is skipped', () => {
    const result = detectVariables([makeFill('input[type=email]', 'a')]);
    expect(result.variables).toHaveLength(0);
  });

  it('single digit is skipped', () => {
    const result = detectVariables([makeFill('#otp', '5')]);
    expect(result.variables).toHaveLength(0);
  });

  it('"true" string is skipped', () => {
    const result = detectVariables([makeFill('#toggle', 'true')]);
    expect(result.variables).toHaveLength(0);
  });

  it('"false" string is skipped', () => {
    const result = detectVariables([makeFill('#toggle', 'false')]);
    expect(result.variables).toHaveLength(0);
  });

  it('"Enter" key name is skipped (even if somehow in fill)', () => {
    const result = detectVariables([makeFill('#weird', 'Enter')]);
    expect(result.variables).toHaveLength(0);
  });

  it('"Tab" is skipped', () => {
    const result = detectVariables([makeFill('#field', 'Tab')]);
    expect(result.variables).toHaveLength(0);
  });

  it('plain text in generic selector with no URL/email shape → skipped', () => {
    const result = detectVariables([makeFill('#notes', 'Hello World')]);
    expect(result.variables).toHaveLength(0);
  });
});

// ─── 7. Substitution plan ────────────────────────────────────────────────────────

describe('substitution plan', () => {
  it('produces substitution for each action site', () => {
    const result = detectVariables([makeFill('input[type=email]', 'qa@example.com')]);
    expect(result.substitutions.has(0)).toBe(true);
    const subs = result.substitutions.get(0)!;
    expect(subs).toHaveLength(1);
    expect(subs[0]).toEqual({
      field: 'text',
      oldValue: 'qa@example.com',
      varName: 'VALID_EMAIL',
    });
  });

  it('navigate action substitution references "url" field', () => {
    const result = detectVariables([makeNavigate('https://example.com/login')]);
    const subs = result.substitutions.get(0)!;
    expect(subs[0]).toMatchObject({ field: 'url', varName: 'BASE_URL' });
  });

  it('openPage action substitution references "url" field', () => {
    const result = detectVariables([makeOpenPage('https://example.com/')]);
    const subs = result.substitutions.get(0)!;
    expect(subs[0]).toMatchObject({ field: 'url', varName: 'BASE_URL' });
  });

  it('assertValue action substitution references "value" field', () => {
    const result = detectVariables([makeAssertValue('input[type=email]', 'qa@example.com')]);
    const subs = result.substitutions.get(0)!;
    expect(subs[0]).toMatchObject({ field: 'value', varName: 'VALID_EMAIL' });
  });

  it('skipped actions produce no substitution entries', () => {
    const result = detectVariables([makePress('#form', 'Enter')]);
    expect(result.substitutions.size).toBe(0);
  });

  it('dedup: second occurrence of same value maps to the same varName', () => {
    const result = detectVariables([
      makeFill('input[type=email]', 'qa@example.com'),
      makeFill('#confirm', 'qa@example.com'),
    ]);
    const subs0 = result.substitutions.get(0)!;
    const subs1 = result.substitutions.get(1)!;
    expect(subs0[0].varName).toBe('VALID_EMAIL');
    expect(subs1[0].varName).toBe('VALID_EMAIL');
  });

  it('two distinct emails get different varNames in substitution plan', () => {
    const result = detectVariables([
      makeFill('input[type=email]', 'alice@example.com'),
      makeFill('input[type=email]', 'bob@example.com'),
    ]);
    const sub0 = result.substitutions.get(0)![0];
    const sub1 = result.substitutions.get(1)![0];
    expect(sub0.varName).toBe('VALID_EMAIL');
    expect(sub1.varName).toBe('VALID_EMAIL_2');
  });

  it('actions that produce no variable have no entry in substitutions map', () => {
    const result = detectVariables([
      makeClick('button'),
      makeFill('input[type=email]', 'qa@example.com'),
    ]);
    expect(result.substitutions.has(0)).toBe(false);
    expect(result.substitutions.has(1)).toBe(true);
  });
});

// ─── 8. Snapshot-style integration (fixtures) ────────────────────────────────────

describe('fixture-based integration', () => {
  it('email-field-context fixture → 1 VALID_EMAIL variable', () => {
    const actions = loadFixture('email-field-context');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({
      name: 'VALID_EMAIL',
      value: 'qa@example.com',
      semantic: 'email',
      occurrences: 1,
      sourceActions: [0],
    });
  });

  it('password-field-context fixture → 1 VALID_PASSWORD variable', () => {
    const actions = loadFixture('password-field-context');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({
      name: 'VALID_PASSWORD',
      semantic: 'password',
    });
  });

  it('dedup-same-email-twice fixture → 1 variable, occurrences=2', () => {
    const actions = loadFixture('dedup-same-email-twice');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].occurrences).toBe(2);
    expect(result.variables[0].sourceActions).toEqual([0, 1]);
  });

  it('dedup-two-different-emails fixture → 2 variables with correct names', () => {
    const actions = loadFixture('dedup-two-different-emails');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(2);
    expect(result.variables[0].name).toBe('VALID_EMAIL');
    expect(result.variables[1].name).toBe('VALID_EMAIL_2');
  });

  it('navigate-url fixture → 1 BASE_URL variable', () => {
    const actions = loadFixture('navigate-url');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'BASE_URL', semantic: 'url' });
  });

  it('dedup-url-same-value fixture → 1 BASE_URL, occurrences=2', () => {
    const actions = loadFixture('dedup-url-same-value');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'BASE_URL', occurrences: 2 });
  });

  it('dedup-url-two-different fixture → BASE_URL + BASE_URL_2', () => {
    const actions = loadFixture('dedup-url-two-different');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(2);
    expect(result.variables[0].name).toBe('BASE_URL');
    expect(result.variables[1].name).toBe('BASE_URL_2');
  });

  it('playwright-internal-attr fixture → VALID_EMAIL + VALID_PASSWORD', () => {
    const actions = loadFixture('playwright-internal-attr');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(2);
    const names = result.variables.map((v) => v.name);
    expect(names).toContain('VALID_EMAIL');
    expect(names).toContain('VALID_PASSWORD');
  });

  it('fallback-email-value-regex fixture → VALID_EMAIL (email-shape fallback)', () => {
    const actions = loadFixture('fallback-email-value-regex');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].semantic).toBe('email');
  });

  it('skip-values fixture → no variables extracted', () => {
    const actions = loadFixture('skip-values');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(0);
  });

  it('autocomplete-selectors fixture → USERNAME + CURRENT_PASSWORD', () => {
    const actions = loadFixture('autocomplete-selectors');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(2);
    const byName = Object.fromEntries(result.variables.map((v) => [v.name, v]));
    expect(byName['USERNAME']).toBeDefined();
    expect(byName['CURRENT_PASSWORD']).toBeDefined();
    expect(byName['USERNAME'].semantic).toBe('username');
    expect(byName['CURRENT_PASSWORD'].semantic).toBe('current-password');
  });

  it('mixed-flow fixture → BASE_URL + VALID_EMAIL + VALID_PASSWORD, click not extracted', () => {
    const actions = loadFixture('mixed-flow');
    const result = detectVariables(actions);
    // navigate (index 0), fill email (index 1), fill password (index 2), click (index 3)
    expect(result.variables).toHaveLength(3);
    const names = result.variables.map((v) => v.name);
    expect(names).toContain('BASE_URL');
    expect(names).toContain('VALID_EMAIL');
    expect(names).toContain('VALID_PASSWORD');
    // click at index 3 should have no substitution
    expect(result.substitutions.has(3)).toBe(false);
  });

  it('assert-text-value fixture → email shared across assertText + assertValue', () => {
    const actions = loadFixture('assert-text-value');
    const result = detectVariables(actions);
    // assertText at 0 (generic selector — email-regex fallback) + assertValue at 1
    // ([type=email] → field-context).
    // Both have value 'qa@example.com' → 1 variable, occurrences=2
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].occurrences).toBe(2);
  });

  it('phone-tel-field fixture → VALID_PHONE', () => {
    const actions = loadFixture('phone-tel-field');
    const result = detectVariables(actions);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ name: 'VALID_PHONE', semantic: 'phone' });
  });
});

// ─── 9. Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('variables array is in first-appearance order', () => {
    const result = detectVariables([
      makeNavigate('https://example.com/login'),
      makeFill('input[type=email]', 'qa@example.com'),
      makeFill('input[type=password]', 'S3cr3t!'),
    ]);
    expect(result.variables.map((v) => v.semantic)).toEqual(['url', 'email', 'password']);
  });

  it('result is deterministic: calling twice with same input gives same output', () => {
    const actions = [
      makeNavigate('https://example.com/login'),
      makeFill('input[type=email]', 'qa@example.com'),
    ];
    const r1 = detectVariables(actions);
    const r2 = detectVariables(actions);
    expect(r1.variables).toEqual(r2.variables);
  });

  it('email with special chars (plus addressing) is recognised: user+tag@domain.com', () => {
    const result = detectVariables([makeFill('input[type=email]', 'user+tag@domain.com')]);
    expect(result.variables[0].semantic).toBe('email');
  });

  it('selector with mixed case attribute is still detected (normalised to lowercase)', () => {
    const result = detectVariables([makeFill('Input[TYPE=Email]', 'qa@example.com')]);
    expect(result.variables[0].semantic).toBe('email');
  });

  it('openPage and navigate with same URL share ONE variable', () => {
    const result = detectVariables([
      makeOpenPage('https://example.com'),
      makeNavigate('https://example.com'),
    ]);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].occurrences).toBe(2);
  });
});
