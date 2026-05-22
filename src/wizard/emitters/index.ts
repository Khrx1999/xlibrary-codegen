/**
 * Variable emitter factory.
 *
 * `getEmitterForLang(lang)` returns the concrete `VariableEmitter`
 * implementation for the requested target language. Used by the extract
 * orchestrator (Task #13) to apply detected variables to a source file.
 */

import type { LangTarget } from '../../types.js';
import type { VariableEmitter } from '../extract-orchestrator.js';
import { robotEmitter } from './robot.js';
import { seleniumEmitter } from './selenium.js';
import { typescriptEmitter } from './typescript.js';
import { pythonEmitter } from './python.js';

// Re-export concrete emitters for callers that want direct access.
export { robotEmitter } from './robot.js';
export { seleniumEmitter } from './selenium.js';
export { typescriptEmitter } from './typescript.js';
export { pythonEmitter } from './python.js';

/**
 * Return the `VariableEmitter` for the given `LangTarget`.
 *
 * The returned object is a stateless singleton — safe to call
 * `applyExtraction` multiple times without side-effects beyond stderr warns.
 *
 * Exhaustiveness is checked by TypeScript at compile time.
 */
export function getEmitterForLang(lang: LangTarget): VariableEmitter {
  switch (lang) {
    case 'robot':
      return robotEmitter;
    case 'selenium':
      return seleniumEmitter;
    case 'ts':
      return typescriptEmitter;
    case 'python':
      return pythonEmitter;
  }
}
