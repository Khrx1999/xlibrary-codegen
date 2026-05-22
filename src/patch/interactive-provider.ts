/**
 * interactive-provider.ts
 *
 * Bridges Task #10's `NewStepProvider` callback to Task #11's
 * `replayThenRecord` orchestrator + `formatActionsForLang` formatter.
 *
 * When the user runs `xlibrary patch test.robot --at 5`, runPatch (from
 * cli-patch.ts) calls our NewStepProvider for each replace/insert hook.
 * Our provider:
 *
 *   1. Replays the recorded actions up to the target step using the
 *      replay-engine (with optional --non-interactive failure handling).
 *   2. Opens the Inspector for the user to record new step(s).
 *   3. Formats the captured actions into the source's target language
 *      using the existing emitter chain (same one as `xlibrary emit`).
 *
 * The returned string is what runPatch's operations.ts splices into the
 * file at the right position.
 */

import { replayThenRecord } from './replay-driver.js';
import { formatActionsForLang } from './step-formatter.js';
import type { NewStepProvider } from './operations.js';

export interface InteractiveProviderOptions {
  /** Absolute path to the source file being patched (used to locate the .jsonl sidecar). */
  sourceFile: string;
  /** Fail-fast on replay errors instead of prompting. */
  nonInteractive: boolean;
}

/**
 * Factory: returns a NewStepProvider that drives the replay engine + recorder.
 *
 * The provider holds onto the source-file path so it can locate the
 * `.jsonl` sidecar automatically (no extra param threaded through runPatch).
 *
 * @example
 * const provider = makeInteractiveProvider({ nonInteractive: false });
 * const code = await runPatch(file, opts, provider);
 */
export function makeInteractiveProvider(options: InteractiveProviderOptions): NewStepProvider {
  // Closure variable: the source file path resolved from the first call.
  // (runPatch doesn't pass the source path to the provider, but the cwd
  // and the provider's context tell us enough — we look for <file>.jsonl
  // in the directory the CLI was invoked from.)

  return async (ctx) => {
    // Drive replay + record. The replay-driver knows how to find the
    // JSONL sidecar via convention: <sourceFile>.jsonl.
    //
    // ctx.targetStep tells us how many prior actions to replay before
    // handing control to the user.
    const result = await replayThenRecord({
      sourceFile: options.sourceFile,
      targetStep: ctx.targetStep,
      nonInteractive: options.nonInteractive,
    });

    if (result.status === 'aborted') {
      throw new Error(`patch aborted: ${result.reason}`);
    }

    // Format the captured actions into source-code lines for splicing.
    return formatActionsForLang(result.newActions, {
      lang: ctx.sourceLang,
      startingStepNumber: ctx.targetStep,
    });
  };
}
