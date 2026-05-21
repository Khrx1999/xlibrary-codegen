/**
 * recorder/bundle-patcher.ts
 *
 * Option B (channel/module-load level): inject our RobotFrameworkLanguageGenerator
 * into Playwright's `languageSet()` registry without modifying vendor/playwright
 * or playwright-core on disk.
 *
 * Why this exists:
 *   `playwright-core` ships as a single bundled `coreBundle.js`. The internal
 *   `languageSet()` factory is a closure inside an `__esm({...})` module and is
 *   NOT reachable via property access or module re-require. The previous
 *   `tryPatchLanguageSet()` approach (require('playwright-core/lib/server/...'))
 *   fails for every bundled release.
 *
 * How it works:
 *   1. We hook Node's `Module.prototype._compile` BEFORE playwright-core is
 *      required. (This file must be imported before any `playwright-core`
 *      import in the dependency graph — see cli.ts.)
 *   2. When coreBundle.js compiles, we rewrite the body of `function
 *      languageSet()` to prepend any generator registered via
 *      `globalThis.__xlibrary_extraLanguageGenerators`.
 *   3. `registerLanguageGenerator(gen)` adds to that global list at runtime.
 *   4. The recorder then sees our generator as a real language. When
 *      `_enableRecorder({ language: 'robotframework' })` is called, the
 *      Inspector picks our generator as primary and displays `.robot` syntax.
 *
 * Safety / fallback:
 *   - The patch is idempotent (won't re-apply if marker found).
 *   - If the regex no longer matches (Playwright internal change), we log a
 *     warning via dlog and continue — runner.ts can fall back to JSONL mode.
 *   - We never modify the file on disk; the patch lives in V8's compiled
 *     module cache only.
 */

import Module from 'node:module';
import { debuglog } from 'node:util';

const dlog = debuglog('xlibrary');

// ---------------------------------------------------------------------------
// Global registry — populated by `registerLanguageGenerator()`, consumed by
// the injected snippet inside the patched `languageSet()`.
// ---------------------------------------------------------------------------

declare global {
  var __xlibrary_extraLanguageGenerators: unknown[] | undefined;

  var __xlibrary_bundlePatchInstalled: boolean | undefined;

  var __xlibrary_bundlePatchApplied: boolean | undefined;

  var __xlibrary_bundlePatchSucceeded: boolean | undefined;
  /**
   * HTML snippet to inject before `</body>` of the Inspector window's
   * index.html. Set by `setInspectorInjection(...)` and consumed by the
   * second bundle patch that wraps `route2.fulfill(...)`.
   */

  var __xlibrary_inspectorInjection: string | undefined;
  /** Set by the patched wrapper whenever it runs (any file extension). */

  var __xlibrary_inspectorPatchSucceeded: boolean | undefined;
  /** Set ONLY when the wrapper actually spliced the injection into an HTML body. */

  var __xlibrary_inspectorInjected: boolean | undefined;
  /** Source-rewrite flag for the output-file Target-follow patch (patch #3). */

  var __xlibrary_outputFollowsTargetSucceeded: boolean | undefined;
}

/**
 * Register a `LanguageGenerator`-compatible object so it shows up in the
 * Playwright recorder's language registry. Safe to call before or after the
 * patcher hooks in — generators registered before bundle load will be visible
 * to the first `languageSet()` call.
 */
export function registerLanguageGenerator(generator: unknown): void {
  if (!globalThis.__xlibrary_extraLanguageGenerators)
    globalThis.__xlibrary_extraLanguageGenerators = [];
  globalThis.__xlibrary_extraLanguageGenerators.push(generator);
}

/**
 * Whether the bundle was actually compiled through our patched code path.
 * Set by the patched `languageSet()` body itself the first time it runs,
 * so this stays `false` until the recorder asks for the language list.
 */
export function isBundlePatchApplied(): boolean {
  return globalThis.__xlibrary_bundlePatchApplied === true;
}

/**
 * Whether the regex successfully matched and rewrote `languageSet()` during
 * the most recent coreBundle.js compile. Becomes `true` synchronously when
 * `playwright-core` is first required — so this is safe to consult BEFORE
 * `_enableRecorder` is called to decide between direct vs JSONL mode.
 */
export function wasBundlePatchSuccessful(): boolean {
  return globalThis.__xlibrary_bundlePatchSucceeded === true;
}

/**
 * Set the HTML snippet injected before `</body>` of the Playwright Inspector
 * window's index.html. Used by runner.ts to drop in our "Open Live Preview"
 * button that points at the viewer-server URL.
 *
 * Passing `undefined` clears the injection.
 */
export function setInspectorInjection(html: string | undefined): void {
  globalThis.__xlibrary_inspectorInjection = html;
}

/**
 * Whether the patched wrapper code actually executed when the Inspector
 * served a file (any extension). False means either no Inspector started or
 * the regex patch missed.
 */
export function wasInspectorPatchSuccessful(): boolean {
  return globalThis.__xlibrary_inspectorPatchSucceeded === true;
}

/**
 * Whether the third patch (output file follows Target dropdown) was applied
 * during the bundle compile. When true, switching the Inspector's "Target:"
 * dropdown also rewrites the output `.robot` file in the new language. When
 * false (regex miss, upstream drift), the output file remains pinned to the
 * primary language passed to `_enableRecorder`.
 */
export function wasOutputFollowsTargetSuccessful(): boolean {
  return globalThis.__xlibrary_outputFollowsTargetSucceeded === true;
}

/**
 * Whether the injection ACTUALLY ran — i.e. the Inspector served at least
 * one HTML file AND our injection snippet was spliced before `</body>`.
 * This is the strongest "the button is on the user's screen" signal we have
 * without a CDP attach to the Inspector window.
 */
export function wasInspectorInjected(): boolean {
  return globalThis.__xlibrary_inspectorInjected === true;
}

// ---------------------------------------------------------------------------
// Marker the patched body writes into globalThis so we can detect application.
// The snippet below references it as a string literal (must match).
// ---------------------------------------------------------------------------
const APPLIED_FLAG = 'globalThis.__xlibrary_bundlePatchApplied=true';

// ---------------------------------------------------------------------------
// The injected snippet — runs at the top of the patched `languageSet()`.
// Pulls extras from the global registry. Wrapped in try/catch to never
// poison Playwright's own logic.
// ---------------------------------------------------------------------------
const INJECTED_SNIPPET =
  `const __xlibExtras=(()=>{try{${APPLIED_FLAG};` +
  `return globalThis.__xlibrary_extraLanguageGenerators||[]` +
  `}catch(_){return[]}})();`;

// ---------------------------------------------------------------------------
// Patch transformation
// ---------------------------------------------------------------------------

/**
 * Rewrite the `languageSet()` factory in coreBundle.js source to prepend our
 * registered generators.
 *
 * Target snippet (verified against playwright-core@1.60.0):
 *
 *     function languageSet() {
 *       return /* @__PURE__ * / new Set([
 *         new JavaScriptLanguageGenerator(
 *
 * We rewrite to:
 *
 *     function languageSet() {
 *       <INJECTED_SNIPPET>
 *       return /* @__PURE__ * / new Set([...__xlibExtras,
 *         new JavaScriptLanguageGenerator(
 *
 * The regex tolerates whitespace variation but anchors on the unique
 * `new Set([` + `new JavaScriptLanguageGenerator` pair to avoid false matches.
 */
function patchBundleSource(source: string): { patched: string; ok: boolean } {
  // Skip if already patched (idempotency for repeated requires)
  if (source.includes('__xlibExtras')) {
    return { patched: source, ok: true };
  }

  const re =
    /function languageSet\(\)\s*\{\s*return\s*\/\*\s*@__PURE__\s*\*\/\s*new Set\(\[\s*new JavaScriptLanguageGenerator/;

  if (!re.test(source)) {
    dlog('bundle-patcher: languageSet() pattern not found — likely a Playwright version drift');
    return { patched: source, ok: false };
  }

  const replaced = source.replace(
    re,
    `function languageSet() {\n  ${INJECTED_SNIPPET}\n  return /* @__PURE__ */ new Set([...__xlibExtras,\n    new JavaScriptLanguageGenerator`,
  );

  return { patched: replaced, ok: true };
}

// ---------------------------------------------------------------------------
// Second patch — Inspector HTML injection
// ---------------------------------------------------------------------------

/**
 * Body-rewriter we splice into the route interceptor that serves the
 * Inspector window's static files. Runs once per `<file>.html` request:
 *
 *   1. read `globalThis.__xlibrary_inspectorInjection`
 *   2. if set and the served file ends in `.html`, splice the snippet in
 *      before the closing `</body>` tag.
 *   3. otherwise, return the original buffer untouched.
 *
 * Wrapped in a try/catch so any failure falls through to vanilla behaviour
 * — the Inspector must keep working even if injection logic blows up.
 *
 * Defined as a single-line expression to keep the regex replacement
 * surgical (we're injecting into a string of bundle source).
 */
const INSPECTOR_BODY_EXPR =
  '((function(){var __b=buffer;try{var __i=globalThis.__xlibrary_inspectorInjection;' +
  'globalThis.__xlibrary_inspectorPatchSucceeded=true;' +
  'if(__i&&typeof file==="string"&&file.endsWith(".html")){' +
  'var __h=buffer.toString("utf8");' +
  'if(__h.includes("</body>")){' +
  '__b=Buffer.from(__h.replace("</body>",__i+"</body>"),"utf8");' +
  'globalThis.__xlibrary_inspectorInjected=true;' +
  '}' +
  '}}catch(_){}return __b;})()).toString("base64")';

/**
 * Rewrite the route-interceptor's `body: buffer.toString("base64")` line to
 * route through our injection wrapper. Anchors on the exact 3-line shape so
 * we don't accidentally match other base64 fulfill calls in the bundle.
 *
 * Target snippet (verified against playwright-core@1.60.0):
 *
 *     body: buffer.toString("base64"),
 *     isBase64: true
 *
 * The preceding line in this exact ordering is
 * `{ name: "Content-Type", value: mime7.getType(...) || "application/octet-stream" }`
 * which makes the (`body:`/`isBase64:`) pair unique.
 */
function patchInspectorHtmlInjection(source: string): { patched: string; ok: boolean } {
  if (source.includes('__xlibrary_inspectorPatchSucceeded')) {
    return { patched: source, ok: true };
  }

  // Match the exact body+isBase64 pair AFTER the Content-Type header line —
  // there's only one in the bundle.
  const re = /(\}\s*\],\s*)body:\s*buffer\.toString\("base64"\)(,\s*isBase64:\s*true)/;
  if (!re.test(source)) {
    dlog('bundle-patcher: inspector fulfill pattern not found — skipping injection patch');
    return { patched: source, ok: false };
  }

  const replaced = source.replace(
    re,
    (_, pre, post) => `${pre}body: ${INSPECTOR_BODY_EXPR}${post}`,
  );
  return { patched: replaced, ok: true };
}

// ---------------------------------------------------------------------------
// Third patch — output file follows the Target dropdown
// ---------------------------------------------------------------------------

/**
 * Rewrite the line in `_RecorderApp._updateActions` that decides whether to
 * push a generator's text into the `_throttledOutputFile`. Original picks
 * the PRIMARY generator (the language passed to `_enableRecorder` at startup
 * and never changes); we want it to follow the SELECTED generator (the one
 * the user currently has highlighted in the Inspector's "Target:" dropdown).
 *
 * Target snippet (verified against playwright-core@1.60.0):
 *
 *     if (languageGenerator.id === this._primaryGeneratorId)
 *       this._throttledOutputFile?.setContent(source8.text);
 *
 * We rewrite to:
 *
 *     if (languageGenerator.id === this._selectedGeneratorId) {
 *       this._throttledOutputFile?.setContent(source8.text);
 *       globalThis.__xlibrary_outputFollowsTargetSucceeded = true;
 *     }
 *
 * Why this is safe:
 *   `_selectedGeneratorId` is initialised to `_primaryGeneratorId` in the
 *   `_RecorderApp` constructor, so a recording session where the user never
 *   touches the dropdown gets the SAME behaviour as before. Switching the
 *   dropdown ONLY changes the file content on the next render — by design,
 *   that's exactly what the user expects when they pick a different target.
 *
 * Idempotency: the inserted flag literal acts as the marker.
 */
function patchOutputFollowsTarget(source: string): { patched: string; ok: boolean } {
  if (source.includes('__xlibrary_outputFollowsTargetSucceeded')) {
    return { patched: source, ok: true };
  }

  // Anchor on the unique 2-statement block. Whitespace-tolerant.
  const re =
    /if\s*\(\s*languageGenerator\.id\s*===\s*this\._primaryGeneratorId\s*\)\s*\n?\s*this\._throttledOutputFile\?\.setContent\(source\d*\.text\);/;
  if (!re.test(source)) {
    dlog('bundle-patcher: output-follows-target pattern not found');
    return { patched: source, ok: false };
  }

  // We deliberately keep the variable `source8` (or whatever number) referenced
  // — capturing it via the regex isn't necessary because the original line
  // already mentions the right variable; we just rewrite the conditional.
  const replaced = source.replace(re, (matched) => {
    // Replace `_primaryGeneratorId` → `_selectedGeneratorId` and wrap the
    // setContent + new flag inside a block so we can attach the success
    // marker on the same execution path.
    const withSelected = matched.replace('_primaryGeneratorId', '_selectedGeneratorId');
    return withSelected + '\n          globalThis.__xlibrary_outputFollowsTargetSucceeded=true;';
  });
  return { patched: replaced, ok: true };
}

// ---------------------------------------------------------------------------
// Module._compile hook installer
// ---------------------------------------------------------------------------

/**
 * Install the `Module.prototype._compile` interception. Idempotent.
 * Returns `true` if newly installed, `false` if a previous call already did so.
 *
 * MUST be called before any `import` or `require` of `playwright-core`.
 */
export function installBundlePatch(): boolean {
  if (globalThis.__xlibrary_bundlePatchInstalled) return false;
  globalThis.__xlibrary_bundlePatchInstalled = true;

  // `Module.prototype._compile` is an undocumented but stable Node.js API used
  // by virtually every transpile-on-require tool (ts-node, babel-register …).
  // Typing: not in @types/node, so cast to a structural interface.
  type Compileable = {
    _compile: (this: NodeModule, content: string, filename: string) => unknown;
  };

  const proto = Module.prototype as unknown as Compileable;
  const originalCompile = proto._compile;

  proto._compile = function patchedCompile(content: string, filename: string) {
    // Only touch the one file we care about. Fast-path everything else.
    if (filename.endsWith('coreBundle.js') || filename.endsWith('coreBundle.cjs')) {
      const originalLength = content.length;

      // Patch 1: language registry → adds RobotFramework / Selenium to dropdown
      const langPatch = patchBundleSource(content);
      if (langPatch.ok) {
        globalThis.__xlibrary_bundlePatchSucceeded = true;
        content = langPatch.patched;
      } else {
        globalThis.__xlibrary_bundlePatchSucceeded = false;
      }

      // Patch 2: Inspector HTML injection → inserts our toolbar
      // before </body>. The flag the patched code sets at runtime is
      // separate from the regex-applied flag (we set the latter manually
      // after a successful source rewrite).
      const inspectorPatch = patchInspectorHtmlInjection(content);
      if (inspectorPatch.ok) {
        content = inspectorPatch.patched;
      }

      // Patch 3: output file follows the Target dropdown. Without this the
      // .robot output is always written in the language passed to
      // _enableRecorder, even if the user picks a different target in the
      // Inspector's "Target:" dropdown.
      const targetPatch = patchOutputFollowsTarget(content);
      if (targetPatch.ok) {
        content = targetPatch.patched;
      }

      dlog(
        'bundle-patcher: language=%s, inspector=%s, target-follow=%s (Δ=%d bytes) for %s',
        langPatch.ok ? 'patched' : 'miss',
        inspectorPatch.ok ? 'patched' : 'miss',
        targetPatch.ok ? 'patched' : 'miss',
        content.length - originalLength,
        filename,
      );
    }
    return originalCompile.call(this, content, filename);
  };

  dlog('bundle-patcher: Module._compile hook installed');
  return true;
}

// ---------------------------------------------------------------------------
// Side-effect install: simply importing this module wires up the hook.
// This MUST happen before playwright-core is loaded, so cli.ts imports this
// file before importing runner.ts.
// ---------------------------------------------------------------------------
installBundlePatch();
