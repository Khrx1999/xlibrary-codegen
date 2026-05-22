#!/usr/bin/env node
/**
 * xlibrary CLI entry point.
 *
 * Usage:
 *   npx xlibrary codegen [url] [options]
 *
 * Subcommands:
 *   codegen   Record browser interactions and emit a Robot Framework `.robot` file.
 *
 * Examples:
 *   npx xlibrary codegen https://example.com -o login.robot
 *   npx xlibrary codegen https://example.com --test-name "Login Flow" --open
 *   npx xlibrary codegen --browser firefox -o tests/firefox.robot
 *
 * Why subcommand structure: this leaves room for future operations
 * (e.g. `xlibrary install`, `xlibrary inspect`) without breaking callers.
 */

// Side-effect import — installs the playwright-core bundle patcher BEFORE
// any code path can reach `import 'playwright-core'`. See bundle-patcher.ts.
import './recorder/bundle-patcher.js';

import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runRecorder } from './recorder/runner.js';
import { runEmit } from './cli-emit.js';
import { runExtract } from './cli-extract.js';
import { runPatch } from './cli-patch.js';
import type { PatchOptions } from './cli-patch.js';
import type { RobotCodegenOptions } from './types.js';
import { resolveLang } from './codegen/lang-inference.js';

const requireFromHere = createRequire(import.meta.url);

/**
 * Locate the `cli.js` of the EXACT `playwright-core` that xlibrary is using.
 *
 * Why this matters: playwright-core ships a different chromium build number
 * with each minor version (e.g. 1.49 → chromium-1223, 1.60 → chromium-1xxx).
 * If we shell out to `npx playwright install`, npm resolves the LATEST
 * `playwright` package which downloads the chromium build paired with THAT
 * version — not the one our bundled `playwright-core` looks for at launch.
 * Result: download finishes, `codegen` still says "Executable doesn't exist".
 *
 * Resolving via the bundled package guarantees install + launch agree.
 *
 * Note: we can't use `require.resolve('playwright-core/cli.js')` directly
 * because playwright-core's package.json doesn't list `./cli.js` under
 * `"exports"`. We resolve its `package.json` instead (which is exported on
 * essentially every npm package) and join `cli.js` next to it.
 */
function resolvePlaywrightCoreCli(): string {
  const pkgJsonPath = requireFromHere.resolve('playwright-core/package.json');
  return join(dirname(pkgJsonPath), 'cli.js');
}

/**
 * Check whether the current Node supports the `--use-system-ca` flag.
 *
 * Background: corporate networks (banks, large enterprises) commonly run an
 * SSL inspection proxy that re-signs HTTPS traffic with an internal CA. The
 * CA is in the OS keychain (browsers trust it) but NOT in Node's bundled CA
 * list (Node's https module compiles its own CA bundle at build time and
 * does not consult the OS by default).
 *
 * `--use-system-ca` (Node 22.10+) tells the TLS layer to ALSO consult the OS
 * trust store (macOS Keychain / Windows Cert Store / Linux ca-certificates),
 * which is the cleanest fix for the corp-MITM case.
 */
function supportsUseSystemCa(): boolean {
  const parts = process.versions.node.split('.').map((p) => Number(p));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  return major > 22 || (major === 22 && minor >= 10);
}

/**
 * Heuristic check for a cert-validation failure in a child process's stderr.
 * Matches both the Node error code and the common human-readable phrasing.
 */
function looksLikeCertFailure(stderr: string): boolean {
  return /UNABLE_TO_GET_ISSUER_CERT_LOCALLY|unable to get local issuer/i.test(stderr);
}

const program = new Command();

program
  .name('xlibrary')
  .description(
    'Robot Framework + Browser Library codegen — record browser interactions and emit a .robot test file.',
  )
  // Read version dynamically from package.json so we don't drift on bumps.
  .version((requireFromHere('../package.json') as { version: string }).version);

// ─────────────────────────────────────────────────────────────────────────────
// codegen — the main (and currently only) subcommand
// ─────────────────────────────────────────────────────────────────────────────
program
  .command('codegen [url]')
  .description('Open a browser, record your interactions, and write the corresponding .robot file.')
  .option('-o, --output <file>', 'Output file path (default: recorded.robot)')
  .option(
    '-l, --lang <target>',
    'Emitter target: robot | selenium | ts | python. ' +
      'When omitted, inferred from the -o file extension ' +
      '(.robot→robot, .selenium.robot→selenium, .spec.ts/.ts→ts, .py→python). ' +
      'Default: robot.',
  )
  .option('-b, --browser <name>', 'Browser to use: chromium | firefox | webkit', 'chromium')
  .option('--test-name <name>', 'Name of the generated test case', 'Recorded Flow')
  .option('--quiet', 'Suppress the live keyword preview printed during recording')
  .option(
    '--open',
    'Open the output .robot file in VS Code (or OS default editor) after recording ends',
    false,
  )
  .option('--no-viewer', 'Disable the live Robot Framework viewer window (enabled by default)')
  .option(
    '--open-viewer',
    'Auto-open the live viewer window in your browser at startup. By default ' +
      'the Inspector shows an "📊 Open Live Preview" button so you can open it only when needed.',
    false,
  )
  .option(
    '--save-actions [file]',
    'Save the raw action stream as a JSONL artifact. ' +
      'If no file is given, writes to <output>.jsonl next to the output file.',
  )
  .option(
    '--extract-data',
    'After recording ends, run the Test Data Wizard: detect extractable variables, ' +
      'show a diff preview, and prompt to apply. Use --quiet to skip the prompt and auto-apply.',
    false,
  )
  .action(async (url: string | undefined, opts: Record<string, unknown>) => {
    const rawOutput = opts['output'] as string | undefined;
    const outputPath = rawOutput ?? 'recorded.robot';

    const lang = resolveLang(opts['lang'] as string | undefined, rawOutput);

    // Resolve --save-actions: commander gives us `true` (bare flag), a string
    // (explicit path), or `undefined` (flag not passed).
    let saveActions: RobotCodegenOptions['saveActions'];
    const rawSaveActions = opts['saveActions'];
    if (rawSaveActions === true || rawSaveActions === '') {
      saveActions = true; // bare --save-actions
    } else if (typeof rawSaveActions === 'string' && rawSaveActions.length > 0) {
      saveActions = rawSaveActions; // --save-actions path/to/file.jsonl
    } // else undefined — not passed

    const options: RobotCodegenOptions = {
      url,
      output: outputPath,
      browser: (opts['browser'] as RobotCodegenOptions['browser']) ?? 'chromium',
      headed: true, // recording is always headed
      testName: opts['testName'] as string | undefined,
      lang,
      quiet: opts['quiet'] === true,
      open: opts['open'] === true,
      viewer: opts['viewer'] !== false, // true unless --no-viewer was passed
      openViewer: opts['openViewer'] === true,
      saveActions,
      extractData: opts['extractData'] === true,
    };

    // Fail-fast: --save-actions + -l ts/python writes an empty artifact today
    // because xlibrary doesn't own those emitters (Playwright handles them).
    // Reject explicitly so users don't ship a useless .jsonl.
    if (saveActions !== undefined && (lang === 'ts' || lang === 'python')) {
      console.error(`xlibrary codegen: --save-actions is not yet supported for -l ${lang}.`);
      console.error("  Playwright owns the ts/python emitters, so xlibrary can't capture");
      console.error('  the action stream for re-emission. Record with -l robot');
      console.error('  to get a sidecar JSONL, then `xlibrary emit -l ts` (post-v0.2).');
      process.exit(1);
    }

    try {
      await runRecorder(options);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;

      // ── Friendly handling for the most common first-run failure ─────────────
      // Playwright's launch() throws with "Executable doesn't exist at <path>"
      // when the user hasn't downloaded the browser binary yet. Recognise that
      // and point at `xlibrary install` (which wraps `npx playwright install`).
      if (message.includes("Executable doesn't exist")) {
        console.error('\n❌  Browser binary not installed.');
        console.error('\n   Run this once to download it:');
        console.error(`     npx xlibrary install ${options.browser ?? 'chromium'}\n`);
        process.exit(1);
      }

      console.error(`\n❌  xlibrary codegen error: ${message}`);
      if (process.env['NODE_DEBUG']?.includes('xlibrary') && stack) {
        console.error(stack);
      } else {
        console.error('   Run with NODE_DEBUG=xlibrary for the full stack trace.');
      }
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// install — download Playwright browser binaries
//
// Wraps `npx playwright install <browsers...>` so users stay inside our CLI
// instead of bouncing to a sibling tool they may not know about. Default is
// chromium (matches our default --browser flag in `codegen`).
// ─────────────────────────────────────────────────────────────────────────────
program
  .command('install [browsers...]')
  .description(
    'Download Playwright browser binaries (default: chromium). ' +
      'Examples: `xlibrary install` / `xlibrary install firefox webkit` / `xlibrary install chromium firefox`',
  )
  .option('--with-deps', 'Also install OS-level dependencies (Linux only)')
  .action((browsers: string[], opts: { withDeps?: boolean }) => {
    const targets = browsers.length > 0 ? browsers : ['chromium'];

    // Locate the bundled playwright-core CLI — guarantees install version
    // matches the launch version (see `resolvePlaywrightCoreCli` for why).
    let playwrightCli: string;
    try {
      playwrightCli = resolvePlaywrightCoreCli();
    } catch (err) {
      console.error(
        `\n❌  Could not locate playwright-core inside xlibrary — ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error('   Re-install xlibrary and try again.');
      process.exit(1);
      return;
    }

    const args = ['install', ...(opts.withDeps ? ['--with-deps'] : []), ...targets];

    // ── Corporate-network friendly defaults ─────────────────────────────────
    // Pre-pend --use-system-ca to NODE_OPTIONS when Node supports it (≥22.10).
    // This makes Node trust certs from the OS keychain on top of its bundled
    // CA list — solves the most common corp SSL-inspection failure without
    // any user action. Older Node ignores this (we skip the flag entirely so
    // we don't crash with "unknown flag").
    const env = { ...process.env };
    let usingSystemCa = false;
    if (supportsUseSystemCa()) {
      const existing = env['NODE_OPTIONS'] ?? '';
      env['NODE_OPTIONS'] = existing ? `${existing} --use-system-ca` : '--use-system-ca';
      usingSystemCa = true;
    }

    console.log(`▶  node ${playwrightCli} ${args.join(' ')}`);
    if (usingSystemCa) {
      console.log('   (with --use-system-ca for OS trust store)\n');
    } else {
      console.log('');
    }

    // ── Tee stderr so we can both stream it AND detect cert errors ──────────
    // We need stdio:'inherit' UX (live progress bar, colors) AND a copy of
    // stderr to inspect on failure. Pipe stderr to us, then forward.
    let stderrBuffer = '';
    const child = spawn(process.execPath, [playwrightCli, ...args], {
      stdio: ['inherit', 'inherit', 'pipe'],
      env,
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      process.stderr.write(text);
      // Cap buffer at 64 KB — cert errors appear within the first few KB.
      if (stderrBuffer.length < 65_536) stderrBuffer += text;
    });

    child.on('error', (err) => {
      console.error(`\n❌  Failed to spawn playwright-core install — ${err.message}`);
      process.exit(1);
    });
    child.on('exit', (code) => {
      if (code !== 0 && looksLikeCertFailure(stderrBuffer)) {
        const bar = '━'.repeat(64);
        console.error(`\n${bar}`);
        console.error('🔐  TLS certificate validation failed.');
        console.error('');
        console.error('   This almost always means a corporate SSL-inspection proxy');
        console.error('   (Zscaler / Cisco / Forcepoint / Symantec / Palo Alto …) is');
        console.error('   re-signing HTTPS traffic with an internal CA that Node does');
        console.error('   not trust by default.');
        console.error('');
        console.error('   Fixes in order — stop at the first one that works:');
        console.error('');
        if (!supportsUseSystemCa()) {
          console.error('     1) Upgrade to Node ≥ 22.10 and re-run xlibrary install');
          console.error("        (your Node version doesn't support --use-system-ca yet)");
          console.error('');
        }
        console.error("     • Reuse npm's configured CA file:");
        console.error('         NODE_EXTRA_CA_CERTS="$(npm config get cafile)" \\');
        console.error('           npx xlibrary install');
        console.error('');
        console.error('     • Or extract the corporate CA from your macOS keychain:');
        console.error('         security find-certificate -a -p \\');
        console.error('           /Library/Keychains/System.keychain > /tmp/corp-ca.pem');
        console.error('         NODE_EXTRA_CA_CERTS=/tmp/corp-ca.pem \\');
        console.error('           npx xlibrary install');
        console.error('');
        console.error('     • Ask your IT team for the corporate CA bundle (.pem file).');
        console.error('');
        console.error('   ⚠️  NEVER set NODE_TLS_REJECT_UNAUTHORIZED=0 outside of');
        console.error('       one-off diagnostics — it disables ALL cert validation');
        console.error('       and exposes you to real MITM attacks.');
        console.error(`${bar}\n`);
      }
      process.exit(code ?? 0);
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// emit — re-render a JSONL artifact into a target language
//
// Usage:
//   xlibrary emit <actions.jsonl> -l robot -o output.robot
//   xlibrary emit <actions.jsonl> -l selenium -o output.selenium.robot
//
// Reads the header from the JSONL artifact to default --test-name.
// Fails with a clear message for ts/python (post-v0.2).
// ─────────────────────────────────────────────────────────────────────────────
program
  .command('emit <actions.jsonl>')
  .description(
    'Re-render a recorded JSONL action artifact into a target language. ' +
      'Supported targets in v0.2: robot, selenium.',
  )
  .requiredOption('-l, --lang <target>', 'Output target: robot | selenium (ts/python post-v0.2)')
  .requiredOption('-o, --output <file>', 'Output file path')
  .option('--test-name <name>', 'Override the test-case name (default: from JSONL header)')
  .action(async (actionsFile: string, opts: Record<string, unknown>) => {
    try {
      await runEmit({
        actionsFile,
        lang: opts['lang'] as string,
        output: opts['output'] as string,
        testName: opts['testName'] as string | undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nxlibrary emit error: ${message}`);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// extract — Test Data Wizard standalone subcommand
//
// Usage:
//   xlibrary extract login.robot
//   xlibrary extract login.robot -o login-extracted.robot
//   xlibrary extract login.robot --yes
//   xlibrary extract login.robot --actions login.robot.jsonl
//
// Language is inferred from the source file extension (.robot → robot, etc.).
// A sidecar .jsonl is required (same path + .jsonl suffix, or --actions <path>).
// ─────────────────────────────────────────────────────────────────────────────
program
  .command('extract <file>')
  .description(
    'Run the Test Data Wizard on an existing file — detect literal values, ' +
      'show a diff preview, and extract them into variables. ' +
      'Requires a sidecar .jsonl (from --save-actions) or --actions <jsonl-path>.',
  )
  .option(
    '-o, --output <file>',
    'Write to this path instead of editing the source file in-place (no .bak written for separate output)',
  )
  .option('--yes', 'Skip the confirmation prompt and apply immediately', false)
  .option(
    '-l, --lang <target>',
    'Override language inference from file extension. ' +
      'Must be one of: robot | selenium | ts | python.',
  )
  .option(
    '--actions <jsonl-path>',
    'Override sidecar .jsonl lookup. Default: <file>.jsonl next to the source file.',
  )
  .action(async (file: string, opts: Record<string, unknown>) => {
    try {
      await runExtract({
        file,
        output: opts['output'] as string | undefined,
        yes: opts['yes'] === true,
        lang: opts['lang'] as string | undefined,
        actionsFile: opts['actions'] as string | undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nxlibrary extract error: ${message}`);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// patch — Re-record one or more steps in an existing generated file
//
// Usage:
//   xlibrary patch login.robot --at 5
//   xlibrary patch login.robot --at "Click Login"
//   xlibrary patch login.robot --insert-after 3
//   xlibrary patch login.robot --delete 5-7
// ─────────────────────────────────────────────────────────────────────────────
program
  .command('patch <file>')
  .description(
    'Re-record one or more steps in an existing generated file. ' +
      'Requires xlib:step markers (generated by xlibrary >= 0.2.0).',
  )
  .option('--at <id>', 'Replace step — id is a step number or fuzzy keyword content')
  .option('--insert-after <id>', 'Record new steps to insert AFTER step <id>')
  .option('--insert-before <id>', 'Record new steps to insert BEFORE step <id>')
  .option('--delete <id>', 'Delete step(s) — id is a number or a range like 3-7')
  .option('--move <spec>', 'Move step(s) — spec is "<from> to <to>" e.g. "3 to 7"')
  .option('--range <range>', 'Replace a range of steps — use with --at, e.g. 3-7')
  .option('--non-interactive', 'Fail-fast instead of pausing on replay failure', false)
  .option('--no-backup', 'Skip writing the .bak backup file')
  .action(async (file: string, opts: Record<string, unknown>) => {
    const patchOpts: PatchOptions = {
      at: opts['at'] as string | undefined,
      insertAfter: opts['insertAfter'] as string | undefined,
      insertBefore: opts['insertBefore'] as string | undefined,
      delete: opts['delete'] as string | undefined,
      move: opts['move'] as string | undefined,
      range: opts['range'] as string | undefined,
      nonInteractive: opts['nonInteractive'] === true,
      backup: opts['backup'] !== false,
    };

    // Lazy-load the real recorder-driven NewStepProvider only when needed
    // (avoids pulling playwright-core into the hot path for delete/move).
    const { makeInteractiveProvider } = await import('./patch/interactive-provider.js');
    const pathMod = await import('node:path');
    const provider = makeInteractiveProvider({
      sourceFile: pathMod.resolve(file),
      nonInteractive: patchOpts.nonInteractive ?? false,
    });

    const code = await runPatch(file, patchOpts, provider);
    if (code !== 0) {
      process.exit(code);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Help-when-empty: invoking `npx xlibrary` with no subcommand prints help
// instead of silently doing nothing. Matches Playwright's CLI behaviour.
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`xlibrary: ${message}`);
  process.exit(1);
});
