/**
 * Translates Playwright's internal selector format to Browser Library selector strings.
 *
 * Browser Library uses the Playwright selector engine directly, but the internal selector
 * format used by the Playwright recorder (prefixed with `internal:`) must be stripped/mapped
 * to the public-facing selector syntax that Browser Library keywords accept.
 *
 * Internal format examples (from the recorder):
 *   internal:role=button[name="Sign In" i]
 *   internal:text="Submit"
 *   internal:label="Username"
 *   internal:attr[name="placeholder"][value="Search"]
 *   css=.submit-btn
 *   xpath=//button[@id="submit"]
 *
 * Browser Library format (what keywords accept):
 *   role=button[name="Sign In"]
 *   text=Submit
 *   label=Username
 *   placeholder=Search
 *   css=.submit-btn
 *   xpath=//button[@id="submit"]
 */

/**
 * Translate a (possibly chained) internal Playwright selector to a Browser Library selector.
 * Chained selectors use ` >> ` as separator.
 */
export function translateSelector(selector: string): string {
  if (!selector) return selector;

  // Split on Playwright's chaining operator
  const parts = selector.split(' >> ');
  return parts.map(translatePart).join(' >> ');
}

/**
 * Translate a single (non-chained) selector part.
 */
function translatePart(raw: string): string {
  const part = raw.trim();

  // ── internal:role ───────────────────────────────────────────────────────────
  //
  // Playwright recorder emits role selectors in TWO shapes:
  //
  //   internal:role=button[name="Sign In" i]   ← truncated/case-insensitive
  //                                              "i" flag tells Playwright to do
  //                                              a SUBSTRING match on the
  //                                              accessible name. The substring
  //                                              upgrade only fires when the
  //                                              selector starts with `internal:`
  //                                              (see roleSelectorEngine.ts:171).
  //
  //   internal:role=button[name="Sign In" s]   ← full/exact text
  //                                              "s" = strict, case-sensitive,
  //                                              equality match. Safe to expose
  //                                              as `role=` because exact match
  //                                              is the public-syntax default.
  //
  // Strategy:
  //   - If the body carries an `i` flag, keep the `internal:` prefix so the
  //     substring semantic is preserved. Browser Library accepts `internal:role=`
  //     directly (verified against Playwright's selector engine).
  //   - If the body carries an `s` flag (or no flag), strip both the prefix
  //     and the flag — `role=...[name="..."]` is the public, idiomatic form.
  if (part.startsWith('internal:role=')) {
    const body = part.slice('internal:role='.length);
    if (hasCaseInsensitiveFlag(body)) {
      // Preserve substring semantic: emit internal:role=...[name="..." i]
      return 'internal:role=' + body;
    }
    return 'role=' + stripCaseFlags(body);
  }

  // ── internal:text ───────────────────────────────────────────────────────────
  // internal:text="Submit"  →  text=Submit
  // internal:text="Submit"s  (exact)  →  text=Submit
  // internal:text=/regex/   (regex)   →  text=/regex/
  if (part.startsWith('internal:text=')) {
    const body = part.slice('internal:text='.length);
    return 'text=' + extractStringValue(body);
  }

  // ── internal:label ──────────────────────────────────────────────────────────
  // internal:label="Username"  →  label=Username
  if (part.startsWith('internal:label=')) {
    const body = part.slice('internal:label='.length);
    return 'label=' + extractStringValue(body);
  }

  // ── internal:has-text ───────────────────────────────────────────────────────
  // Approximate with text= (no direct Browser Library equivalent in selector strings)
  if (part.startsWith('internal:has-text=')) {
    const body = part.slice('internal:has-text='.length);
    return 'text=' + extractStringValue(body);
  }

  // ── internal:attr ────────────────────────────────────────────────────────────
  // internal:attr[name="placeholder"][value="Search..."]  →  placeholder=Search...
  if (part.startsWith('internal:attr')) {
    return translateAttrPart(part);
  }

  // ── internal:testid ──────────────────────────────────────────────────────────
  // internal:testid=[data-testid="some-id"]      →  [data-testid="some-id"]
  // internal:testid=[data-testid="some-id" i]    →  [data-testid="some-id"]
  // internal:testid=[data-testid="some-id"s]     →  [data-testid="some-id"]
  //
  // Playwright recorder appends an `s` (strict) or `i` (case-insensitive)
  // flag after the quoted value — same convention as role/text selectors.
  // For testid we treat both as equivalent because testid values are
  // developer-defined and should be matched exactly anyway. We strip the
  // flag and emit a plain CSS attribute selector that Browser Library
  // accepts directly.
  if (part.startsWith('internal:testid')) {
    const match = part.match(/\[(?:[^=]+=)?"([^"]+)"\s*[isIS]?\s*\]/);
    if (match) return `[data-testid="${match[1]}"]`;
    return part;
  }

  // ── internal:* catch-all ─────────────────────────────────────────────────────
  // Unknown internal selector — pass through as-is; Browser Library will error
  // if it doesn't understand it, but we don't want to silently swallow it.
  if (part.startsWith('internal:')) {
    return part;
  }

  // ── Everything else: css=, xpath=, nth=, id=, text=, ... ─────────────────────
  return part;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect whether a role-selector body carries the case-insensitive `i` flag
 * AFTER a quoted attribute value, e.g. `[name="Submit" i]`.
 *
 * The `i` flag is critical: it tells Playwright's internal selector engine
 * to perform a SUBSTRING match on the accessible name instead of an exact
 * equality match (see roleSelectorEngine.ts:171). We must keep both the
 * `internal:` prefix and the flag in the output when this is set.
 *
 * We are careful NOT to match an `i` that's inside the quoted string (the
 * pattern requires a `"` followed by optional whitespace then `i` then `]`).
 */
function hasCaseInsensitiveFlag(body: string): boolean {
  return /"\s*i\s*\]/.test(body);
}

/**
 * Strip case-flag markers (`i` or `s`) from attribute value strings inside a
 * selector body. Used when emitting the public `role=` form.
 *
 * Playwright's internal format uses a trailing ` i` (case-insensitive, also
 * implies substring) or ` s` (strict / case-sensitive equality) after a quoted
 * string. Browser Library's public `role=` selector defaults to exact match,
 * so the `s` flag is redundant noise and `i` should be handled separately
 * via the `internal:` prefix path (see translatePart's role handling).
 */
function stripCaseFlags(body: string): string {
  // Strip trailing `i`/`I`/`s`/`S` flag AND any surrounding whitespace before `]`:
  //   "[name="Submit" i]"  →  "[name="Submit"]"
  //   "[name="Submit"s]"   →  "[name="Submit"]"
  //   "[name="Submit" i][checked]"  →  "[name="Submit"][checked]"
  return body.replace(/"\s*[isIS]\s*\]/g, '"]');
}

/**
 * Extract a plain string value from an internal text body.
 *
 * Internal text bodies can be:
 *   "Submit"       → Submit      (JSON-quoted, exact)
 *   "Submit"s      → Submit      (exact flag)
 *   "Submit"i      → Submit      (case-insensitive flag)
 *   /hello/        → /hello/     (regex — pass through)
 */
function extractStringValue(body: string): string {
  // Regex — keep as-is
  if (body.startsWith('/')) return body;

  // Strip trailing `s` or `i` modifier that Playwright appends to quoted strings
  const withoutModifier = body.replace(/^(".*")\s*[si]$/, '$1');

  // JSON-decode the quoted string
  if (withoutModifier.startsWith('"') && withoutModifier.endsWith('"')) {
    try {
      return JSON.parse(withoutModifier) as string;
    } catch {
      // Fall through to raw return
    }
  }

  return withoutModifier;
}

/**
 * Translate `internal:attr[name="..."][value="..."]` selectors.
 *
 * Supported attribute names → Browser Library shorthand:
 *   placeholder  →  placeholder=<value>
 *   alt          →  alt=<value>
 *   title        →  title=<value>
 */
function translateAttrPart(part: string): string {
  const nameMatch = part.match(/\[name="([^"]+)"\]/);
  const valueMatch = part.match(/\[value="([^"]+)"\]/);

  if (!nameMatch) return part;

  const attrName = nameMatch[1];
  const attrValue = valueMatch ? valueMatch[1] : '';

  switch (attrName) {
    case 'placeholder':
      return `placeholder=${attrValue}`;
    case 'alt':
      return `alt=${attrValue}`;
    case 'title':
      return `title=${attrValue}`;
    default:
      return `[${attrName}="${attrValue}"]`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Robot Framework value escaping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape a string value for safe use inside a Robot Framework keyword call.
 *
 * Robot Framework parses the source line; several substrings must be escaped
 * to round-trip through that parser as literals:
 *
 *   - `${var}` / `@{var}` / `&{var}` / `%{var}` — variable references; must be
 *     escaped or RF will resolve them against the current scope at runtime.
 *   - 2+ consecutive spaces — RF treats `≥2` spaces as the argument separator.
 *     Multi-space runs inside a single value would silently split into extra
 *     positional args. Replace each space inside a multi-space run with `\ `
 *     (backslash-space) so it stays a single argument while preserving the
 *     visible spacing at runtime.
 *
 * NOTE: Backslash itself is intentionally NOT doubled here. Robot Framework
 * needs `\\` to represent a literal backslash, but doubling every `\` in our
 * input would also break selectors like `xpath=//*[contains(@class,"foo")]`
 * that legitimately contain backslash-escaped tokens. Selectors and URLs
 * almost never contain bare backslashes; if a future case demands it, add a
 * dedicated `escapePathForRobot()` instead of changing this function.
 */
export function escapeRobotValue(value: string): string {
  return value
    .replace(/\$\{/g, '\\${')
    .replace(/@\{/g, '\\@{')
    .replace(/&\{/g, '\\&{')
    .replace(/%\{/g, '\\%{')
    .replace(/ {2,}/g, (m) => '\\ '.repeat(m.length));
}
