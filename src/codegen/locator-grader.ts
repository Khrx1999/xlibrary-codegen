/**
 * Pure quality-grading module for selector candidates.
 *
 * Implements spec §2.3 — assigns a letter grade to each candidate selector
 * using a two-step heuristic:
 *   1. Classify the selector into a SelectorKind.
 *   2. Derive a base grade from the kind table.
 *   3. Optionally apply a +1-tier bonus when matchCount === 1 (unique on page).
 *
 * This module has NO I/O and NO side effects — it is a pure computation layer
 * consumed by the Self-Healing emitter (Task #7).
 *
 * ## Selector kind classification rules
 *
 * Recognizes both Playwright's `internal:` prefixed forms and bare CSS/XPath
 * forms. Detection order matters — more-specific prefixes are tested first.
 *
 * | Pattern                                              | Kind             |
 * | ---------------------------------------------------- | ---------------- |
 * | `internal:testid=...`                                | `testid`         |
 * | `[data-testid="..."]` or `[data-testid=...]`         | `testid`         |
 * | `internal:role=<role>[name="..."]` (has name attr)   | `role-with-name` |
 * | `role=<role>[name="..."]` (has name attr)            | `role-with-name` |
 * | `internal:role=<role>` (no name attr)                | `unknown`        |
 * | `internal:label=...`                                 | `label`          |
 * | `label=...`                                          | `label`          |
 * | `internal:attr=[placeholder=...]`                    | `placeholder`    |
 * | `placeholder=...`                                    | `placeholder`    |
 * | `internal:text=...`                                  | `text`           |
 * | `internal:has-text=...`                              | `text`           |
 * | `text=...`                                           | `text`           |
 * | `xpath=...` or starts with `//`                      | `xpath`          |
 * | `css=...`                                            | `css`            |
 * | Starts with `.` `#` `[` `:` (bare CSS)              | `css`            |
 * | Empty string or unrecognized prefix                  | `unknown`        |
 *
 * ### Role-without-name is classified as `unknown`
 * A bare `internal:role=button` (no `[name="..."]` attribute) is not a
 * stable selector — it will match every button on the page. Grading it as
 * `unknown` (D) surfaces this to the caller and prevents Self-Healing from
 * promoting it as a primary candidate.
 *
 * @module locator-grader
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Letter grade for a selector candidate — ordered best (A+) to worst (D). */
export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D';

/** The kinds of selectors the grader can classify. */
export type SelectorKind =
  | 'testid' // data-testid / [data-testid=...] / internal:testid
  | 'role-with-name' // role=button[name="Submit"] or internal:role=button[name="..."]
  | 'label' // label=Email or internal:label=...
  | 'placeholder' // placeholder=... / internal:attr=[placeholder=...]
  | 'text' // text=... / internal:text=...
  | 'css' // css=... or starts with . # [ : etc.
  | 'xpath' // xpath=... or starts with //
  | 'unknown'; // anything else (empty, bare role, unrecognized)

/** Input to the grading pipeline. */
export interface GradeInput {
  selector: string;
  /**
   * How many elements this selector matches on the live page.
   * Pass `undefined` when uniqueness has not been measured — the bonus
   * is then NOT applied (conservative default).
   */
  matchCount?: number;
}

/** Full grading result for one candidate. */
export interface GradeResult {
  selector: string;
  kind: SelectorKind;
  grade: Grade;
  /** `true` when matchCount === 1 (unique on page). */
  uniqueOnPage: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grade ordering helpers (private)
// ─────────────────────────────────────────────────────────────────────────────

/** Numeric rank for sorting — lower = better. */
const GRADE_RANK: Record<Grade, number> = {
  'A+': 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
};

/** Ordered list of grades, index = tier level (0 = best). */
const GRADE_TIERS: Grade[] = ['A+', 'A', 'B', 'C', 'D'];

/**
 * Promote a grade by `tiers` steps toward 'A+'.
 * Clamped at 'A+' — cannot exceed the top tier.
 */
function promoteGrade(grade: Grade, tiers: number): Grade {
  const currentIndex = GRADE_RANK[grade];
  const newIndex = Math.max(0, currentIndex - tiers);
  return GRADE_TIERS[newIndex];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify the kind of a selector string.
 *
 * The classification is purely syntactic — it does not resolve the selector
 * against a live DOM. See the module-level JSDoc for the full rule table.
 *
 * Empty strings and unrecognized forms return `'unknown'`.
 */
export function classifySelector(selector: string): SelectorKind {
  if (!selector || selector.trim() === '') return 'unknown';

  const s = selector.trim();

  // ── internal:testid ─────────────────────────────────────────────────────────
  // e.g. internal:testid=["login-btn"]
  if (s.startsWith('internal:testid')) return 'testid';

  // ── CSS data-testid attribute selector ──────────────────────────────────────
  // e.g. [data-testid="login"] or [data-testid=login]
  if (/^\[data-testid[=\]"']/.test(s)) return 'testid';

  // ── internal:role ────────────────────────────────────────────────────────────
  // role-with-name requires a [name="..."] attribute in the selector body.
  // Without a name the role is too broad → 'unknown'.
  if (s.startsWith('internal:role=')) {
    return hasNameAttribute(s) ? 'role-with-name' : 'unknown';
  }

  // ── bare role= ───────────────────────────────────────────────────────────────
  // e.g. role=button[name="Submit"]
  if (s.startsWith('role=')) {
    return hasNameAttribute(s) ? 'role-with-name' : 'unknown';
  }

  // ── internal:label ───────────────────────────────────────────────────────────
  if (s.startsWith('internal:label=')) return 'label';

  // ── bare label= ──────────────────────────────────────────────────────────────
  if (s.startsWith('label=')) return 'label';

  // ── internal:attr with placeholder ──────────────────────────────────────────
  // e.g. internal:attr=[placeholder="Search"]
  if (s.startsWith('internal:attr') && /\[(?:name=")?\s*placeholder/.test(s)) {
    return 'placeholder';
  }

  // ── bare placeholder= ────────────────────────────────────────────────────────
  if (s.startsWith('placeholder=')) return 'placeholder';

  // ── internal:text / internal:has-text ────────────────────────────────────────
  if (s.startsWith('internal:text=') || s.startsWith('internal:has-text=')) return 'text';

  // ── bare text= ───────────────────────────────────────────────────────────────
  if (s.startsWith('text=')) return 'text';

  // ── xpath=... or bare //... ──────────────────────────────────────────────────
  if (s.startsWith('xpath=') || s.startsWith('//')) return 'xpath';

  // ── explicit css= ────────────────────────────────────────────────────────────
  if (s.startsWith('css=')) return 'css';

  // ── Bare CSS patterns: starts with . # [ : ───────────────────────────────────
  if (/^[.#[:]/.test(s)) return 'css';

  // ── Catch-all for remaining internal:* prefixes ──────────────────────────────
  // Anything with internal:* that wasn't matched above is unknown.
  if (s.startsWith('internal:')) return 'unknown';

  // ── Bare tag selectors, id selectors, etc. fall through to css ───────────────
  // e.g. "button", "input[type=submit]" — treat as CSS.
  // Only if they look like valid CSS identifiers (letter or _ or -).
  if (/^[a-zA-Z_-]/.test(s)) return 'css';

  return 'unknown';
}

/**
 * Base grade derived from selector kind, per spec §2.3 heuristic table.
 *
 * | Kind          | Base grade |
 * | ------------- | ---------- |
 * | testid        | A+         |
 * | role-with-name| A          |
 * | label         | A          |
 * | placeholder   | B          |
 * | text          | B          |
 * | css           | C          |
 * | xpath         | D          |
 * | unknown       | D          |
 */
export function baseGradeFor(kind: SelectorKind): Grade {
  switch (kind) {
    case 'testid':
      return 'A+';
    case 'role-with-name':
      return 'A';
    case 'label':
      return 'A';
    case 'placeholder':
      return 'B';
    case 'text':
      return 'B';
    case 'css':
      return 'C';
    case 'xpath':
      return 'D';
    case 'unknown':
      return 'D';
  }
}

/**
 * Apply the +1-grade-tier uniqueness bonus when `matchCount === 1`.
 *
 * Rules:
 *   - If `matchCount` is `undefined` → bonus NOT applied (conservative).
 *   - If `matchCount === 0` → bonus NOT applied (zero matches = broken selector).
 *   - If `matchCount === 1` → promote grade by one tier.
 *   - If `matchCount > 1`  → bonus NOT applied (selector is ambiguous).
 *   - A+ is already the top tier; bonus leaves it unchanged.
 *
 * @param base      - The base grade before bonus.
 * @param matchCount - Number of elements matched on the live page.
 */
export function applyUniquenessBonus(base: Grade, matchCount: number | undefined): Grade {
  if (matchCount !== 1) return base;
  return promoteGrade(base, 1);
}

/**
 * Full grading pipeline for one candidate.
 *
 * Steps:
 *   1. classifySelector → kind
 *   2. baseGradeFor(kind) → base
 *   3. applyUniquenessBonus(base, matchCount) → final grade
 */
export function gradeCandidate(input: GradeInput): GradeResult {
  const kind = classifySelector(input.selector);
  const base = baseGradeFor(kind);
  const grade = applyUniquenessBonus(base, input.matchCount);
  return {
    selector: input.selector,
    kind,
    grade,
    uniqueOnPage: input.matchCount === 1,
  };
}

/**
 * Grade a list of candidates and return them sorted best → worst.
 *
 * Sorting is STABLE for equal grades — candidates with the same final grade
 * keep their original input order. This guarantees deterministic output when
 * Self-Healing picks primary + top-3 alternatives.
 *
 * @param inputs - Array of GradeInputs (may be empty).
 * @returns      - Sorted GradeResult[], best grade first.
 */
export function rankCandidates(inputs: GradeInput[]): GradeResult[] {
  const graded = inputs.map((input) => gradeCandidate(input));
  // Stable sort: preserve original index for equal grades.
  return graded.sort((a, b) => GRADE_RANK[a.grade] - GRADE_RANK[b.grade]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return `true` when the selector body contains a `[name="..."]` attribute,
 * indicating a role selector bound to an accessible name.
 *
 * Matches both quoted and unquoted name values:
 *   `[name="Submit"]`  →  true
 *   `[name=Submit]`    →  true
 *   (no [name=...])    →  false
 */
function hasNameAttribute(selector: string): boolean {
  return /\[name\s*=/.test(selector);
}
