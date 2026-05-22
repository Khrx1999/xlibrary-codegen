/**
 * Selenium `.robot` variable emitter.
 *
 * SeleniumLibrary and Browser Library both produce Robot Framework `.robot`
 * files with identical syntax.  The only differences are the keyword names
 * and the library import line — neither of which affects the `*** Variables ***`
 * section format or the inline variable references.
 *
 * This emitter is therefore a thin delegation wrapper around `robotEmitter`.
 * It is exported as a separate object so `getEmitterForLang('selenium')`
 * returns a distinct instance (future divergence is possible without a
 * breaking API change) and so that test suites can target it independently.
 */

import type { DetectionResult } from '../detector.js';
import type { VariableEmitter } from '../extract-orchestrator.js';
import { robotEmitter } from './robot.js';

/**
 * SeleniumLibrary `VariableEmitter` implementation.
 *
 * Delegates entirely to `robotEmitter` — the `*** Variables ***` section
 * format is identical between Browser Library and SeleniumLibrary files.
 */
export const seleniumEmitter: VariableEmitter = {
  applyExtraction(sourceContent: string, result: DetectionResult): string {
    return robotEmitter.applyExtraction(sourceContent, result);
  },
};
