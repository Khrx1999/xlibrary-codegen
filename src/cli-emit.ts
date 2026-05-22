/**
 * cli-emit.ts
 *
 * Action handler for `xlibrary emit <actions.jsonl> -l <target> -o <output>`.
 *
 * Reads an xlibrary JSONL artifact, instantiates the appropriate emitter,
 * generates the output file.
 *
 * Supported targets in v0.2: robot | selenium
 * Post-v0.2: ts | python — fail with a clear message pointing the user to
 * `-l ts` or `-l python` in `xlibrary codegen` instead.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArtifactContent } from './recorder/jsonl-artifact.js';
import { parseJsonlContent, jsonlEntryToStepLines } from './recorder/jsonl-bridge.js';
import type { ActionGenerator } from './recorder/jsonl-bridge.js';
import { RobotFrameworkLanguageGenerator } from './codegen/robotframework.js';
import { SeleniumLibraryLanguageGenerator } from './codegen/selenium.js';
import type { LanguageGeneratorOptions } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EmitOptions {
  /** Path to the `.jsonl` artifact file. */
  actionsFile: string;
  /** Emission target: robot | selenium | ts | python */
  lang: string;
  /** Destination file path. */
  output: string;
  /** Override test-case name (default: from JSONL header). */
  testName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supported / unsupported target check
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_TARGETS = ['robot', 'selenium'] as const;
type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

function isSupportedTarget(lang: string): lang is SupportedTarget {
  return (SUPPORTED_TARGETS as readonly string[]).includes(lang);
}

function assertNotPostV2(lang: string): void {
  if (lang === 'ts' || lang === 'typescript' || lang === 'javascript') {
    throw new Error(
      `emit for ts/python is post-v0.2; record directly with -l ts/python via xlibrary codegen`,
    );
  }
  if (lang === 'python' || lang === 'python-pytest') {
    throw new Error(
      `emit for ts/python is post-v0.2; record directly with -l ts/python via xlibrary codegen`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main emit handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a `.jsonl` artifact, instantiate the right generator, write the output file.
 *
 * Throws on any error (the CLI wrapper in cli.ts catches and formats).
 */
export async function runEmit(options: EmitOptions): Promise<void> {
  const { actionsFile, lang, output } = options;

  // ── 1. Validate target ─────────────────────────────────────────────────────
  assertNotPostV2(lang); // throws early for ts/python with friendly message

  if (!isSupportedTarget(lang)) {
    throw new Error(
      `Unknown target "${lang}". Supported targets in v0.2: robot, selenium.\n` +
        `Post-v0.2 targets (ts, python) are not yet available via xlibrary emit.`,
    );
  }

  // ── 2. Read artifact ───────────────────────────────────────────────────────
  let content: string;
  try {
    content = await readFile(actionsFile, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `cli-emit: actions file not found — path: ${actionsFile}\n` +
          `Run \`xlibrary codegen ... --save-actions\` to create one.`,
      );
    }
    throw new Error(
      `cli-emit: could not read ${actionsFile} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── 3. Parse artifact header + action lines ────────────────────────────────
  const { header, actionLines } = parseArtifactContent(content);

  // Resolve test name: CLI flag > JSONL header > default
  const testName = options.testName ?? header['test-name'] ?? 'Recorded Flow';

  // ── 4. Instantiate the generator ───────────────────────────────────────────
  const generator: ActionGenerator &
    Pick<RobotFrameworkLanguageGenerator, 'generateHeader' | 'generateFooter'> =
    lang === 'selenium'
      ? new SeleniumLibraryLanguageGenerator(testName)
      : new RobotFrameworkLanguageGenerator(testName);

  // ── 5. Re-generate output ──────────────────────────────────────────────────
  const generatorOptions: LanguageGeneratorOptions = {
    browserName: header.browser,
    launchOptions: {},
    contextOptions: {},
  };

  // Reconstruct the lines by parsing the action entries through the generator.
  // We build a synthetic JSONL content string (without header line) so we can
  // reuse parseJsonlContent from jsonl-bridge — it skips line 0 and iterates
  // from line 1.  We prepend a dummy line 0 so the indices align.
  const syntheticContent = '__header__\n' + actionLines.join('\n');
  const entries = parseJsonlContent(syntheticContent);

  const steps: string[] = [];
  for (const entry of entries) {
    for (const line of jsonlEntryToStepLines(entry, generator)) {
      steps.push(line);
    }
  }

  const robotContent =
    [generator.generateHeader(generatorOptions), ...steps, generator.generateFooter()].join('\n') +
    '\n';

  // ── 6. Write output ────────────────────────────────────────────────────────
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, robotContent, 'utf8');

  console.log(`\nxlibrary emit: wrote ${lang} output to ${output}`);
  console.log(
    `  Source : ${actionsFile} (recorded ${header['recorded-at']}, browser: ${header.browser})`,
  );
  console.log(`  Test   : ${testName}`);
  console.log(`  Steps  : ${steps.length}`);
}
