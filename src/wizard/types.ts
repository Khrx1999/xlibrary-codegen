/**
 * Shared types for the Test Data Wizard.
 *
 * Canonical home is `./detector.ts` (Task #12). This barrel re-exports
 * them under the `./types` path that Task #14's emitters and tests
 * originally imported from. Both paths resolve to the same definitions.
 */

export type { VariableSemantic, ExtractedVariable, DetectionResult } from './detector.js';

export type { VariableEmitter } from './extract-orchestrator.js';
export type { LangTarget } from '../types.js';
