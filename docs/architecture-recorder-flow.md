# Playwright Recorder + Codegen — Architecture Brief

> **Role:** `playwright-research`  
> **Status:** Complete  
> **Date:** 2026-05-19

---

## 1. High-Level Flow

```
Browser interaction
      │
      ▼
Recorder (server/recorder.ts)
      │  emits RecorderEvent.ActionAdded / RecorderEvent.SignalAdded
      ▼
RecorderApp._wireListeners()          ← recorderApp.ts:244
      │  accumulates ActionInContext[]
      ▼
RecorderApp._updateActions()          ← recorderApp.ts:316
      │  for each LanguageGenerator in languageSet()
      ▼
generateCode(actions, generator, opts) ← codegen/language.ts:22
      │  calls generator.generateHeader()
      │  calls generator.generateAction() per action
      │  calls generator.generateFooter()
      ▼
Source object → pushed to Recorder UI + optionally written to --output file
```

---

## 2. Key Files and Responsibilities

| File                                                                            | Responsibility                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `vendor/playwright/packages/playwright-core/src/server/codegen/types.ts`        | `LanguageGenerator` interface, `LanguageGeneratorOptions` type                                                       |
| `vendor/playwright/packages/playwright-core/src/server/codegen/language.ts`     | `generateCode()` orchestrator, utility helpers (`toSignalMap`, `toKeyboardModifiers`, `toClickOptionsForSourceCode`) |
| `vendor/playwright/packages/playwright-core/src/server/codegen/languages.ts`    | **Language registry** — `languageSet()` returns a `Set<LanguageGenerator>`                                           |
| `vendor/playwright/packages/playwright-core/src/server/recorder/recorderApp.ts` | Wires Recorder events → `generateCode()` → UI / file output                                                          |
| `vendor/playwright/packages/playwright-core/src/server/codegen/python.ts`       | Closest analog to our Robot generator — reference implementation                                                     |
| `vendor/playwright/packages/playwright-core/src/server/codegen/javascript.ts`   | Reference for locator handling patterns                                                                              |
| `vendor/playwright/packages/recorder/src/actions.d.ts`                          | All `Action` type definitions + `ActionInContext`                                                                    |
| `vendor/playwright/packages/isomorphic/locatorGenerators.ts`                    | `asLocator(lang, selector)` — converts internal selector strings to language-specific locator calls                  |

---

## 3. `LanguageGenerator` Interface (verbatim)

**File:** `vendor/playwright/packages/playwright-core/src/server/codegen/types.ts:31-39`

```ts
export interface LanguageGenerator {
  id: string; // unique identifier, e.g. 'robotframework'
  groupName: string; // group label in recorder UI, e.g. 'Robot Framework'
  name: string; // tab label in recorder UI, e.g. 'Browser Library'
  highlighter: Language; // syntax highlighting hint — 'javascript'|'python'|'java'|'csharp'|'jsonl'
  generateHeader(options: LanguageGeneratorOptions): string;
  generateAction(actionInContext: actions.ActionInContext): string;
  generateFooter(saveStorage: string | undefined): string;
}
```

`Language` is defined at `locatorGenerators.ts:23`:

```ts
export type Language = 'javascript' | 'python' | 'java' | 'csharp' | 'jsonl';
```

> **Important:** The `Language` type is an **enum for syntax highlighting only** — it does not need to match our generator's actual language. For Robot Framework, use `'python'` as the highlighter (closest syntax match). We cannot add `'robot'` to this type without modifying vendor code.

---

## 4. `generateCode()` Orchestrator

**File:** `vendor/playwright/packages/playwright-core/src/server/codegen/language.ts:22-28`

```ts
export function generateCode(
  actions: actions.ActionInContext[],
  languageGenerator: LanguageGenerator,
  options: LanguageGeneratorOptions,
) {
  const header = languageGenerator.generateHeader(options);
  const footer = languageGenerator.generateFooter(options.saveStorage);
  const actionTexts = actions
    .map((a) => generateActionText(languageGenerator, a, !!options.generateAutoExpect))
    .filter(Boolean) as string[];
  const text = [header, ...actionTexts, footer].join('\n');
  return { header, footer, actionTexts, text };
}
```

- Each action is joined with `'\n'` — so `generateAction()` should return a **single logical line** (or multi-line Robot keyword call) ending **without** a trailing newline, or return `''` to skip the action.
- If `generateAutoExpect` is `true` and `action.action.preconditionSelector` is set, `generateCode` synthesizes an extra `assertVisible` action **before** the main action (`language.ts:34-48`).

---

## 5. `LanguageGeneratorOptions` Shape

**File:** `vendor/playwright/packages/playwright-core/src/server/codegen/types.ts:22-29`

```ts
export type LanguageGeneratorOptions = {
  browserName: string; // 'chromium' | 'firefox' | 'webkit'
  launchOptions: LaunchOptions; // { headless: boolean, ... }
  contextOptions: BrowserContextOptions;
  deviceName?: string; // e.g. 'iPhone 14'
  saveStorage?: string; // path to save storage state
  generateAutoExpect?: boolean; // auto-insert assertVisible before each action
};
```

---

## 6. Language Registry — How Generators Are Registered

**File:** `vendor/playwright/packages/playwright-core/src/server/codegen/languages.ts:23-39`

```ts
export function languageSet() {
  return new Set([
    new JavaScriptLanguageGenerator(true),
    new JavaScriptLanguageGenerator(false),
    new PythonLanguageGenerator(false, true),
    // ... etc.
  ]);
}
```

**`RecorderApp._updateActions()` at `recorderApp.ts:321` calls:**

```ts
for (const languageGenerator of languageSet()) {
  const { header, footer, actionTexts, text } = generateCode(
    actions,
    languageGenerator,
    this._languageGeneratorOptions,
  );
  // ...
}
```

### Integration Strategy

Since `vendor/playwright/` is **read-only**, we cannot add `RobotFrameworkLanguageGenerator` to `languages.ts` directly.

**Two viable approaches:**

**A. Use Playwright's programmatic API (recommended for MVP)**  
The `chromium.launchPersistentContext()` + `context.enableRecorder()` API accepts a `language` parameter. The recorder's `ProgrammaticRecorderApp` at `recorderApp.ts:358-390` listens to `RecorderEvent.ActionAdded` and calls our generator directly — we bypass `languageSet()` entirely.

**B. Patch `languageSet()` at runtime (monkey-patch)**  
After importing `playwright-core`, intercept the `languages.ts` module and inject our generator into the returned Set. Fragile but avoids needing internal API access.

> **Recommendation:** Start with approach **A** — programmatic API with `recorderMode: 'api'`. This is what `recorderApp.ts:183-188` uses. It calls `generateCode([action], languageGenerator, ...)` for each action in the `ActionAdded` event and does **not** rely on `languageSet()`.

---

## 7. Action Processing Pipeline Detail

### `recorderApp.ts:285-295` — Action accumulation

```ts
private _onActionAdded(action: actions.ActionInContext) {
  this._actions.push(action);
  this._updateActions('reveal');
}

private _onSignalAdded(signal: actions.SignalInContext) {
  const lastAction = this._actions.findLast(a => a.frame.pageGuid === signal.frame.pageGuid);
  if (lastAction)
    lastAction.action.signals.push(signal.signal);
  this._updateActions();
}
```

Signals (popup, download, dialog) are **appended to the last action's signals array** after the fact. The generator must check `action.signals` for these side effects.

### `recorderUtils.ts:104-118` — `collapseActions()`

Before generating code, `_updateActions()` calls `collapseActions(this._actions)` at `recorderApp.ts:318`. This merges:

- Consecutive `fill` on same selector → keep only last
- Consecutive `navigate` → keep only last
- Multi-click sequences → merge into single click with higher `clickCount`

---

## 8. Selector Resolution — `asLocator()`

**File:** `vendor/playwright/packages/isomorphic/locatorGenerators.ts:73-75`

```ts
export function asLocator(
  lang: Language,
  selector: string,
  isFrameLocator: boolean = false,
): string {
  return asLocators(lang, selector, isFrameLocator, 1)[0];
}
```

- Accepts internal Playwright selector strings (e.g. `internal:role=button[name="Submit"]`, `css=.submit-btn`, `xpath=//button`)
- Returns language-specific locator calls (e.g. `getByRole('button', { name: 'Submit' })` for JS)
- **`lang` must be one of** `'javascript' | 'python' | 'java' | 'csharp' | 'jsonl'`

### For Robot Framework

We **cannot** call `asLocator('robot', ...)` — that language key doesn't exist. Instead:

1. Call `asLocator('javascript', selector)` → gives JS locator like `getByRole('button', { name: 'Submit' })`
2. **Parse / translate** this to Browser Library selector syntax, OR
3. Use `asLocator('jsonl', selector)` which returns a structured JSON object containing raw selector parts — this may be the most useful for our custom translation.

**Alternative:** Parse the raw `action.selector` string directly. The format is internal Playwright selector syntax. The most common forms the recorder produces:

- `internal:role=<role>[name="<text>"]` → Browser Library: `role=<role>:name=<text>`
- `internal:label="<text>"` → Browser Library: `label=<text>`
- `css=<selector>` → Browser Library: `css=<selector>`
- `xpath=<selector>` → Browser Library: `xpath=<selector>`

> **See `docs/integration-points.md`** for detailed selector translation recommendations.

---

## 9. Frame Handling

When `actionInContext.frame.framePath` is non-empty, the action occurs inside an iframe. Python generator handles this at `python.ts:61`:

```ts
const locators = actionInContext.frame.framePath.map(
  (selector) => `.${this._asLocator(selector)}.content_frame`,
);
const subject = `${pageAlias}${locators.join('')}`;
```

For Robot Framework MVP: **ignore framePath** (treat as flat page). File a follow-up task to handle iframes if needed.

---

## 10. Signal Handling

Signals are read via `toSignalMap()` from `language.ts:62-79`:

```ts
export function toSignalMap(action: actions.Action) {
  let popup, download, dialog;
  for (const signal of action.signals) {
    if (signal.name === 'popup') popup = signal;
    else if (signal.name === 'download') download = signal;
    else if (signal.name === 'dialog') dialog = signal;
  }
  return { popup, download, dialog };
}
```

For Robot Framework MVP: signals can be **ignored** — they're used for parallel waiting patterns that don't have direct Browser Library equivalents. Log a comment in the output if a signal is detected.

---

## 11. Python Emitter Pattern (Reference)

The `PythonLanguageGenerator` (`python.ts:26-217`) is the closest analog. Key structural decisions to replicate:

1. **`generateHeader()`** → emits `*** Settings ***` + Library imports + `*** Test Cases ***` + test name
2. **`generateAction()`** → returns one keyword call line (4-space indent for test body)
3. **`generateFooter()`** → returns `''` (Robot files don't need a closing block)
4. **Skip `openPage`/`closePage`** when in "test" mode (equivalent to pytest mode) — in our case, always skip `closePage` and handle `openPage` with `New Browser` + `New Page`

---

## 12. Modifier Keys Encoding

**File:** `vendor/playwright/packages/playwright-core/src/server/codegen/language.ts:81-92`

```ts
export function toKeyboardModifiers(modifiers: number): SmartKeyboardModifier[] {
  const result = [];
  if (modifiers & 1) result.push('Alt');
  if (modifiers & 2) result.push('ControlOrMeta');
  if (modifiers & 4) result.push('ControlOrMeta'); // Meta
  if (modifiers & 8) result.push('Shift');
  return result;
}
```

`modifiers` is a bitmask: `Alt=1, Control=2, Meta=4, Shift=8`. For `PressAction`, the full shortcut is `[...modifiers, action.key].join('+')`.
