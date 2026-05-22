# Changelog

All notable changes to xlibrary are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.1] — 2026-05-22

### Fixed

- **Selenium Replay button** in the live viewer was inert because
  `SeleniumLibraryLanguageGenerator` was missing `getCapturedActions()`.
  Added the method (returns a defensive copy) and aligned action-capture
  position with the RF emitter so both produce identical action lists for
  the Replay engine.
- **`# xlib:step=N` clutter** suppressed. Direct-mode recordings (the common
  case) have no `alternatives[]` payload, so the bare step marker added no
  value. The emitters now only write the comment when there are alternatives
  to record (JSONL bridge mode). Output is clean by default.

### Changed

- **`--save-actions` + `-l ts/python` now fails fast.** Playwright owns the
  ts/python emitters, so xlibrary can't capture the action stream for
  re-emission. The previous behavior silently wrote an empty `.jsonl`
  (header only). Record with `-l robot` instead, then `xlibrary emit` later.
- **Unified `LangTarget` type.** Removed duplicate `SourceLang` /
  `SupportedLang` aliases from `src/patch/*`. Single canonical type from
  `src/types.ts`.
- **`xlibrary --version`** reads from `package.json` dynamically — no manual
  sync required on version bumps.

### Removed

- `src/codegen/xlib-post-processor.ts` was written but never wired into the
  runner. ts/python `# xlib:step` markers via post-processing are deferred
  to v0.3.
- 127 redundant integration tests (Task #16 forked from pre-wave-1 base and
  duplicated coverage of helper modules already exercised by snapshot tests).
  Final count: 1255 tests, all passing.

### Improved

- `viewer-server.ts` uses `WebSocket.OPEN` constant instead of magic
  `readyState === 1` (three call sites).

---

## [0.2.0] — 2026-05-22

> Design decisions: [ADR-0001 Multi-language emitter scope](docs/adr/0001-multi-language-emitter-scope.md),
> [ADR-0002 xlib inline comment format](docs/adr/0002-xlib-inline-comment-format.md).

### Added

#### Multi-language emitter (Tasks #2, #3, #4, #5)

- `-l, --lang <target>` flag on `xlibrary codegen` selects the output language:
  `robot` | `selenium` | `ts` | `python`. Defaults to `robot` when omitted.
- Language inference from `-o` file extension: `.robot` → `robot`,
  `.selenium.robot` → `selenium`, `.spec.ts` / `.ts` → `ts`, `.py` → `python`.
  Explicit `-l` always wins; a conflicting combo emits a warning but proceeds.
- `ts` target emits Playwright Test (TypeScript); `python` target emits
  pytest-playwright. Both require direct mode (successful bundle patch). When
  direct mode is unavailable, the CLI fails with an actionable error message.
- `--save-actions [file]` flag on `xlibrary codegen` writes the raw action
  stream as a `.jsonl` artifact alongside the output file. Default path:
  `<output>.jsonl`. The artifact starts with an xlibrary header line:
  `{"xlib":1,"recorded-at":"...","browser":"...","test-name":"..."}`.
- New subcommand `xlibrary emit <actions.jsonl> -l <target> -o <file>` —
  re-renders a saved artifact into a different language without re-recording.
  Supported targets in v0.2: `robot`, `selenium`. `ts`/`python` emit is
  post-v0.2 (deferred; use `xlibrary codegen -l ts/python` directly).
- Pre-flight warning (not hard-fail) when `ts`/`python` is requested and the
  bundle patch is unavailable. Points the user to update xlibrary or downgrade
  `playwright-core`.

#### Self-healing locators (Tasks #6, #7, #8)

- Every emitted step now carries a trailing inline `xlib:` comment per
  [ADR-0002](docs/adr/0002-xlib-inline-comment-format.md):
  `# xlib:step=5;alts=["data-testid=login","[aria-label='Sign in']"]`
- Step counter (`xlib:step=N`) is always present — even when no alternatives
  are available. `alts=[...]` is appended only when at least one alternative
  exists.
- New pure grading module (`src/codegen/locator-grader.ts`) assigns letter
  grades A+ / A / B / C / D to selector candidates:

  | Kind                     | Base grade |
  | ------------------------ | ---------- |
  | `data-testid` / test-id  | A+         |
  | `role` + accessible name | A          |
  | `label` text             | A          |
  | `placeholder` text       | B          |
  | visible `text` content   | B          |
  | CSS (id / class)         | C          |
  | XPath                    | D          |

  A +1-tier uniqueness bonus is applied when the selector uniquely matches
  exactly one element on the live page.

- Top-3 alternatives (primary excluded) are ranked by grade and emitted in
  the `alts` array.
- The live viewer (`--viewer`, enabled by default) renders a colored grade
  chip per step. Hover to expand the alternatives list. View-only in v0.2 —
  no click-to-override.

#### Re-record step (Tasks #9, #10, #11)

- New subcommand `xlibrary patch <file>` with the following operations:
  - `--at <id>` — replace a step. `id` is a 1-indexed step number or
    case-insensitive fuzzy keyword substring.
  - `--insert-after <id>` / `--insert-before <id>` — record new steps to
    insert adjacent to a target.
  - `--delete <id>` — delete a step or range (e.g. `5` or `3-7`). Pure text
    manipulation — no browser needed.
  - `--move <spec>` — reorder steps (`"<from> to <to>"`). Pure text
    manipulation — no browser needed.
  - `--range <from>-<to>` — replace a range, used in combination with `--at`.
  - `--non-interactive` — fail-fast instead of pausing on replay failure.
  - `--no-backup` — skip the `.bak` backup file.
- Fuzzy disambiguation: when `--at "<string>"` matches multiple steps, the
  CLI prints a numbered list and exits cleanly.
- Cross-language patching via the universal `xlib:step=N` marker — works
  identically for `.robot`, `.selenium.robot`, `.spec.ts`, and `.py` files.
- For replace/insert: replays the file up to the target step using the replay
  engine, opens the Playwright recorder for re-recording, formats new actions
  in the source language, and splices into the file atomically.
- Atomic file write: the `.bak` backup is written before any mutation; the
  updated content is written only after the new steps are fully rendered.

#### Test Data Wizard (Tasks #12, #13, #14)

- `--extract-data` flag on `xlibrary codegen` — after recording ends, runs the
  detection pipeline, shows a diff preview, and prompts to apply.
- New subcommand `xlibrary extract <file>` — standalone wizard for existing
  files. Requires a sidecar `.jsonl` (from `--save-actions`) or
  `--actions <path>` to override.
  - `-o, --output <file>` — write to a separate file instead of in-place edit.
  - `--yes` — skip the confirmation prompt for scripting/CI.
  - `-l, --lang <target>` — override language inference.
  - `--actions <jsonl-path>` — override sidecar `.jsonl` path.
- Detection is two-layer: **field context** (selector semantics, e.g.
  `[type=email]` → `VALID_EMAIL`) takes priority; **value regex** (URL shape,
  email shape) is the fallback.
- Deduplication: same value at multiple sites → single variable. Different
  values for the same semantic → numbered suffix (`VALID_EMAIL`, `VALID_EMAIL_2`).
- Per-language variable section emit:
  - Robot Framework / SeleniumLibrary: `*** Variables ***` section above
    `*** Test Cases ***`.
  - TypeScript: `const NAME = '...'` constants at the top of the file, before
    the first `import`.
  - Python: module-level constants above the first `def test_` function.
- In-place edit writes a `.bak` backup before mutation.

---

## [0.1.6] — 2026-05-22

Initial public release.

### Added

- `xlibrary codegen [url]` — open a Playwright recorder and write a Robot
  Framework + Browser Library `.robot` file.
- `xlibrary install [browsers...]` — download Playwright browser binaries via
  the bundled `playwright-core` CLI. Passes `--use-system-ca` automatically
  on Node >= 22.10 for corporate-network compatibility.
- Robot Framework `LanguageGenerator` implementation for all 16 Playwright
  action types: `click`, `fill`, `press`, `check`, `uncheck`, `select`,
  `hover`, `setInputFiles`, `navigate`, `openPage`, `closePage`,
  `assertText`, `assertValue`, `assertChecked`, `assertVisible`, `assertSnapshot`.
- SeleniumLibrary generator (`-l selenium` via `src/codegen/selenium.ts`).
- JSONL bridge fallback mode: when the bundle patch misses, Playwright writes
  JSONL and xlibrary re-translates every 400 ms.
- Live viewer window (`--viewer`, on by default) — HTTP + WebSocket server
  serves the current `.robot` content with syntax highlighting.
- `--open` flag — opens the output file in the default editor after recording.
- Selector translation and Robot Framework value escaping
  (`src/codegen/locator-translator.ts`).
- Signal handling (navigation, popup, download, dialog) emitted as informational
  comments and `# TODO:` stubs.
- `openPage(about:blank) + navigate` collapse into a single `New Page <url>`.
- Chromium `args=["--start-maximized"]` and `viewport=None` defaults for
  full-screen recording.
- Programmatic API: `runRecorder`, `RobotFrameworkLanguageGenerator`,
  `SeleniumLibraryLanguageGenerator`, `translateSelector`, `escapeRobotValue`.
- Bilingual README (English + Thai).
