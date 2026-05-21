/**
 * selenium-locator.ts
 *
 * Translate Playwright's internal selector format into a string that
 * SeleniumLibrary's locator engine understands.
 *
 * SeleniumLibrary accepts these locator strategies (prefix-delimited):
 *   id=…       — element id
 *   name=…     — element name attribute
 *   css=…      — CSS selector
 *   xpath=…    — XPath expression
 *   link=…     — exact link text of <a>
 *   partial link=…
 *   data:…     — data-* attribute helper (newer SeleniumLibrary)
 *   default    — falls back to id-or-name auto-detect
 *
 * Playwright internals we translate from:
 *   internal:role=role[name="X"]            (with optional " i"/" s" flag)
 *   internal:text="X"
 *   internal:label="X"
 *   internal:has-text="X"
 *   internal:attr[name="placeholder"][value="X"]
 *   internal:testid=[data-testid="X"]
 *   plain css selectors (no prefix)
 *   already-prefixed: css=, xpath=, id=, …
 *
 * Strategy: when there's no clean SeleniumLibrary equivalent we fall back
 * to XPath because XPath can express any DOM query. CSS is preferred when
 * the selector is already CSS-like (faster, easier to read).
 */

/**
 * Translate a Playwright internal selector to a SeleniumLibrary locator
 * string. Chained selectors (` >> `) are joined into a single XPath using
 * descendant axes — SeleniumLibrary has no native chaining, so we collapse.
 */
export function translateSelectorForSelenium(selector: string): string {
  if (!selector) return selector;

  const parts = selector.split(' >> ').map(translatePart);

  // Single part — return directly.
  if (parts.length === 1) return parts[0];

  // Multiple chained parts — try to merge into one XPath.
  // For SeleniumLibrary we cannot do `>>` chaining, so we approximate by
  // joining XPath fragments. If all parts are XPath, we concatenate with `//`.
  // If parts mix strategies, the FIRST one wins and the rest are dropped with
  // a comment-friendly marker. This is intentionally lossy — chained selectors
  // are rare from the recorder; almost everything is a single getByRole/getByLabel.
  const allXpath = parts.every((p) => p.startsWith('xpath='));
  if (allXpath) {
    const merged = parts
      .map((p) => p.slice('xpath='.length))
      .map((p, i) => (i === 0 ? p : p.startsWith('//') ? p : '//' + p))
      .join('');
    return 'xpath=' + merged;
  }
  return parts[0];
}

/** Translate one (non-chained) selector part. */
function translatePart(raw: string): string {
  const part = raw.trim();

  // ── internal:role=role[name="X" i|s] ────────────────────────────────────────
  // SeleniumLibrary doesn't have role= — we materialise to XPath.
  // The recorder always emits an aria role + accessible name; for most roles
  // the accessible name == the visible text, so:
  //
  //   role=button[name="Submit"]
  //     → xpath=//button[normalize-space(.)='Submit']
  //
  //   For roles like `link` we keep <a>:
  //     → xpath=//a[normalize-space(.)='Submit']
  //
  // The "i" (case-insensitive) flag → substring contains() instead of equality.
  if (part.startsWith('internal:role=')) {
    return roleToXPath(part.slice('internal:role='.length));
  }

  // ── internal:text="X" → xpath=//*[normalize-space(.)='X'] ───────────────────
  if (part.startsWith('internal:text=')) {
    const body = part.slice('internal:text='.length);
    const { value, isSubstring } = parseQuotedFlag(body);
    if (isSubstring) return `xpath=//*[contains(normalize-space(.), ${xpathLiteral(value)})]`;
    return `xpath=//*[normalize-space(.)=${xpathLiteral(value)}]`;
  }

  // ── internal:has-text — same shape as text, contains semantics ──────────────
  if (part.startsWith('internal:has-text=')) {
    const body = part.slice('internal:has-text='.length);
    const { value } = parseQuotedFlag(body);
    return `xpath=//*[contains(normalize-space(.), ${xpathLiteral(value)})]`;
  }

  // ── internal:label="X" → //input following <label> containing X ─────────────
  if (part.startsWith('internal:label=')) {
    const body = part.slice('internal:label='.length);
    const { value } = parseQuotedFlag(body);
    return `xpath=//label[contains(normalize-space(.), ${xpathLiteral(value)})]/following::*[self::input or self::textarea or self::select][1]`;
  }

  // ── internal:attr[name="placeholder"][value="X"] → css=[placeholder='X'] ────
  if (part.startsWith('internal:attr')) {
    return attrToCss(part);
  }

  // ── internal:testid=[data-testid="X"] → css=[data-testid="X"] ──────────────
  if (part.startsWith('internal:testid')) {
    const match = part.match(/\[(?:[^=]+=)?"([^"]+)"\s*[isIS]?\s*\]/);
    if (match) return `css=[data-testid="${match[1]}"]`;
    return passthroughCss(part);
  }

  // ── Already-prefixed selectors: pass through unchanged ──────────────────────
  if (/^(css|xpath|id|name|link|partial link|data):/i.test(part)) {
    return part;
  }
  if (/^(css|xpath|id|name|link)=/i.test(part)) {
    return part;
  }

  // ── Unknown internal: pass through as xpath if it looks like one ───────────
  if (part.startsWith('internal:')) {
    return part;
  }

  // ── Default: treat as CSS (most plain recorder selectors are CSS-shaped) ──
  return passthroughCss(part);
}

/** Decide between `css=...` and a bare locator for plain selectors. */
function passthroughCss(part: string): string {
  if (part.startsWith('//') || part.startsWith('(/')) return 'xpath=' + part;
  return 'css=' + part;
}

// ─────────────────────────────────────────────────────────────────────────────
// role → xpath
// ─────────────────────────────────────────────────────────────────────────────

/** Element tags commonly aligned with a single ARIA role. */
const ROLE_TO_TAG: Record<string, string> = {
  button: 'button',
  link: 'a',
  textbox: 'input',
  checkbox: 'input',
  radio: 'input',
  combobox: 'select',
  listbox: 'select',
  option: 'option',
  heading: '*', // could be h1..h6; we keep generic and add role attr
  cell: 'td',
  row: 'tr',
  table: 'table',
  img: 'img',
  list: 'ul',
};

function roleToXPath(body: string): string {
  // Parse: roleName[name="X" i|s] (the name attribute is optional)
  const match = body.match(/^([\w-]+)(?:\[name="([^"]+)"\s*([is])?\s*\])?/);
  if (!match) return `xpath=//*[@role='${body.replace(/'/g, '&apos;')}']`;

  const role = match[1];
  const accName = match[2];
  const flag = match[3];

  const tag = ROLE_TO_TAG[role] ?? '*';
  const baseTag = tag === '*' ? `*[@role='${role}']` : tag;

  if (!accName) {
    return `xpath=//${baseTag}`;
  }

  const lit = xpathLiteral(accName);
  if (flag === 'i') {
    return `xpath=//${baseTag}[contains(normalize-space(.), ${lit})]`;
  }
  return `xpath=//${baseTag}[normalize-space(.)=${lit}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// internal:attr → css=
// ─────────────────────────────────────────────────────────────────────────────

function attrToCss(part: string): string {
  const nameMatch = part.match(/\[name="([^"]+)"\]/);
  const valueMatch = part.match(/\[value="([^"]+)"\]/);
  if (!nameMatch) return part;

  const attr = nameMatch[1];
  const value = valueMatch ? valueMatch[1] : '';
  // SeleniumLibrary css= accepts standard CSS attribute selectors.
  return `css=[${attr}="${value}"]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a quoted internal value possibly followed by an `i`/`s` flag.
 *   "Submit"        → { value: "Submit", isSubstring: false }
 *   "Submit"i       → { value: "Submit", isSubstring: true  }
 *   "Submit"s       → { value: "Submit", isSubstring: false }
 *   /regex/         → { value: "/regex/", isSubstring: false } (passthrough)
 */
function parseQuotedFlag(body: string): { value: string; isSubstring: boolean } {
  if (body.startsWith('/')) return { value: body, isSubstring: false };

  const m = body.match(/^"((?:[^"\\]|\\.)*)"\s*([is])?$/);
  if (m) {
    let value = m[1];
    try {
      value = JSON.parse(`"${m[1]}"`) as string;
    } catch {
      // keep raw
    }
    return { value, isSubstring: m[2] === 'i' };
  }
  return { value: body, isSubstring: false };
}

/**
 * Build a safe XPath string literal. XPath has no escape mechanism for
 * quotes inside a literal, so we use `concat()` when both quote types appear.
 *   `Hello`           → 'Hello'
 *   `It's fine`       → "It's fine"
 *   `She said "hi"`   → concat('She said "hi"')  → 'She said "hi"'
 *   `O'Brien "X"`     → concat("O'Brien ", '"X"')
 */
export function xpathLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  // Both quotes present — split on single quote, alternate literal quotes.
  const parts = s.split("'");
  const pieces: string[] = [];
  parts.forEach((p, i) => {
    if (p) pieces.push(`'${p}'`);
    if (i < parts.length - 1) pieces.push(`"'"`);
  });
  return `concat(${pieces.join(', ')})`;
}
