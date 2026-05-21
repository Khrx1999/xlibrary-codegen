# Integration Points — Plugging `RobotFrameworkLanguageGenerator` into Playwright Recorder

> **Role:** `playwright-research`  
> **Status:** Complete  
> **Date:** 2026-05-19

---

## 1. The Core Problem

`languageSet()` in `vendor/playwright/packages/playwright-core/src/server/codegen/languages.ts:23` is the source of all registered generators. It is a **closed function** — we cannot modify it (vendor is read-only).

The recorder's `RecorderApp._updateActions()` at `recorderApp.ts:321` iterates `languageSet()` to build all sources for the UI. This means our generator **will not appear in the live recorder UI** using the standard path.

---

## 2. Recommended Integration Strategy: Programmatic Recorder API

**Source:** `recorderApp.ts:179-188` and `recorderApp.ts:358-390`

Playwright exposes a `recorderMode: 'api'` option on `enableRecorder` which bypasses the UI and fires Node.js events instead:

```ts
// recorderApp.ts:183-188
if (params.recorderMode === 'api') {
  const browserName = context._browser.options.name;
  await ProgrammaticRecorderApp.run(context, recorder, browserName, params);
  return;
}
```

`ProgrammaticRecorderApp.run()` (`recorderApp.ts:358-390`) emits `BrowserContext.Events.RecorderEvent` with:

```ts
{ event: 'actionAdded', data: action, page, code: actionTexts.join('\n') }
// or
{ event: 'actionUpdated', data: action, page, code: actionTexts.join('\n') }
```

The `code` is generated from the **selected `languageGenerator`** — whichever `l.id === params.language` matches.

**Key line:** `recorderApp.ts:370`:

```ts
const languageGenerator =
  languages.find((l) => l.id === params.language) ??
  languages.find((l) => l.id === 'playwright-test')!;
```

This still requires our generator to be in `languageSet()`.

---

## 3. Practical Integration Path for `src/recorder/runner.ts`

Since we cannot add to `languageSet()`, the cleanest approach for our CLI is to **directly call `generateCode()`** with our own generator instance, bypassing Playwright's recorder UI loop entirely.

### Step 1: Launch browser and enable recorder

```ts
import { chromium } from 'playwright-core';
import { generateCode } from 'playwright-core/lib/server/codegen/language';
// ^ internal import — check package.json exports
```

> **Unknown:** Whether `playwright-core` exports `generateCode` or `languageSet` publicly.  
> **Task for `codegen-core`:** Verify import paths. May need to use:
>
> ```ts
> const { generateCode } = require('playwright-core/lib/server/codegen/language');
> ```
>
> or access via the internal package path. Check `vendor/playwright/packages/playwright-core/package.json` for `exports` field.

### Step 2: Intercept `ActionInContext` events

When using `context.enableRecorder({ recorderMode: 'api', language: 'jsonl' })`, the context emits:

```ts
context.on('recorderEvent', ({ event, data }) => {
  if (event === 'actionAdded' || event === 'actionUpdated') {
    const action: ActionInContext = data;
    // call our generator
    const line = robotGenerator.generateAction(action);
    outputLines.push(line);
  }
});
```

> **Unknown:** The exact event name for `BrowserContext.Events.RecorderEvent`. It's defined in `browserContext.ts`. Task for `codegen-core` to verify the public event name from the client API.

### Step 3: On session end, write the file

```ts
// On SIGINT or context close:
const header = robotGenerator.generateHeader(options);
const footer = robotGenerator.generateFooter(undefined);
const robotFile = [header, ...outputLines, footer].join('\n');
fs.writeFileSync(outputPath, robotFile);
```

---

## 4. Alternative: Direct Action Interception via CDP/Devtools

If the programmatic recorder API proves inaccessible, an alternative is to use Playwright's `page.on('request')` + page evaluation hooks to capture interactions. This is significantly more complex and out of scope for MVP.

---

## 5. `RobotFrameworkLanguageGenerator` Implementation Contract

The `robot-emitter` team must implement this interface exactly:

```ts
// vendor/playwright/packages/playwright-core/src/server/codegen/types.ts:31-39
export interface LanguageGenerator {
  id: string;
  groupName: string;
  name: string;
  highlighter: Language; // must be one of: 'javascript'|'python'|'java'|'csharp'|'jsonl'
  generateHeader(options: LanguageGeneratorOptions): string;
  generateAction(actionInContext: actions.ActionInContext): string;
  generateFooter(saveStorage: string | undefined): string;
}
```

### Concrete requirements for each method:

#### `generateHeader(options: LanguageGeneratorOptions): string`

Must output a complete Robot Framework file header:

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
${options.testName || 'Recorded Flow'}
```

- `options.browserName` — used to set browser in `New Browser` keyword if included in header
- `options.launchOptions.headless` — determines `headless=True|False` in `New Browser`
- Do **not** include `New Browser` / `New Context` / `New Page` in the header — those come from `openPage` action

#### `generateAction(actionInContext: actions.ActionInContext): string`

- Return `''` (empty string) to skip an action (used for `closePage`)
- Return a **single Robot keyword call**, indented with **4 spaces** (test body indent)
- Format: `    Keyword Name    arg1    arg2    arg3`
- For `openPage` with a URL: return `    New Page    ${url}` (or `    New Browser    ...` + `New Page`)
- Must handle **all 16 action types** — even if only to emit a `# TODO` comment

#### `generateFooter(saveStorage: string | undefined): string`

- Return `''` (empty string) — Robot files have no closing block
- If `saveStorage` is provided, optionally emit a comment

---

## 6. Selector Translation — Recommended Function Signature

The `robot-emitter` team needs to implement selector translation. Recommended signature:

```ts
// src/codegen/selectorTranslator.ts  (new file)

/**
 * Converts a Playwright internal selector string to a Browser Library selector string.
 *
 * Input examples (from action.selector):
 *   'internal:role=button[name="Submit"]'
 *   'internal:label="Email address"'
 *   'internal:text="Click here"'
 *   'css=.submit-btn'
 *   'xpath=//button'
 *
 * Output examples (Browser Library format):
 *   'role=button:name=Submit'
 *   'label=Email address'
 *   'text=Click here'
 *   'css=.submit-btn'
 *   'xpath=//button'
 */
export function toRobotSelector(playwrightSelector: string): string;
```

### Translation Rules (verified from `locatorGenerators.ts` and BL docs)

| Input pattern                                     | Output                            |
| ------------------------------------------------- | --------------------------------- |
| `internal:role=<role>[name="<text>"]`             | `role=<role>:name=<text>`         |
| `internal:role=<role>[name="<text>"][exact=true]` | `role=<role>:name=<text>`         |
| `internal:label="<text>"`                         | `label=<text>`                    |
| `internal:text="<text>"`                          | `text=<text>`                     |
| `internal:attr=[placeholder="<text>"]`            | `placeholder=<text>`              |
| `internal:attr=[alt="<text>"]`                    | `css=[alt="<text>"]`              |
| `internal:attr=[title="<text>"]`                  | `css=[title="<text>"]`            |
| `internal:testid=["<value>"]`                     | `data-testid=<value>`             |
| `css=<selector>`                                  | `css=<selector>`                  |
| `xpath=<selector>`                                | `xpath=<selector>`                |
| Anything else                                     | Pass through as-is (CSS fallback) |

> **Important:** The `internal:*` selector engine names are Playwright-internal. Browser Library uses its own selector engine prefix syntax (`role=`, `text=`, `css=`, `xpath=`, etc.). These are **not** the same.
>
> Browser Library selector engine docs: https://marketsquare.github.io/robotframework-browser/Browser.html#Selectors

### Alternative: Use `asLocator('jsonl', selector)`

The `jsonl` language generator at `jsonl.ts:29` produces:

```ts
JSON.parse(asLocator('jsonl', selector));
```

This returns a **structured object** describing the locator strategy. This may be the most reliable way to parse internal selectors without hand-rolling a parser.

> **Task for `robot-emitter`:** Investigate `asLocator('jsonl', ...)` output shape for common selector types and determine whether it provides enough information for clean BL selector translation.

---

## 7. `keywords-map.ts` — Gaps to Fix

Current `src/codegen/keywords-map.ts` issues:

1. **Missing `assertSnapshot`** — needs an entry (even if it returns a comment)
2. **`closePage`** should have `argTemplate: () => []` and the generator should return `''` for it
3. **`openPage`** `argTemplate` receives `a.url` but the action type has `url` directly (not in a generic `args` dict) — the argTemplate interface needs to accept the typed action, not a generic `Record<string, string>`
4. **`assertText` `substring` flag** — the argTemplate needs the `substring` boolean to choose `==` vs `*=` operator
5. **`assertChecked` `checked` flag** — needs `checked` boolean to emit `checked` vs `unchecked`
6. **`click` `clickCount === 2`** — should emit `Double Click` instead of `Click`

---

## 8. Import Path Resolution

> **Unknown — task for `codegen-core`**

The following internal Playwright modules need to be importable from our project:

| Module                                        | What we need                      | Status                     |
| --------------------------------------------- | --------------------------------- | -------------------------- |
| `@recorder/actions`                           | `ActionInContext`, `Action` types | Unknown — may be type-only |
| `playwright-core/lib/server/codegen/language` | `generateCode()`                  | Unknown                    |
| `playwright-core/lib/server/codegen/types`    | `LanguageGenerator` interface     | Unknown                    |
| `@isomorphic/locatorGenerators`               | `asLocator()`                     | Unknown                    |

**Recommendation:** Since these are internal APIs, the safest approach is to:

1. Copy the `LanguageGenerator` interface into `src/types.ts` (already started)
2. Copy `ActionInContext` and related types into `src/types.ts`
3. Import our own types for the generator implementation
4. Only import Playwright's `chromium` and `BrowserContext` from the public API

---

## 9. File Creation Checklist for Implementors

| File                                | Owner                 | Status                                  |
| ----------------------------------- | --------------------- | --------------------------------------- |
| `src/codegen/robotframework.ts`     | `robot-emitter`       | Stub exists — needs full implementation |
| `src/codegen/keywords-map.ts`       | `robot-emitter`       | Exists — needs fixes (see §7)           |
| `src/codegen/selectorTranslator.ts` | `robot-emitter`       | Not yet created                         |
| `src/codegen/formatter.ts`          | `robot-emitter`       | Not yet created                         |
| `src/recorder/runner.ts`            | `codegen-core`        | Not yet created                         |
| `src/types.ts`                      | `playwright-research` | Stub — needs Action types               |

---

## 10. Open Unknowns (File Tasks for Other Agents)

| #   | Unknown                                                                                                                                | For agent         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| U1  | Can we `import { generateCode }` from `playwright-core` internal path? What is the exported path?                                      | `codegen-core`    |
| U2  | What is the public event name for `BrowserContext.Events.RecorderEvent` from the client API?                                           | `codegen-core`    |
| U3  | Does `context.enableRecorder({ recorderMode: 'api', language: 'jsonl' })` work from the public Playwright API, or is it internal only? | `codegen-core`    |
| U4  | What is the JSON shape of `asLocator('jsonl', selector)` for the most common selector types?                                           | `robot-emitter`   |
| U5  | What is the exact Browser Library selector syntax for `role`, `label`, `text`, `placeholder`? Verify against BL v18 docs.              | `browser-keyword` |
| U6  | Does Browser Library have a `Double Click` keyword?                                                                                    | `browser-keyword` |
| U7  | Does Browser Library support multi-file upload in `Upload File By Selector`?                                                           | `browser-keyword` |
