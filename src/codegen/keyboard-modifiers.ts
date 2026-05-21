/**
 * Keyboard-modifier decoding.
 *
 * Playwright's recorder stores modifier keys as a bitmask on every action that
 * accepts them (click, press, …). This module owns:
 *
 *   - The canonical decode `bits → ModifierName[]` (Browser Library / Playwright
 *     API form: 'Alt', 'Control', 'Meta', 'Shift').
 *   - Library-specific dialect transforms (currently only SeleniumLibrary
 *     which spells modifiers `ALT`, `CTRL`, `META`, `SHIFT`).
 *   - A small `formatKeyWithModifiers` helper used when emitting `Press Keys`
 *     style "Mod1+Mod2+Key" strings.
 *
 * Bitmask values (from `vendor/playwright/packages/recorder/src/actions.d.ts`):
 *   Alt = 1, Control = 2, Meta = 4, Shift = 8.
 */

/** Canonical modifier name used by Playwright and Browser Library. */
export type ModifierName = 'Alt' | 'Control' | 'Meta' | 'Shift';

/**
 * Decode the Playwright modifier bitmask to canonical names.
 * Returned order is stable: Alt, Control, Meta, Shift.
 */
export function decodeModifiers(bits: number): ModifierName[] {
  const out: ModifierName[] = [];
  if (bits & 1) out.push('Alt');
  if (bits & 2) out.push('Control');
  if (bits & 4) out.push('Meta');
  if (bits & 8) out.push('Shift');
  return out;
}

/**
 * Translate a canonical modifier name to the SeleniumLibrary form.
 *
 *   Alt     → ALT
 *   Control → CTRL    (Selenium uses CTRL, not Control)
 *   Meta    → META
 *   Shift   → SHIFT
 */
export function toSeleniumModifier(m: ModifierName): string {
  return m === 'Control' ? 'CTRL' : m.toUpperCase();
}

/**
 * Build a `Mod1+Mod2+key` string for keyboard-shortcut keywords.
 *
 * The optional `transformer` lets the caller switch dialect. With no
 * transformer the canonical Browser Library form is produced.
 *
 *   formatKeyWithModifiers('a', 2)                       → 'Control+a'
 *   formatKeyWithModifiers('a', 2, toSeleniumModifier)   → 'CTRL+a'
 *   formatKeyWithModifiers('Enter', 0)                   → 'Enter'
 */
export function formatKeyWithModifiers(
  key: string,
  bits: number,
  transformer?: (m: ModifierName) => string,
): string {
  const mods = decodeModifiers(bits).map(transformer ?? ((m) => m));
  return mods.length > 0 ? `${mods.join('+')}+${key}` : key;
}
