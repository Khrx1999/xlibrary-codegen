/**
 * src/patch/index.ts — public barrel for the patch module.
 *
 * Task #9: scaffolds the `xlibrary patch` CLI subcommand.
 * Task #10: fills in the actual edit operations.
 * Task #11: wires the replay engine.
 */

export type { ParsedStep, StepIndex, FuzzyMatch } from './step-parser.js';
export { parseSteps, findStepsByContent } from './step-parser.js';

export type { NewStepProvider } from './operations.js';
export type { LangTarget } from '../types.js';
export {
  renumberSteps,
  replaceStep,
  replaceRange,
  insertAfter,
  insertBefore,
  deleteStep,
  deleteRange,
  moveStep,
  parseRangeSpec,
  parseMoveSpec,
  stubNewStepProvider,
} from './operations.js';
