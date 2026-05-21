# Action Type Catalog

> **Role:** `playwright-research`  
> **Source:** `vendor/playwright/packages/recorder/src/actions.d.ts`  
> **Status:** Complete  
> **Date:** 2026-05-19

All types below are verbatim from `actions.d.ts` unless noted.

---

## 1. `ActionName` Union

**File:** `actions.d.ts:19-35`

```ts
export type ActionName =
  | 'check'
  | 'click'
  | 'hover'
  | 'closePage'
  | 'fill'
  | 'navigate'
  | 'openPage'
  | 'press'
  | 'select'
  | 'uncheck'
  | 'setInputFiles'
  | 'assertText'
  | 'assertValue'
  | 'assertChecked'
  | 'assertVisible'
  | 'assertSnapshot';
```

Total: **16 action types** (15 + `assertSnapshot` which was not in the initial keywords-map).

---

## 2. Base Types

### `ActionBase` (`actions.d.ts:37-42`)

```ts
export type ActionBase = {
  name: ActionName;
  signals: Signal[]; // side-effects: popup/download/dialog
  ariaSnapshot?: string;
  preconditionSelector?: string; // used by generateAutoExpect
};
```

### `ActionWithSelector` (`actions.d.ts:44-47`)

```ts
export type ActionWithSelector = ActionBase & {
  selector: string; // internal Playwright selector (see Selector Formats below)
  ref?: string; // internal element reference, ignore for codegen
};
```

---

## 3. Individual Action Types

### `ClickAction` (`actions.d.ts:49-55`)

```ts
export type ClickAction = ActionWithSelector & {
  name: 'click';
  button: 'left' | 'middle' | 'right';
  modifiers: number; // bitmask: Alt=1, Control=2, Meta=4, Shift=8
  clickCount: number; // 1=click, 2=dblclick, 3+=triple-click
  position?: { x: number; y: number }; // relative to element, usually absent
};
```

**Robot Framework mapping:**

- `clickCount === 1` → `Click    ${selector}`
- `clickCount === 2` → `Click    ${selector}    clickCount=2` _(BL has no `Double Click` keyword — verified against marketsquare/robotframework-browser docs)_
- `button === 'right'` → no direct BL keyword for right-click (use JS injection or skip)
- `modifiers !== 0` → wrap with `Keyboard Key down ${mod}` / `Click ${selector}` / `Keyboard Key up ${mod}`

---

### `HoverAction` (`actions.d.ts:57-60`)

```ts
export type HoverAction = ActionWithSelector & {
  name: 'hover';
  position?: { x: number; y: number };
};
```

**Robot mapping:** `Hover    ${selector}`

---

### `CheckAction` (`actions.d.ts:62-64`)

```ts
export type CheckAction = ActionWithSelector & {
  name: 'check';
};
```

**Robot mapping:** `Check Checkbox    ${selector}`

---

### `UncheckAction` (`actions.d.ts:66-68`)

```ts
export type UncheckAction = ActionWithSelector & {
  name: 'uncheck';
};
```

**Robot mapping:** `Uncheck Checkbox    ${selector}`

---

### `FillAction` (`actions.d.ts:70-73`)

```ts
export type FillAction = ActionWithSelector & {
  name: 'fill';
  text: string; // the value to type
};
```

**Robot mapping:** `Fill Text    ${selector}    ${text}`

---

### `NavigateAction` (`actions.d.ts:75-78`)

```ts
export type NavigateAction = ActionBase & {
  name: 'navigate';
  url: string;
};
```

**Note:** No selector. `ActionBase` only (no `ActionWithSelector`).  
**Robot mapping:** `Go To    ${url}`

---

### `OpenPageAction` (`actions.d.ts:80-83`)

```ts
export type OpenPageAction = ActionBase & {
  name: 'openPage';
  url: string;
};
```

**Note:** Emitted when a new page/tab is opened by the browser.  
**Robot mapping:**

```robot
New Browser    chromium    headless=False
New Context
New Page    ${url}
```

Or just `New Page    ${url}` if browser/context already initialized in header.

---

### `ClosesPageAction` (`actions.d.ts:85-87`)

**Note:** Typo in upstream — it's `ClosesPage` not `ClosePage`.

```ts
export type ClosesPageAction = ActionBase & {
  name: 'closePage';
};
```

**Robot mapping:** `Close Page` — but typically **skip** in test-body mode (test cleanup handles it).

---

### `PressAction` (`actions.d.ts:89-93`)

```ts
export type PressAction = ActionWithSelector & {
  name: 'press';
  key: string; // e.g. 'Enter', 'Tab', 'Escape', 'a', 'F5'
  modifiers: number; // bitmask same as ClickAction
};
```

**Shortcut construction:** `[...modifiers, key].join('+')` — e.g. `Shift+Enter`, `Control+a`  
**Robot mapping:** `Press Keys    ${selector}    ${shortcut}`

---

### `SelectAction` (`actions.d.ts:95-98`)

```ts
export type SelectAction = ActionWithSelector & {
  name: 'select';
  options: string[]; // array of option values to select
};
```

**Note:** `options` is always an array, even for single-select.  
**Robot mapping:** `Select Options By    ${selector}    value    ${options[0]}`  
For multi-select: loop or join with separator (BL accepts multiple values).

---

### `SetInputFilesAction` (`actions.d.ts:100-103`)

```ts
export type SetInputFilesAction = ActionWithSelector & {
  name: 'setInputFiles';
  files: string[]; // array of file paths
};
```

**Robot mapping:** `Upload File By Selector    ${selector}    ${files[0]}`  
For multiple files: needs custom handling or multiple keyword calls.

---

### `AssertTextAction` (`actions.d.ts:105-109`)

```ts
export type AssertTextAction = ActionWithSelector & {
  name: 'assertText';
  text: string;
  substring: boolean; // true = contains check, false = exact match
};
```

**Robot mapping:**

- `substring: false` → `Get Text    ${selector}    ==    ${text}`
- `substring: true` → `Get Text    ${selector}    *=    ${text}`

---

### `AssertValueAction` (`actions.d.ts:111-114`)

```ts
export type AssertValueAction = ActionWithSelector & {
  name: 'assertValue';
  value: string;
};
```

**Robot mapping:** `Get Property    ${selector}    value    ==    ${value}`

---

### `AssertCheckedAction` (`actions.d.ts:116-119`)

```ts
export type AssertCheckedAction = ActionWithSelector & {
  name: 'assertChecked';
  checked: boolean;
};
```

**Robot mapping:**

- `checked: true` → `Get Checkbox State    ${selector}    ==    checked`
- `checked: false` → `Get Checkbox State    ${selector}    ==    unchecked`

---

### `AssertVisibleAction` (`actions.d.ts:121-123`)

```ts
export type AssertVisibleAction = ActionWithSelector & {
  name: 'assertVisible';
};
```

**Robot mapping:** `Get Element States    ${selector}    *=    visible`

---

### `AssertSnapshotAction` (`actions.d.ts:125-128`)

```ts
export type AssertSnapshotAction = ActionWithSelector & {
  name: 'assertSnapshot';
  ariaSnapshot: string; // YAML-like ARIA tree snapshot
};
```

**Status:** ⚠️ **No direct Browser Library equivalent** for ARIA snapshot matching.  
**MVP approach:** Emit as a Robot comment:

```robot
# TODO: assertSnapshot not supported — ariaSnapshot: ${ariaSnapshot}
```

File a task for `browser-keyword` agent to find BL equivalent.

---

## 4. Top-Level Union Types

**File:** `actions.d.ts:130-132`

```ts
export type Action =
  | ClickAction
  | HoverAction
  | CheckAction
  | ClosesPageAction
  | OpenPageAction
  | UncheckAction
  | FillAction
  | NavigateAction
  | PressAction
  | SelectAction
  | SetInputFilesAction
  | AssertTextAction
  | AssertValueAction
  | AssertCheckedAction
  | AssertVisibleAction
  | AssertSnapshotAction;

export type AssertAction =
  | AssertCheckedAction
  | AssertValueAction
  | AssertTextAction
  | AssertVisibleAction
  | AssertSnapshotAction;

export type PerformOnRecordAction =
  | ClickAction
  | HoverAction
  | CheckAction
  | UncheckAction
  | PressAction
  | SelectAction;
```

---

## 5. Signal Types

**File:** `actions.d.ts:134-159`

Signals are **side effects** attached to actions (appended to `action.signals[]` after the action completes).

```ts
export type NavigationSignal = BaseSignal & {
  name: 'navigation';
  url: string; // the URL navigated to after the action
};

export type PopupSignal = BaseSignal & {
  name: 'popup';
  popupAlias: string; // e.g. 'page1' — the alias for the new popup page
};

export type DownloadSignal = BaseSignal & {
  name: 'download';
  downloadAlias: string;
};

export type DialogSignal = BaseSignal & {
  name: 'dialog';
  dialogAlias: string;
};

export type Signal = NavigationSignal | PopupSignal | DownloadSignal | DialogSignal;
```

**For Robot Framework MVP:** Ignore all signals. Log a `# Signal: ${signal.name}` comment if desired.

---

## 6. `ActionInContext` (the container type)

**File:** `actions.d.ts:167-173`

```ts
export type ActionInContext = {
  frame: FrameDescription; // which page + iframe this action happened in
  description?: string; // optional human-readable description (from AI/comments)
  action: Action; // the actual action
  startTime: number; // ms timestamp
  endTime?: number; // ms timestamp
};
```

### `FrameDescription` (`actions.d.ts:161-165`)

```ts
export type FrameDescription = {
  pageGuid: string; // unique ID for the browser page
  pageAlias: string; // human-readable alias e.g. 'page', 'page1'
  framePath: string[]; // selectors to navigate into iframes (empty for main frame)
};
```

---

## 7. Selector String Formats

The `selector` field in `ActionWithSelector` uses Playwright's **internal selector engine format**:

| Internal format                        | Example         | BL equivalent                |
| -------------------------------------- | --------------- | ---------------------------- |
| `internal:role=button[name="Submit"]`  | button by role  | `role=button:name=Submit`    |
| `internal:label="Email"`               | by label text   | `label=Email`                |
| `internal:text="Click here"`           | by visible text | `text=Click here`            |
| `internal:attr=[placeholder="Search"]` | by placeholder  | `placeholder=Search`         |
| `internal:attr=[alt="Logo"]`           | by alt text     | n/a — use `css=[alt="Logo"]` |
| `internal:testid=["submit-btn"]`       | by test-id      | `data-testid=submit-btn`     |
| `css=.my-class > button`               | CSS selector    | `css=.my-class > button`     |
| `xpath=//button[@id="go"]`             | XPath           | `xpath=//button[@id="go"]`   |

> **Selector translation** is the responsibility of `robot-emitter`. See `docs/integration-points.md` for the recommended translation function signature.

---

## 8. Missing Action in Current `keywords-map.ts`

The current `src/codegen/keywords-map.ts` is missing:

- `assertSnapshot` (new action — no BL equivalent yet)

Also, `closePage` is present but should likely be **skipped** (return `''` from `generateAction`).

---

## 9. Summary Table

| Action           | Has selector? | Key extra fields                    | MVP Robot keyword                                          |
| ---------------- | ------------- | ----------------------------------- | ---------------------------------------------------------- |
| `openPage`       | No            | `url`                               | `New Page    ${url}` (or handle in header)                 |
| `closePage`      | No            | —                                   | _(skip)_                                                   |
| `navigate`       | No            | `url`                               | `Go To    ${url}`                                          |
| `click`          | Yes           | `button`, `clickCount`, `modifiers` | `Click    ${sel}`                                          |
| `fill`           | Yes           | `text`                              | `Fill Text    ${sel}    ${text}`                           |
| `press`          | Yes           | `key`, `modifiers`                  | `Press Keys    ${sel}    ${key}`                           |
| `check`          | Yes           | —                                   | `Check Checkbox    ${sel}`                                 |
| `uncheck`        | Yes           | —                                   | `Uncheck Checkbox    ${sel}`                               |
| `select`         | Yes           | `options[]`                         | `Select Options By    ${sel}    value    ${val}`           |
| `hover`          | Yes           | `position?`                         | `Hover    ${sel}`                                          |
| `setInputFiles`  | Yes           | `files[]`                           | `Upload File By Selector    ${sel}    ${file}`             |
| `assertText`     | Yes           | `text`, `substring`                 | `Get Text    ${sel}    ==\|*=    ${text}`                  |
| `assertValue`    | Yes           | `value`                             | `Get Property    ${sel}    value    ==    ${val}`          |
| `assertChecked`  | Yes           | `checked`                           | `Get Checkbox State    ${sel}    ==    checked\|unchecked` |
| `assertVisible`  | Yes           | —                                   | `Get Element States    ${sel}    *=    visible`            |
| `assertSnapshot` | Yes           | `ariaSnapshot`                      | _(comment — no BL equivalent)_                             |
