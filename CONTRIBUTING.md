# Contributing to xlibrary

Thanks for your interest in making xlibrary better. This document covers the
setup, conventions, and workflows you need to land a change.

> **Status:** xlibrary is pre-1.0. The CLI is stable; the programmatic API is
> still experimental.

---

## Quick start

```bash
git clone https://github.com/Khrx1999/xlibrary.git
cd xlibrary
npm install
npm test
```

That should pass with no extra setup — all snapshot tests are pure unit tests
that don't launch a browser. To run the recorder smoke test you'll also need
the Chromium binary:

```bash
npx playwright install chromium
```

---

## Requirements

- Node.js **≥ 20** (Node 18 reached end-of-life on 2026-04-30)
- npm **≥ 9**
- Playwright Chromium (recorder smoke tests only): `npx playwright install chromium`

---

## Development workflow

| Command                | What it does                                                |
| ---------------------- | ----------------------------------------------------------- |
| `npm run build`        | Compile TypeScript → `dist/`, mark `dist/cli.js` executable |
| `npm run dev`          | Run the CLI without building (via `tsx`)                    |
| `npm test`             | Run the full vitest suite once                              |
| `npm run test:watch`   | Re-run tests on file changes                                |
| `npm run typecheck`    | `tsc --noEmit`                                              |
| `npm run lint`         | Run ESLint over the codebase                                |
| `npm run lint:fix`     | Run ESLint with `--fix`                                     |
| `npm run format`       | Format all files with Prettier                              |
| `npm run format:check` | Verify formatting without writing changes                   |

Before opening a pull request, run all three gates:

```bash
npm run typecheck && npm run lint && npm test
```

The pre-commit hook (Husky + lint-staged) already runs ESLint + Prettier on
staged files. It does **not** run tests — `vitest` is fast enough to run on
demand and CI will run the full suite on every PR.

---

## Repo layout

```
xlibrary/
├── src/
│   ├── index.ts                     # Public programmatic API barrel
│   ├── cli.ts                       # CLI entry (Commander)
│   ├── types.ts                     # Action / Signal types (single source of truth)
│   ├── codegen/
│   │   ├── index.ts                 # Codegen barrel
│   │   ├── robot-formatter.ts       # Shared .robot line/section formatter
│   │   ├── keyboard-modifiers.ts    # Modifier-bit decoding + dialect transforms
│   │   ├── keywords-map.ts          # Action → Browser Library keyword name
│   │   ├── robotframework.ts        # Browser Library generator
│   │   ├── selenium-keywords-map.ts # Action → SeleniumLibrary keyword name
│   │   ├── selenium.ts              # SeleniumLibrary generator
│   │   ├── locator-translator.ts    # Internal selector → Browser Library selector
│   │   ├── selenium-locator.ts      # Internal selector → SeleniumLibrary XPath
│   │   └── signal-handler.ts        # Side-effect signal → Robot Framework lines
│   ├── recorder/
│   │   ├── index.ts                 # Recorder barrel
│   │   ├── runner.ts                # Orchestrator: launch, poll, shutdown
│   │   ├── bundle-patcher.ts        # Module._compile hook + 3 regex patches
│   │   ├── viewer-server.ts         # HTTP + WebSocket live preview server
│   │   ├── jsonl-bridge.ts          # JSONL parse + flushOutput render loop
│   │   ├── preview-printer.ts       # Unicode-box keyword preview
│   │   ├── editor-opener.ts         # openInEditor + openInBrowser helpers
│   │   └── inspector-toolbar/       # Inspector window HTML/CSS/JS injection
│   │       ├── index.ts
│   │       ├── icons.ts
│   │       ├── styles.ts
│   │       └── client-script.ts
│   └── replay/
│       └── replay-engine.ts         # Action replay controller (play/pause/step)
│
├── tests/
│   ├── codegen.test.ts              # Snapshot tests for Browser Library generator
│   ├── selenium.test.ts             # Snapshot tests for SeleniumLibrary generator
│   ├── replay-engine.test.ts        # Replay controller behaviour
│   ├── bundle-patcher.test.ts       # Regex-pattern tests against fixtures
│   ├── bundle-patcher.compat.test.ts # Live playwright-core compatibility test
│   ├── locator-flags.test.ts        # Locator translation edge cases
│   ├── openpage-collapse.test.ts    # openPage + navigate collapse behaviour
│   ├── inspector-toolbar.test.ts    # Inspector toolbar injection contract
│   ├── recorder-cursor.test.ts      # Direct-mode tail-cursor behaviour
│   ├── integration.test.ts          # Full pipeline integration tests
│   ├── fixtures/actions/            # JSON fixtures — one per action type
│   └── snapshots/                   # Golden .robot files
│
├── examples/                        # Sample .robot files showing expected output
├── docs/                            # USAGE, action catalog, architecture, examples
├── tools/viewer/                    # Live preview HTML (shipped in package)
├── vendor/playwright/               # Read-only reference — DO NOT MODIFY
└── ...
```

> `vendor/playwright/` is a read-only reference clone. Copy snippets when you
> need them, but never edit files in place.

### Optional: Playwright reference clone

`vendor/playwright/` is **not** committed to the repository (it is a ~100 MB
upstream clone). If you want it locally for reading Playwright internals
referenced from `src/recorder/bundle-patcher.ts`:

```bash
# From the xlibrary repo root:
git clone --depth 1 https://github.com/microsoft/playwright.git vendor/playwright
```

The bundle-patcher regex anchors are documented inline against specific
`playwright-core` versions — a fresh clone of `microsoft/playwright` at the
matching tag is enough to verify the patterns.

---

## How the code generator works

`runRecorder()` in `src/recorder/runner.ts` runs in one of two modes, chosen
automatically at startup.

### Direct mode

`src/recorder/bundle-patcher.ts` rewrites `playwright-core`'s bundled JS
in-memory at `Module._compile` time. Three regex patches are applied:

1. **`languageSet()`** — injects `RobotFrameworkLanguageGenerator` and
   `SeleniumLibraryLanguageGenerator` into the Inspector's language registry.
2. **Inspector HTML response** — splices our toolbar (replay controls + viewer
   link) before `</body>` of every `.html` the Inspector serves.
3. **Output-follows-target** — rewires the Inspector's "Target:" dropdown so
   switching languages also rewrites the `.robot` file on disk.

When all three patches apply, the Inspector writes the `.robot` file directly
and `runner.ts` only tails it for the live console preview.

### JSONL bridge mode

When any patch misses (Playwright internal layout changed), the runner falls
back to `_enableRecorder({ language: 'jsonl', outputFile: <tmp> })`:

1. Playwright writes each recorded action as a JSON line to a temp file.
2. Every 400 ms, `flushOutput()` re-renders the whole file: read JSONL → parse
   entries → feed each into a fresh generator → write the resulting `.robot`.
3. The full re-render handles the case where Playwright mutates the last JSONL
   line in place (e.g. as the user types into a `fill` action).

Both modes broadcast the current `.robot` content to the viewer-server, which
relays it to connected browser tabs and the Inspector's injected toolbar.

See [`docs/architecture-recorder-flow.md`](docs/architecture-recorder-flow.md)
for the full diagram.

---

## How to add a new action mapping

The mapping table in `src/codegen/keywords-map.ts` is the single source of
truth for **keyword names**. The generator in `src/codegen/robotframework.ts`
looks up every name through this table; argument construction stays in the
generator because it needs context the map shouldn't carry (selector
translation, value escaping, modifier wrapping).

### 1. Add the mapping entry

```typescript
// src/codegen/keywords-map.ts
ACTION_TO_KEYWORD = {
  // ...
  dragAndDrop: { keyword: 'Drag And Drop' },
};
```

Use `NO_BL_EQUIVALENT` as the keyword value when there is no Browser Library
equivalent — the emitter will produce a `# TODO:` comment instead of a call.

### 2. Add the corresponding type

```typescript
// src/types.ts
export type DragAndDropAction = ActionWithSelector & {
  name: 'dragAndDrop';
  targetSelector: string;
};

export type ActionName =
  | 'click'
  | 'dragAndDrop'   // ← add here
  | ...;

export type Action = ClickAction | DragAndDropAction | ...;
```

### 3. Handle the action in the generator

```typescript
// src/codegen/robotframework.ts → _emitAction
case 'dragAndDrop':
  fmt.keyword(
    kw('dragAndDrop'),
    safeSelector(action.selector),
    safeSelector(action.targetSelector),
  );
  return true;
```

Key helpers:

- `kw(name)` → look up the keyword name from `ACTION_TO_KEYWORD`
- `safeSelector(sel)` → translate internal selector + escape Robot Framework
  variable syntax
- `escapeRobotValue(str)` → escape `${`, `@{`, etc. for safe literal use
- `fmt.keyword(name, ...args)` → emit an indented keyword call line
- `fmt.comment(text)` → emit an indented `# comment` line

### 4. Add a fixture + golden snapshot

```
tests/fixtures/actions/dragAndDrop.json
tests/snapshots/dragAndDrop.robot
```

### 5. Wire the test case

```typescript
// tests/codegen.test.ts
it('dragAndDrop → Drag And Drop <source> <target>', () => {
  expect(generateFull(gen, loadFixture('dragAndDrop'))).toBe(loadSnapshot('dragAndDrop'));
});
```

### 6. Run the gates

```bash
npm run typecheck && npm run lint && npm test
```

---

## How to add a new CLI flag

1. Add the option in `src/cli.ts` using Commander's `.option()`.
2. Add the corresponding field to `RobotCodegenOptions` in `src/types.ts`.
3. Forward the value through to `runRecorder()` in `src/recorder/runner.ts`.
4. Document the flag in `docs/USAGE.md` (the **Flags** table and **Flag
   details** section) and the **Flags** table in `README.md`.

---

## Code style

- TypeScript strict mode — prefer `unknown` + type guards over `any`.
- No `@ts-ignore` — use `@ts-expect-error` with a reason if absolutely needed.
- 2-space indentation; Robot Framework files use 4-space (see `.editorconfig`).
- ESLint preset: `@typescript-eslint/recommended-type-checked`.
- Floating promises are an error — every async call site must either `await`
  or attach `.catch(...)`.
- Every new source file needs a JSDoc header explaining its role.
- All user-supplied strings flow through `escapeRobotValue()` before reaching
  a Robot Framework keyword argument.
- Keyword names live only in `keywords-map.ts` / `selenium-keywords-map.ts` —
  never inline a string literal of a keyword name in a generator.

---

## Pull request process

1. Fork the repository and create a branch: `git checkout -b feat/my-feature`.
2. Make your changes.
3. Run all three gates: `npm run typecheck && npm run lint && npm test`.
4. Commit. The pre-commit hook runs ESLint + Prettier on staged files.
5. Open a pull request describing **what** changed and **why** (link to an
   issue if one exists).

> Single-maintainer turnaround: expect a first response within 7 days. Quick
> bug fixes are typically reviewed faster than feature additions.

---

## Release process

Releases are still cut manually. After CI lands:

1. Bump `version` in `package.json` following [semver](https://semver.org/).
2. Update `CHANGELOG.md` with the new section (Keep a Changelog format).
3. `npm run typecheck && npm run lint && npm test && npm run build`.
4. Tag: `git tag v<version> && git push --tags`.
5. Publish: `npm publish` (the `prepublishOnly` script re-runs all gates).

The `dist/` directory is build output. It is **not** committed; `prepublishOnly`
builds it fresh before each publish.
