# CONTEXT — xlibrary

> Glossary of domain terms used in this codebase. **No implementation details.**
> Spec/code lives elsewhere. This file says what words mean.

## Core terms

### **Action**

A single user interaction captured by the recorder (`click`, `fill`, `navigate`,
`assertText`, etc.). 16 variants total. Defined upstream in
`vendor/playwright/.../actions.d.ts`.

### **ActionInContext**

An Action plus the frame it happened in (page + iframe path) and timing. The
unit that flows from recorder → emitter.

### **Emitter** _(formerly "LanguageGenerator")_

Component that turns an `ActionInContext[]` stream into source code in one
target language. xlibrary owns emitters for `robot` and `selenium`; uses
Playwright's built-in emitters for `ts` and `python`.

### **Target**

The output language the user picks. One of: `robot` | `selenium` | `ts` |
`python`. Selected via `-l` flag or inferred from `-o` file extension.

### **Direct mode** vs **JSONL bridge mode**

Two recorder operating modes. **Direct mode** means Playwright Inspector writes
the output file in the target language straight through; reached via successful
bundle-patch. **JSONL bridge mode** is the fallback: Inspector writes JSONL,
xlibrary re-translates each tick. JSONL bridge currently emits `robot` only.

### **JSONL artifact**

A `.jsonl` sidecar capturing the raw `ActionInContext` stream from a recording.
Opt-in via `--save-actions`. Enables `xlibrary emit` to re-render the same
recording into a different target later without re-recording.

### **Step**

A single emitted unit in the output file — usually one source line representing
one Action. Identified for the `patch` operation by a `xlib:step=N` marker
embedded in the same inline comment as `xlib:alts`.

## Self-Healing

### **Candidate** (locator candidate)

One of N possible selectors that Playwright's `generateSelector()` returns for
a clicked element. The **primary** is the highest-graded one and goes inline
in the keyword call. The **alternatives** (top-3 minus primary) go in the
`xlib:alts` comment tag.

### **Quality grade**

A letter (A+ / A / B / C / D) assigned to each candidate by a heuristic
priority + uniqueness bonus. Used both for picking the primary and for the
viewer badge display.

### **Proactive healing** (record-time)

Scoring + capturing alternatives during recording so the test starts with the
best selector. Distinct from runtime healing (replay-time fallback), which is
explicitly **out of scope for v0.2**.

## Patch operation

### **Patch**

The `xlibrary patch <file> --at <id>` command. Replays the file up to the
target step using the replay-engine, lets the user re-record one or more
steps, then re-emits the file with the changes spliced in.

### **Step identifier**

Either a 1-indexed step number (`--at 5`) or a content fuzzy-match string
(`--at "Click Login"`). When fuzzy match hits multiple steps, the CLI prints
a disambiguation list.

### **Editing operation**

One of: `replace` (default `--at N`), `insert-after N`, `insert-before N`,
`delete N`, `move N to M`. All operate on the same marker-based patching
substrate and work across all 4 targets.

## Test Data

### **Extracted variable**

A literal value (email, password, URL, …) detected during a post-record pass
or via `xlibrary extract`, replaced inline with a named variable reference
(`${VALID_EMAIL}` / `const VALID_EMAIL` / `VALID_EMAIL = …`) and listed in the
file's variables section.

### **Detection context**

The semantic information used to decide _what kind_ of variable a value is.
Two sources, in priority order:

1. **Field context** — the selector tells us (`[type=email]` → email,
   `[type=password]` → password, `[autocomplete=…]` → semantic mapping).
2. **Value pattern** — regex on the value itself (URL, email shape). Only
   used as fallback when field context is absent.
