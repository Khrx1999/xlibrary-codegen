/**
 * Test Data Wizard — Detection Engine
 *
 * Pure, deterministic module that analyses an ActionInContext[] stream and
 * produces a DetectionResult: the set of variables to extract and a map of
 * per-action substitutions to apply.
 *
 * Detection priority
 * ──────────────────
 * 1. Field-context (selector semantics): `[type=email]`, `[type=password]`,
 *    `[type=tel]`, `[autocomplete=username]`, `[autocomplete=current-password]`,
 *    `[name=email]` etc.  Recognises both Playwright-internal format
 *    (`internal:attr=[type="email"]`) and plain CSS (`input[type=email]`).
 *
 * 2. Value regex fallback: URL pattern → BASE_URL / URL_n,
 *    email shape → EMAIL_n.
 *
 * Dedup (spec §4.3)
 * ─────────────────
 * • Same value, same semantic → shared single variable (occurrences accumulates).
 * • Same semantic, different value → first gets the unsuffixed name, subsequent
 *   distinct values get _2, _3, … suffix.
 * • The ordered dedup maps are keyed by (semantic, value) for exact-match lookup.
 */

import type { ActionInContext } from '../types.js';

// ─── Public types ──────────────────────────────────────────────────────────────

export type VariableSemantic =
  | 'email'
  | 'password'
  | 'phone'
  | 'username'
  | 'current-password'
  | 'url'
  | 'unknown';

export interface ExtractedVariable {
  /** Variable name without `${}` wrapper, e.g. `VALID_EMAIL`, `BASE_URL`. */
  name: string;
  /** The literal value found in the recorded action. */
  value: string;
  /** How many action sites reference this variable. */
  occurrences: number;
  /** Indices into the input ActionInContext[] where this value appears. */
  sourceActions: number[];
  /** Semantic category that drove the name choice. */
  semantic: VariableSemantic;
}

export interface DetectionResult {
  /** Ordered list of variables to declare in `*** Variables ***`. */
  variables: ExtractedVariable[];
  /**
   * Map from action-index → substitutions to apply to that action.
   * Implementation of the actual text replacement lives in Task #14;
   * this map is the plan only.
   */
  substitutions: Map<number, Array<{ field: string; oldValue: string; varName: string }>>;
}

// ─── Internal types ────────────────────────────────────────────────────────────

/** Intermediate accumulation record keyed by (semantic, value). */
interface CandidateEntry {
  semantic: VariableSemantic;
  value: string;
  /** 0-based ordinal within the semantic category (0 = first distinct value). */
  ordinal: number;
  occurrences: number;
  sourceActions: number[];
}

// ─── Regex constants ───────────────────────────────────────────────────────────

const RE_EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_URL_VALUE = /^https?:\/\//;

/**
 * Values that look like keyboard key names or boolean literals.
 * Detection is skipped for these values regardless of selector context.
 */
const SKIP_VALUES = new Set<string>([
  'Enter',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'true',
  'false',
]);

// ─── Selector → semantic ────────────────────────────────────────────────────────

/**
 * Derive a semantic category from a selector string.
 *
 * Handles both Playwright-internal attribute syntax:
 *   `internal:attr=[type="email"]`
 *   `internal:attr=[autocomplete="username"]`
 *
 * And standard CSS attribute selector forms:
 *   `input[type=email]`
 *   `input[type="email"]`
 *   `[name=email]`
 *   `[autocomplete=current-password]`
 *
 * Returns `null` when no field-context signal is found.
 */
function semanticFromSelector(selector: string): VariableSemantic | null {
  // Normalise: lowercase, collapse whitespace
  const s = selector.toLowerCase().replace(/\s+/g, '');

  // --- type attribute ---
  if (containsAttr(s, 'type', 'email')) return 'email';
  if (containsAttr(s, 'type', 'password')) return 'password';
  if (containsAttr(s, 'type', 'tel')) return 'phone';

  // --- autocomplete attribute ---
  if (containsAttr(s, 'autocomplete', 'username')) return 'username';
  if (containsAttr(s, 'autocomplete', 'current-password')) return 'current-password';
  if (containsAttr(s, 'autocomplete', 'email')) return 'email';

  // --- name attribute (common shorthand: name=email, name=username, etc.) ---
  if (containsAttr(s, 'name', 'email')) return 'email';
  if (containsAttr(s, 'name', 'password')) return 'password';
  if (containsAttr(s, 'name', 'username')) return 'username';
  if (containsAttr(s, 'name', 'phone') || containsAttr(s, 'name', 'tel')) return 'phone';

  // --- aria-label / label text heuristic (getByLabel, internal:label) ---
  // e.g. `internal:label="Email"` or `[aria-label="email"]`
  if (containsLabel(s, 'email')) return 'email';
  if (containsLabel(s, 'password')) return 'password';
  if (containsLabel(s, 'phone') || containsLabel(s, 'tel')) return 'phone';
  if (containsLabel(s, 'username')) return 'username';

  return null;
}

/**
 * Returns true when the normalised selector string contains an attribute check
 * for `attrName` with `attrValue` in any of the common CSS / Playwright-internal
 * attribute selector syntaxes.
 *
 * Patterns checked (all lowercased before comparison):
 *   [attrName=attrValue]
 *   [attrName="attrValue"]
 *   [attrName='attrValue']
 */
function containsAttr(normalised: string, attrName: string, attrValue: string): boolean {
  if (normalised.includes(`[${attrName}=${attrValue}]`)) return true;
  if (normalised.includes(`[${attrName}="${attrValue}"]`)) return true;
  if (normalised.includes(`[${attrName}='${attrValue}']`)) return true;
  return false;
}

/**
 * Returns true when the selector contains a label or aria-label reference that
 * includes the keyword.
 *
 * Playwright internal format: `internal:label="Email address"`
 * CSS aria-label: `[aria-label="email"]`
 */
function containsLabel(normalised: string, keyword: string): boolean {
  const labelIdx = normalised.indexOf('label=');
  if (labelIdx === -1) return false;
  // Take the substring after `label=`, strip any leading quote, check for keyword.
  const rest = normalised.slice(labelIdx + 'label='.length).replace(/^["']/, '');
  return rest.includes(keyword);
}

// ─── Value → semantic (fallback) ───────────────────────────────────────────────

/**
 * Derive a semantic category from the value itself (fallback when the selector
 * provides no context).
 *
 * Returns `null` for values that should not be extracted at all (empty,
 * single-char, booleans, key names, values with no recognisable pattern).
 */
function semanticFromValue(value: string): VariableSemantic | null {
  if (shouldSkip(value)) return null;
  if (RE_URL_VALUE.test(value)) return 'url';
  if (RE_EMAIL_VALUE.test(value)) return 'email';
  return null;
}

/**
 * True when the value should never be extracted as a variable.
 *
 * Rules:
 *  - Empty string
 *  - Single character (e.g. key presses: "a", "5")
 *  - Boolean-looking strings ("true", "false")
 *  - Known keyboard key names ("Enter", "Tab", …)
 */
function shouldSkip(value: string): boolean {
  if (value.length <= 1) return true;
  if (SKIP_VALUES.has(value)) return true;
  return false;
}

// ─── Naming ─────────────────────────────────────────────────────────────────────

/**
 * Base variable name for each semantic category.
 * The first distinct value gets the base name; subsequent distinct values
 * get the base name with `_2`, `_3`, … suffix.
 */
function baseNameForSemantic(semantic: VariableSemantic): string {
  switch (semantic) {
    case 'email':
      return 'VALID_EMAIL';
    case 'password':
      return 'VALID_PASSWORD';
    case 'phone':
      return 'VALID_PHONE';
    case 'username':
      return 'USERNAME';
    case 'current-password':
      return 'CURRENT_PASSWORD';
    case 'url':
      return 'BASE_URL';
    case 'unknown':
      return 'VALUE';
  }
}

/**
 * Build the final variable name from the base name and the 0-based ordinal
 * within the category.
 *
 * ordinal=0 → `BASE_URL`
 * ordinal=1 → `BASE_URL_2`
 * ordinal=2 → `BASE_URL_3`
 */
function nameFromOrdinal(semantic: VariableSemantic, ordinal: number): string {
  const base = baseNameForSemantic(semantic);
  if (ordinal === 0) return base;
  return `${base}_${ordinal + 1}`;
}

// ─── Field extraction ────────────────────────────────────────────────────────────

interface FieldCandidate {
  /** The field within the action that contains this value (for substitution plan). */
  field: string;
  value: string;
  /**
   * Selector string — used for field-context detection.
   * `null` for URL-bearing actions (navigate / openPage) which have no selector.
   */
  selector: string | null;
}

/**
 * Extract candidate (field, value, selector?) tuples from a single action.
 *
 * Only the action types listed in the spec §4.2 are checked:
 * - FillAction.text
 * - NavigateAction.url
 * - OpenPageAction.url
 * - AssertTextAction.text
 * - AssertValueAction.value
 *
 * PressAction.key is intentionally excluded per spec.
 */
function extractCandidates(action: ActionInContext['action']): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];

  switch (action.name) {
    case 'fill': {
      if (!shouldSkip(action.text)) {
        candidates.push({ field: 'text', value: action.text, selector: action.selector });
      }
      break;
    }
    case 'navigate': {
      if (!shouldSkip(action.url)) {
        candidates.push({ field: 'url', value: action.url, selector: null });
      }
      break;
    }
    case 'openPage': {
      if (!shouldSkip(action.url)) {
        candidates.push({ field: 'url', value: action.url, selector: null });
      }
      break;
    }
    case 'assertText': {
      if (!shouldSkip(action.text)) {
        candidates.push({ field: 'text', value: action.text, selector: action.selector });
      }
      break;
    }
    case 'assertValue': {
      if (!shouldSkip(action.value)) {
        candidates.push({ field: 'value', value: action.value, selector: action.selector });
      }
      break;
    }
    // click, hover, check, uncheck, press, select, setInputFiles, closePage,
    // assertVisible, assertChecked, assertSnapshot → no extractable text values
    default:
      break;
  }

  return candidates;
}

// ─── Main detection function ─────────────────────────────────────────────────────

/**
 * Analyse an array of recorded actions and produce the detection plan.
 *
 * Algorithm
 * ─────────
 * Single pass over the actions array. For each candidate field value:
 *
 * 1. Determine semantic (selector-context first → value-regex fallback).
 *    Skip if no semantic can be derived.
 *
 * 2. Build composite key `${semantic}::${value}`.
 *    - First occurrence of this key → assign ordinal = current count for that
 *      semantic category, then increment the counter. Create a new entry.
 *    - Subsequent occurrences → accumulate occurrences + sourceActions on the
 *      existing entry.
 *
 * 3. Record the substitution plan for this action site.
 *
 * The Map insertion-order guarantee means `variables` in the result is ordered
 * by first appearance in the recorded sequence.
 *
 * @param actions - Ordered array of recorded ActionInContext from the recorder.
 * @returns DetectionResult with `variables` and `substitutions`.
 */
export function detectVariables(actions: ActionInContext[]): DetectionResult {
  // Map from composite key `${semantic}::${value}` → CandidateEntry.
  // Insertion order = first-appearance order (JS Map preserves insertion order).
  const byKey = new Map<string, CandidateEntry>();

  // Count of distinct values seen per semantic — drives ordinal assignment.
  const semanticOrdinalCounter = new Map<VariableSemantic, number>();

  // Substitution plan per action index.
  const substitutions = new Map<
    number,
    Array<{ field: string; oldValue: string; varName: string }>
  >();

  for (let actionIdx = 0; actionIdx < actions.length; actionIdx++) {
    const actionInCtx = actions[actionIdx];
    const candidates = extractCandidates(actionInCtx.action);

    for (const candidate of candidates) {
      // ── Step 1: determine semantic ──
      let semantic: VariableSemantic | null;

      if (candidate.selector !== null) {
        // Field-context has priority; fall back to value-regex if selector is generic.
        semantic = semanticFromSelector(candidate.selector) ?? semanticFromValue(candidate.value);
      } else {
        // URL-bearing actions (navigate / openPage) — value regex only.
        semantic = semanticFromValue(candidate.value);
      }

      if (semantic === null) continue;

      // ── Step 2: dedup by (semantic, value) ──
      const compositeKey = `${semantic}::${candidate.value}`;

      if (!byKey.has(compositeKey)) {
        // New distinct value for this semantic category.
        const ordinal = semanticOrdinalCounter.get(semantic) ?? 0;
        semanticOrdinalCounter.set(semantic, ordinal + 1);

        byKey.set(compositeKey, {
          semantic,
          value: candidate.value,
          ordinal,
          occurrences: 1,
          sourceActions: [actionIdx],
        });
      } else {
        // Same value seen again — accumulate.
        const entry = byKey.get(compositeKey)!;
        entry.occurrences += 1;
        if (!entry.sourceActions.includes(actionIdx)) {
          entry.sourceActions.push(actionIdx);
        }
      }

      // ── Step 3: record substitution plan for this action site ──
      const entry = byKey.get(compositeKey)!;
      const varName = nameFromOrdinal(entry.semantic, entry.ordinal);

      const actionSubs = substitutions.get(actionIdx) ?? [];
      // Guard: don't duplicate if the same (field, value) was already planned
      // (can happen when an action has two identical fields — unlikely but safe).
      const alreadyPlanned = actionSubs.some(
        (s) => s.field === candidate.field && s.oldValue === candidate.value,
      );
      if (!alreadyPlanned) {
        actionSubs.push({ field: candidate.field, oldValue: candidate.value, varName });
        substitutions.set(actionIdx, actionSubs);
      }
    }
  }

  // ── Build output variables array in insertion (first-appearance) order ──
  const variables: ExtractedVariable[] = Array.from(byKey.values()).map((entry) => ({
    name: nameFromOrdinal(entry.semantic, entry.ordinal),
    value: entry.value,
    occurrences: entry.occurrences,
    sourceActions: entry.sourceActions,
    semantic: entry.semantic,
  }));

  return { variables, substitutions };
}
