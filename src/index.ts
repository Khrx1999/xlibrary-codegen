/**
 * xlibrary — public programmatic API barrel.
 *
 * ⚠ EXPERIMENTAL: The CLI is the stable surface. The programmatic API may
 *   change in any 0.x release. Pin an exact version (`xlibrary@0.1.6`) if
 *   you depend on the imports below.
 *
 * Three sub-entries are also exposed for finer-grained imports:
 *
 *   import { … } from 'xlibrary/codegen'    // generators + utilities
 *   import { … } from 'xlibrary/recorder'   // recorder orchestrator
 *   import { … } from 'xlibrary/types'      // public type declarations
 *
 * The root entry (`xlibrary`) re-exports the high-level surface so most users
 * never need to know about the sub-entries.
 */

// ── High-level entry points ───────────────────────────────────────────────
export { runRecorder } from './recorder/runner.js';
export { createReplayController } from './replay/replay-engine.js';

// ── Code generators ───────────────────────────────────────────────────────
export { RobotFrameworkLanguageGenerator } from './codegen/robotframework.js';
export { SeleniumLibraryLanguageGenerator } from './codegen/selenium.js';

// ── Codegen utilities (useful when building custom emitters) ──────────────
export { translateSelector, escapeRobotValue } from './codegen/locator-translator.js';
export { ACTION_TO_KEYWORD, NO_BL_EQUIVALENT } from './codegen/keywords-map.js';
export {
  decodeModifiers,
  toSeleniumModifier,
  formatKeyWithModifiers,
} from './codegen/keyboard-modifiers.js';

// ── Public types ──────────────────────────────────────────────────────────
export type {
  Action,
  ActionInContext,
  ActionName,
  RobotCodegenOptions,
  LanguageGeneratorOptions,
  LanguageGenerator,
  Signal,
  FrameDescription,
} from './types.js';
export type { ReplayController, ReplayState, ReplayStatus } from './replay/replay-engine.js';
export type { ModifierName } from './codegen/keyboard-modifiers.js';
