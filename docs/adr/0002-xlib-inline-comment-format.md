# `xlib:*` inline comment format

**Status:** accepted (2026-05-22)

Every emitted step carries a single trailing comment encoding xlibrary
metadata in a `key=value;key=value` payload — minimally `xlib:step=N` for
patch-operation addressing, plus `alts=[...]` for the Self-Healing alternatives:

```robot
Click    role=button[name="Sign in"]    # xlib:step=5;alts=["data-testid=login","css=.btn-primary"]
```

```ts
await page.getByRole('button', { name: 'Sign in' }).click(); // xlib:step=5;alts=["data-testid=login","css=.btn-primary"]
```

The same payload format works across all four targets — only the comment
prefix differs (`# ` for Robot/Python, `// ` for TypeScript).

## Considered Options

- **Sidecar `.locators.json`.** Cleaner test files but doubles the file count,
  fragments git history, and goes silently out of sync if the test is edited
  by hand. The "single source of truth per test" property is worth more than
  the cosmetic win.
- **AST-only addressing** (parse `.ts`/`.py` with language-specific parsers;
  no markers in file). Rejected: three different parsers to maintain, brittle
  to user reformatting, and fails for Robot's indent-based syntax which has
  no real AST.
- **Robot `[Documentation]` field.** RF-only; not cross-language; can't be
  per-step (only per-test/keyword). Disqualified by the four-target scope.
- **Comment block at end of file.** Hides metadata from the step it describes;
  patch operations would need to reconcile two locations on every edit.

## Consequences

- Output files are slightly noisier than hand-written tests — accepted as the
  cost of a single, machine-readable, cross-language addressing scheme.
- The `xlib:` namespace is reserved; we can extend the payload (e.g.
  `quality=A+`, `recorded-at=…`) without redesign.
- `xlibrary patch --at N` is a single regex (`xlib:step=N`) regardless of
  target language, which keeps the patch implementation small enough to share
  across all four emitters.
- Users who object to the markers can post-process with a one-line
  `sed '/# xlib:/d'` — opt-out is trivial; opt-in (re-adding markers) is not.
  We choose the markers-on default deliberately.
