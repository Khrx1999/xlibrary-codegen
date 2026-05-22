# Multi-language emitter scope

**Status:** accepted (2026-05-22)

xlibrary v0.2.0 ships four output targets — `robot` (default), `selenium`,
`ts` (Playwright Test), `python` (pytest-playwright) — chosen via `-l` flag or
inferred from `-o` file extension. One target per recording; the raw action
stream is optionally saved as a `.jsonl` artifact so users can re-emit into
another target later via `xlibrary emit` without re-recording.

## Considered Options

- **All Playwright built-ins** (js / playwright-test / python / python-async /
  python-pytest / java / csharp / csharp-mstest / csharp-nunit). Rejected: test
  surface ~10× larger; Java/C# variants serve a niche RF doesn't overlap.
- **TypeScript only.** Rejected: locks out the Python QA audience, which is a
  natural adjacent market to Robot Framework users.
- **Generic plugin registry from day one** (third-party emitters as packages).
  Rejected: premature; we don't yet have enough emitters to know the right
  interface shape. Revisit if/when 3rd-party emitters appear.
- **Multi-output per recording** (`-l robot,ts,python` writes all three at
  once). Rejected: ambiguous default filenames, viewer UI complexity, and
  partial-failure semantics. The JSONL artifact + `emit` command achieves the
  same outcome without the complexity.

## Consequences

- `robot` and `selenium` are xlibrary's own emitters and continue to work in
  both direct mode and JSONL bridge fallback.
- `ts` and `python` reuse Playwright's built-in language generators — they
  require direct mode (no JSONL bridge fallback). When direct mode is
  unavailable, the CLI must fail with a clear, actionable error.
- Adding java/csharp/other built-ins later is one-line plumbing per language;
  the architectural commitment is "four targets," not "only ever four."
