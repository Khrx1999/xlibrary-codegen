/**
 * Robot Framework + Browser Library variable emitter.
 *
 * Implements `VariableEmitter` for `.robot` files that use the Browser Library.
 * Selenium `.robot` files are identical in Robot Framework syntax — see
 * `selenium.ts` which delegates to this emitter.
 *
 * Variable section behaviour
 * ──────────────────────────
 * Robot Framework `.robot` files can have an optional `*** Variables ***`
 * section.  The spec (§4.4) requires:
 *   - If the section does NOT exist: insert one above `*** Test Cases ***`.
 *   - If the section DOES exist: extend it with new variables (preserve existing).
 *
 * Variable format
 * ───────────────
 * Each variable occupies one line:
 *   ${VALID_EMAIL}    qa@example.com
 *
 * 4-space separator between the variable name and its value (matches the
 * Robot Framework community convention and this project's ARG_SEP constant).
 *
 * Reference substitution
 * ──────────────────────
 * Every literal value listed in `result.substitutions` is replaced inline
 * with `${VAR_NAME}`, e.g.:
 *   Fill Text    role=textbox[name="Email"]    qa@example.com
 *   →
 *   Fill Text    role=textbox[name="Email"]    ${VALID_EMAIL}
 *
 * Collision policy
 * ────────────────
 * If a variable with the same name already appears in the file (with any
 * value), we skip inserting it and warn on stderr.  The existing definition
 * is authoritative.
 */

import type { DetectionResult, ExtractedVariable } from '../detector.js';
import type { VariableEmitter } from '../extract-orchestrator.js';

/** 4-space separator — matches Robot Framework community convention. */
const SEP = '    ';

// ── Section header regexes ──────────────────────────────────────────────────

/** Matches `*** Variables ***` (with optional leading/trailing spaces). */
const RE_VARIABLES_SECTION = /^\*{3}\s*Variables\s*\*{3}\s*$/im;

/** Matches `*** Test Cases ***` (with optional leading/trailing spaces). */
const RE_TEST_CASES_SECTION = /^\*{3}\s*Test Cases\s*\*{3}\s*$/im;

/**
 * Matches a Robot Framework variable definition line, capturing the variable
 * name (without sigils) and its current value.
 *
 * Group 1: variable name without `${` / `}`
 * Group 2: current value (trimmed)
 */
export const RE_VARIABLE_LINE = /^\$\{([A-Z0-9_]+)\}\s{2,}(.*)$/m;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a Robot Framework variable definition line.
 *   `${VALID_EMAIL}    qa@example.com`
 */
function formatVarLine(varName: string, value: string): string {
  return `\${${varName}}${SEP}${value}`;
}

/**
 * Return the set of variable names already defined in `content`.
 * Scans the entire file (not just the variables section) to catch any
 * variable assignments in test bodies as well.
 */
export function existingVarNames(content: string): Set<string> {
  const found = new Set<string>();
  const re = /^\$\{([A-Z0-9_]+)\}\s{2,}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    found.add(m[1]);
  }
  return found;
}

/**
 * Determine which variables from `result.variables` are safe to insert
 * (no collision with `alreadyDefined`) and warn about the ones that collide.
 */
export function resolveVars(
  variables: ExtractedVariable[],
  alreadyDefined: Set<string>,
): ExtractedVariable[] {
  return variables.filter((v) => {
    if (alreadyDefined.has(v.name)) {
      process.stderr.write(
        `[xlibrary wizard] WARNING: variable \${${v.name}} is already defined in the source file — skipping extraction of value "${v.value}".\n`,
      );
      return false;
    }
    return true;
  });
}

/**
 * Build the block of variable definition lines to insert.
 * Returns an empty string when the list is empty.
 */
export function buildVarBlock(vars: ExtractedVariable[]): string {
  return vars.map((v) => formatVarLine(v.name, v.value)).join('\n');
}

/**
 * Insert or extend the `*** Variables ***` section in a `.robot` file.
 *
 * Strategy:
 *   1. If `*** Variables ***` already exists, append new lines at the end of
 *      that section (before the next section header or EOF).
 *   2. Otherwise, insert a fresh `*** Variables ***` section immediately above
 *      `*** Test Cases ***`.
 *   3. If neither section exists (malformed file), append to the end.
 */
export function insertVariablesSection(content: string, vars: ExtractedVariable[]): string {
  if (vars.length === 0) return content;

  const varBlock = buildVarBlock(vars);

  const varsSectionMatch = RE_VARIABLES_SECTION.exec(content);

  if (varsSectionMatch !== null) {
    // Section exists — find its end (= next section header or EOF) and append.
    const sectionStart = varsSectionMatch.index + varsSectionMatch[0].length;
    const afterSection = content.slice(sectionStart);

    // Find the next `*** ... ***` header inside the remaining text.
    const nextSectionMatch = /^\*{3}\s*\w/m.exec(afterSection);
    if (nextSectionMatch !== null) {
      const insertPos = sectionStart + nextSectionMatch.index;
      return content.slice(0, insertPos) + varBlock + '\n' + content.slice(insertPos);
    }
    // No subsequent section — append at EOF.
    const trimmed = content.trimEnd();
    return trimmed + '\n' + varBlock + '\n';
  }

  // No `*** Variables ***` section — insert above `*** Test Cases ***`.
  const tcMatch = RE_TEST_CASES_SECTION.exec(content);
  if (tcMatch !== null) {
    const insertPos = tcMatch.index;
    const newSection = `*** Variables ***\n${varBlock}\n\n`;
    return content.slice(0, insertPos) + newSection + content.slice(insertPos);
  }

  // Fallback: append at EOF.
  const trimmed = content.trimEnd();
  return trimmed + '\n\n*** Variables ***\n' + varBlock + '\n';
}

/**
 * Replace every literal value in `content` with the corresponding Robot
 * Framework variable reference `${VAR_NAME}`.
 *
 * Uses split+join for safe exact-string replacement (avoids regex special-char
 * escaping issues with arbitrary literal values).
 *
 * Deduplication is inherent: once a literal is replaced with `${VAR_NAME}`,
 * subsequent passes on the same literal no longer find the original text.
 */
function applySubstitutions(
  content: string,
  substitutions: Map<number, { varName: string; oldValue: string }[]>,
  skippedVars: Set<string>,
): string {
  // Collect unique (oldValue → varRef) pairs, skipping collisions.
  const replacements = new Map<string, string>();

  for (const subs of substitutions.values()) {
    for (const sub of subs) {
      if (skippedVars.has(sub.varName)) continue;
      if (!replacements.has(sub.oldValue)) {
        replacements.set(sub.oldValue, `\${${sub.varName}}`);
      }
    }
  }

  let result = content;
  for (const [literal, varRef] of replacements) {
    result = result.split(literal).join(varRef);
  }
  return result;
}

// ── Public emitter ───────────────────────────────────────────────────────────

/**
 * Robot Framework + Browser Library `VariableEmitter` implementation.
 *
 * Stateless singleton — safe to call `applyExtraction` multiple times.
 */
export const robotEmitter: VariableEmitter = {
  applyExtraction(sourceContent: string, result: DetectionResult): string {
    // 1. Determine which variable names are already defined in the source.
    const alreadyDefined = existingVarNames(sourceContent);

    // 2. Filter out collisions (warn on stderr for each).
    const safeVars = resolveVars(result.variables, alreadyDefined);
    const skippedVars = new Set(
      result.variables.filter((v) => alreadyDefined.has(v.name)).map((v) => v.name),
    );

    // 3. Replace literal values with variable references inline FIRST.
    //    This must happen before we insert the `*** Variables ***` section so
    //    that the new variable definition lines themselves are not subject to
    //    substitution (which would turn `${VALID_EMAIL}    qa@example.com`
    //    into `${VALID_EMAIL}    ${VALID_EMAIL}`).
    const substituted = applySubstitutions(sourceContent, result.substitutions, skippedVars);

    // 4. Insert / extend `*** Variables ***` section in the already-substituted
    //    content.  The inserted lines contain only `${VAR}    literal-value`
    //    pairs which are immune to the substitution that already ran.
    return insertVariablesSection(substituted, safeVars);
  },
};
