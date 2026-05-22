/**
 * Public surface of the Test Data Wizard detection engine.
 *
 * Consumers (Tasks #13 / #14) import from here rather than
 * referencing the internal detector module directly.
 */

export type { ExtractedVariable, DetectionResult, VariableSemantic } from './detector.js';

export { detectVariables } from './detector.js';
