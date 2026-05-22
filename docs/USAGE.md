# CLI Usage Reference

> Full reference for the `xlibrary` command — v0.2.

---

## Synopsis

```
xlibrary install [browsers...] [--with-deps]
xlibrary codegen [url] [options]
xlibrary emit <actions.jsonl> -l <target> -o <file> [--test-name <name>]
xlibrary extract <file> [-o <file>] [--yes] [-l <target>] [--actions <jsonl>]
xlibrary patch <file> [--at <id>] [--insert-after <id>] [--insert-before <id>]
                      [--delete <id>] [--move <spec>] [--range <range>]
                      [--non-interactive] [--no-backup]
```

---

## `xlibrary install`

Download Playwright browser binaries.

```bash
npx xlibrary install                       # chromium (default)
npx xlibrary install firefox               # just Firefox
npx xlibrary install chromium firefox      # multiple browsers
npx xlibrary install --with-deps           # + OS-level deps (Linux only)
```

The install command wraps `playwright install` and guarantees the downloaded
binary version matches the `playwright-core` bundled inside xlibrary. Using
`npx playwright install` directly can install the wrong binary version if your
global `playwright` differs from xlibrary's pinned version.

---

## `xlibrary codegen`

Open a browser, record interactions, write an output file.

### Flags

| Flag                    | Type         | Default          | Description                                                                                                                                                                            |
| ----------------------- | ------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[url]`                 | positional   | _(none)_         | URL to open when the browser launches. Supports `https://`, `http://`, and `file://`. Bare domains (e.g. `example.com`) are prefixed with `https://` automatically.                    |
| `-o, --output <file>`   | string       | `recorded.robot` | Path for the output file. Extension is used to infer the language when `-l` is not set.                                                                                                |
| `-l, --lang <target>`   | string       | _(inferred)_     | Emitter target: `robot` \| `selenium` \| `ts` \| `python`. Overrides extension inference. Explicit `-l` wins; a mismatch with the extension emits a warning but proceeds.              |
| `-b, --browser <name>`  | string       | `chromium`       | Browser engine: `chromium`, `firefox`, or `webkit`.                                                                                                                                    |
| `--test-name <name>`    | string       | `Recorded Flow`  | Name of the test case written in the output file.                                                                                                                                      |
| `--save-actions [file]` | optional str | _(off)_          | Save the raw action stream as a `.jsonl` artifact. When the flag is given without a path, writes to `<output>.jsonl` next to the output file.                                          |
| `--extract-data`        | boolean flag | _(off)_          | After recording ends, run the Test Data Wizard: detect extractable literal values, show a diff preview, and prompt to apply. Use `--yes` (via `xlibrary extract`) for unattended runs. |
| `--quiet`               | boolean flag | _(off)_          | Suppress the live keyword preview printed to the terminal during recording. The output file is still updated.                                                                          |
| `--open`                | boolean flag | _(off)_          | After the recording session ends, open the output file in your default editor (VS Code preferred; falls back to OS default).                                                           |
| `--no-viewer`           | boolean flag | _(viewer on)_    | Disable the auxiliary live-viewer browser window that shows the output syntax-highlighted and refreshed via WebSocket.                                                                 |
| `--open-viewer`         | boolean flag | _(off)_          | Auto-open the viewer window in your browser at startup. By default the Inspector shows an "Open Live Preview" button so you can open it only when needed.                              |

### Language inference

When `-l` is not given, the output file extension determines the target:

| Extension         | Target     |
| ----------------- | ---------- |
| `.robot`          | `robot`    |
| `.selenium.robot` | `selenium` |
| `.spec.ts`, `.ts` | `ts`       |
| `.py`             | `python`   |
| _(other or none)_ | `robot`    |

### Flag details

#### `[url]`

```bash
# Opens https://playwright.dev/docs
npx xlibrary codegen https://playwright.dev/docs -o docs.robot

# Bare domain — automatically becomes https://example.com
npx xlibrary codegen example.com -o example.robot

# No URL — browser opens blank; navigate manually before recording
npx xlibrary codegen -o manual.robot
```

#### `-o, --output <file>`

The file is updated incrementally every ~400 ms as you record. On `Ctrl+C` or
browser close, a final flush writes the complete file. The parent directory
must exist — xlibrary will not create it.

```bash
npx xlibrary codegen https://example.com -o tests/robot/login.robot
```

#### `-l, --lang <target>`

```bash
# Explicit Robot Framework output
npx xlibrary codegen https://example.com -l robot -o login.robot

# TypeScript / Playwright Test (requires direct mode — see Recording modes below)
npx xlibrary codegen https://example.com -l ts -o tests/login.spec.ts

# SeleniumLibrary
npx xlibrary codegen https://example.com -l selenium -o login.selenium.robot

# Python / pytest-playwright (requires direct mode)
npx xlibrary codegen https://example.com -l python -o tests/test_login.py
```

> `ts` and `python` require direct mode (successful bundle patch). If the
> bundle patch fails for your `playwright-core` version, xlibrary prints an
> actionable error and exits. Use `-l robot` or `-l selenium` as the
> fallback, then `xlibrary emit` to convert later.

#### `--save-actions [file]`

Saves the raw recorded action stream as a `.jsonl` artifact. Pass no path to
auto-name it next to the output file:

```bash
# Writes both login.robot AND login.robot.jsonl
npx xlibrary codegen https://example.com/login -o login.robot --save-actions

# Explicit artifact path
npx xlibrary codegen https://example.com/login -o login.robot --save-actions artifacts/login.jsonl
```

The artifact starts with a header line:

```jsonl
{"xlib":1,"recorded-at":"2026-05-22T10:00:00.000Z","browser":"chromium","test-name":"Login Flow"}
{"actions":[...]}
...
```

Pass this file to `xlibrary emit` to re-render into a different language
without re-recording.

#### `--extract-data`

Runs the Test Data Wizard immediately after recording ends. Shows a diff
preview and prompts for confirmation before applying.

```bash
npx xlibrary codegen https://example.com/login -o login.robot --save-actions --extract-data
```

For unattended use, run `xlibrary extract login.robot --yes` as a separate step.

#### `-b, --browser <name>`

| Value      | Browser                            |
| ---------- | ---------------------------------- |
| `chromium` | Google Chrome-compatible (default) |
| `firefox`  | Mozilla Firefox                    |
| `webkit`   | Safari-compatible                  |

Each browser engine must be installed separately:

```bash
npx xlibrary install firefox
npx xlibrary codegen https://example.com -b firefox -o firefox-test.robot
```

#### `--test-name <name>`

Sets the test case name in the generated file.

```bash
npx xlibrary codegen https://example.com/login \
  --test-name "Login With Valid Credentials" \
  -o login.robot
```

Output:

```robot
*** Test Cases ***
Login With Valid Credentials
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    ...
```

Use a descriptive name. Robot Framework test names appear in reports and log files.

#### `--quiet`

By default, each newly-captured keyword is printed in a Unicode-box preview:

```
+- Generated keyword -------------------------------------------
|     Click    role=button[name="Sign in"]    # xlib:step=3
+---------------------------------------------------------------
```

Pass `--quiet` to suppress this when you only want the final file.

#### `--no-viewer`

While recording, xlibrary also opens a small auxiliary browser window showing
the generated output syntax-highlighted and refreshed live via WebSocket. Pass
`--no-viewer` to disable it (useful in headless environments or CI).

---

## `xlibrary emit`

Re-render a recorded JSONL artifact into a target language. No browser is
opened — the conversion is pure text transformation.

### Supported targets in v0.2

`robot` and `selenium`. Re-emit for `ts` and `python` is post-v0.2 — for
those targets, use `xlibrary codegen -l ts/python` at record time.

### Flags

| Flag                  | Required | Description                                               |
| --------------------- | -------- | --------------------------------------------------------- |
| `<actions.jsonl>`     | yes      | Path to the `.jsonl` artifact from `--save-actions`.      |
| `-l, --lang <target>` | yes      | Output target: `robot` \| `selenium`.                     |
| `-o, --output <file>` | yes      | Destination file path.                                    |
| `--test-name <name>`  | no       | Override the test-case name (default: from JSONL header). |

### Examples

```bash
# Save the artifact during recording
npx xlibrary codegen https://example.com/login -o login.robot --save-actions

# Re-emit as SeleniumLibrary
npx xlibrary emit login.robot.jsonl -l selenium -o login.selenium.robot

# Re-emit as Robot Framework with a different test name
npx xlibrary emit login.robot.jsonl -l robot -o login-v2.robot --test-name "Login v2"
```

### Output on success

```
xlibrary emit: wrote robot output to login-v2.robot
  Source : login.robot.jsonl (recorded 2026-05-22T10:00:00.000Z, browser: chromium)
  Test   : Login v2
  Steps  : 6
```

---

## `xlibrary extract`

Test Data Wizard — standalone retrofit for existing files.

Detects literal values in recorded steps, shows a diff preview, and extracts
them into language-appropriate variable declarations (Robot Framework
`*** Variables ***`, TypeScript `const`, Python module-level constants).

A sidecar `.jsonl` file is required. xlibrary needs the action stream to
understand the field context (e.g., `[type=email]` → `VALID_EMAIL`).

### Flags

| Flag                     | Required | Default      | Description                                                           |
| ------------------------ | -------- | ------------ | --------------------------------------------------------------------- |
| `<file>`                 | yes      |              | Source file to extract variables from (`.robot`, `.spec.ts`, `.py`).  |
| `-o, --output <file>`    | no       | _(in-place)_ | Write to this path instead of editing the source file.                |
| `--yes`                  | no       | `false`      | Skip the confirmation prompt and apply immediately.                   |
| `-l, --lang <target>`    | no       | _(inferred)_ | Override language inference from file extension.                      |
| `--actions <jsonl-path>` | no       | _(auto)_     | Path to the sidecar `.jsonl`. Default: `<file>.jsonl` next to source. |

### Detection logic

Detection is two-layer:

1. **Field context** (priority — uses selector semantics):

   | Selector signal                   | Variable name      |
   | --------------------------------- | ------------------ |
   | `[type=email]`                    | `VALID_EMAIL`      |
   | `[type=password]`                 | `VALID_PASSWORD`   |
   | `[type=tel]`                      | `VALID_PHONE`      |
   | `[autocomplete=username]`         | `USERNAME`         |
   | `[autocomplete=current-password]` | `CURRENT_PASSWORD` |
   | `[name=email]` or similar         | `EMAIL`            |

2. **Value regex** (fallback when no field context):
   - URL pattern → `BASE_URL` or `URL_N`
   - Email shape → `EMAIL_N`

Same value at multiple sites → single variable. Different values for the same
category → numbered suffix (`VALID_EMAIL`, `VALID_EMAIL_2`).

### Interactive session

```
xlibrary extract login.robot
--- Detected 3 variables ---------------------------------
- ${VALID_EMAIL}       = "qa@example.com"   (2 sites)
- ${VALID_PASSWORD}    = "Hunter2!"         (1 site)
- ${BASE_URL}          = "https://app.com"  (1 site)
--- Diff preview -----------------------------------------
  *** Variables ***
+ ${VALID_EMAIL}       qa@example.com
+ ${VALID_PASSWORD}    Hunter2!
+ ${BASE_URL}          https://app.com
...
Apply? [Y/n]
```

Pass `--yes` to skip the prompt:

```bash
npx xlibrary extract login.robot --yes
```

### In-place edit with backup

When no `-o` is given, xlibrary edits the source file in-place and writes a
`.bak` backup first:

```
login.robot.bak   (copy of original)
login.robot       (updated with variables)
```

---

## `xlibrary patch`

Re-record one or more steps in an existing generated file.

Requires `xlib:step=N` markers in the file. All files generated by
xlibrary >= 0.2.0 include these markers automatically.

### Flags

| Flag                   | Description                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `<file>`               | Path to the file to patch (`.robot`, `.spec.ts`, `.py`).                    |
| `--at <id>`            | Replace a step. `id` is a 1-indexed step number or fuzzy keyword substring. |
| `--insert-after <id>`  | Record new steps to insert after step `id`.                                 |
| `--insert-before <id>` | Record new steps to insert before step `id`.                                |
| `--delete <id>`        | Delete a step or range. `id` is `N` or `N-M` (e.g. `5` or `3-7`).           |
| `--move <spec>`        | Reorder steps. Spec format: `"<from> to <to>"` (e.g. `"3 to 7"`).           |
| `--range <range>`      | Replace a range of steps. Use with `--at` (e.g. `--at 3 --range 3-5`).      |
| `--non-interactive`    | Fail-fast instead of pausing when replay fails (useful in CI).              |
| `--no-backup`          | Skip writing the `.bak` backup file before mutation.                        |

### Step identification

Steps are addressed two ways:

- **Integer** (`--at 5`) — matches the `xlib:step=5` marker exactly.
- **Fuzzy string** (`--at "Click Login"`) — case-insensitive substring match on
  the keyword line.

When a fuzzy match finds multiple steps, the CLI prints a disambiguation list:

```
Step "Click" matches 3 steps:
  [3] Click    role=button[name="Login"]
  [7] Click    role=button[name="Submit"]
  [9] Click    role=link[name="Logout"]
Re-run with --at 3, --at 7, or --at 9
```

### Replace flow

```bash
npx xlibrary patch login.robot --at 5
```

1. Reads `login.robot` and extracts the action stream.
2. Replays steps 1–4 in a browser window.
3. At step 5, opens the Playwright recorder for re-recording.
4. On browser close, splices the new step(s) back at position 5.
5. Writes the updated file (`.bak` backup written first by default).

### Insert flow

```bash
npx xlibrary patch login.robot --insert-after 3
```

Replays steps 1–3, then opens the recorder. All new steps recorded are
inserted after position 3.

### Delete and move (no recorder)

Delete and move are pure text operations — no browser is opened:

```bash
# Delete a single step
npx xlibrary patch login.robot --delete 6

# Delete a range
npx xlibrary patch login.robot --delete 6-8

# Move step 2 to position 5
npx xlibrary patch login.robot --move "2 to 5"
```

### Cross-language patching

`xlibrary patch` works across all four output languages. The `xlib:step=N`
marker is the same in Robot Framework, TypeScript, and Python files — the
patch engine uses it universally.

New steps recorded during a replace or insert are emitted in the same
language as the source file.

### Backup

A `.bak` file is written next to the source before any mutation:

```
login.robot.bak   (original)
login.robot       (patched)
```

Pass `--no-backup` to skip the backup.

---

## Recording session

1. Run the command — the browser opens with a purple recording toolbar.
2. Interact with the page: click, type, select, hover, check.
3. Use the "Assert" toolbar to add assertions.
4. Close the browser window or press `Ctrl+C` in the terminal.
5. The output file is saved.

```
Robot Codegen — recording in progress
   Mode    : JSONL bridge
   Output  : login.robot
   Preview : on — each recorded keyword prints below
   Close the browser window or press Ctrl+C to finish.

Browser closed — saving output...
Saved: login.robot
```

### Recording modes

`xlibrary` runs in one of two modes (chosen automatically):

| Mode             | When                                             | What happens                                                            |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| **Direct**       | Bundle patch succeeds for this `playwright-core` | Inspector writes the output file directly in the target language.       |
| **JSONL bridge** | Bundle patch misses (fallback)                   | Playwright writes raw JSONL; xlibrary translates to `robot`/`selenium`. |

`ts` and `python` only work in Direct mode. If the bundle patch fails, xlibrary
prints an error and exits with a non-zero code.

Both modes produce the same `.robot`/`.selenium.robot` output. The mode is
printed at startup.

---

## Common workflows

### Record a login flow

```bash
npx xlibrary codegen https://example.com/login \
  -o login.robot \
  --test-name "Login Flow"
```

Expected output structure:

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com/login
    Fill Text    role=textbox[name="Email"]    user@example.com    # xlib:step=1;alts=["label=Email","css=#email"]
    Fill Text    role=textbox[name="Password"]    secret    # xlib:step=2
    Click    role=button[name="Sign in"]    # xlib:step=3
    Get Text    role=heading[level=1]    ==    Dashboard    # xlib:step=4
    Close Browser
```

### Record once, emit to multiple languages

```bash
# Record Robot Framework output and save the artifact
npx xlibrary codegen https://example.com/login \
  -o login.robot \
  --save-actions \
  --test-name "Login Flow"

# Re-emit as SeleniumLibrary (no browser needed)
npx xlibrary emit login.robot.jsonl -l selenium -o login.selenium.robot
```

### Record TypeScript / Python directly

```bash
# TypeScript (Playwright Test)
npx xlibrary codegen https://example.com/login \
  -l ts \
  -o tests/login.spec.ts \
  --save-actions

# Python (pytest-playwright)
npx xlibrary codegen https://example.com/login \
  -l python \
  -o tests/test_login.py \
  --save-actions
```

### Record and extract variables in one step

```bash
npx xlibrary codegen https://example.com/login \
  -o login.robot \
  --save-actions \
  --extract-data
```

### Extract variables from an existing file

```bash
# Interactive (prompts for confirmation)
npx xlibrary extract login.robot

# Apply without prompt (CI-safe)
npx xlibrary extract login.robot --yes
```

### Patch a step after the fact

```bash
# Replace step 5 by re-recording in the browser
npx xlibrary patch login.robot --at 5

# Delete a broken step
npx xlibrary patch login.robot --delete 4

# Insert two steps after step 2
npx xlibrary patch login.robot --insert-after 2
```

### Record in Firefox

```bash
npx xlibrary install firefox          # one-time setup
npx xlibrary codegen https://example.com -b firefox -o firefox-test.robot
```

### Save to a specific directory

```bash
mkdir -p tests/robot
npx xlibrary codegen https://example.com -o tests/robot/smoke.robot
```

---

## Output file anatomy

### Robot Framework

```robot
*** Settings ***
Library    Browser                             # Browser Library import

*** Test Cases ***
<test-name>                                   # from --test-name flag
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None               # viewport=None fills the real window
    New Page    <url>                          # first navigation (if URL provided)
    <...recorded actions with xlib markers...>
    Close Browser                             # teardown
```

### `xlib:step` markers

Every emitted step (that carries a selector) includes a trailing inline comment:

```robot
    Click    role=button[name="Sign in"]    # xlib:step=3
    Fill Text    role=textbox[name="Email"]    qa@example.com    # xlib:step=1;alts=["label=Email","css=#email"]
```

The marker is always present (even when there are no alternatives). `alts` is
omitted when no alternative selectors are available.

To strip all markers from a file:

```bash
# macOS/BSD
sed -i '' 's/[[:space:]]*# xlib:[^[:space:]]*//' login.robot

# GNU/Linux
sed -i 's/[[:space:]]*# xlib:[^[:space:]]*//' login.robot
```

### Built-in defaults

- `args=["--start-maximized"]` — emitted for **chromium only**; omitted for Firefox and WebKit.
- `viewport=None` — emitted on every `New Context` call so the page fills the real window rather than Playwright's default `1280x720`.

### `openPage(about:blank) + navigate` collapse

The Playwright recorder emits two actions when the browser opens at a URL:

1. `openPage(url="about:blank")` — the implicit first tab
2. `navigate(url=<your URL>)` — the real navigation

The generator collapses this pair into a single `New Page <url>` keyword. If
any other action occurs between the two, the collapse cancels and the
subsequent `navigate` becomes a regular `Go To <url>`.

### Selector syntax

| Selector type     | Example                       |
| ----------------- | ----------------------------- |
| ARIA role         | `role=button[name="Sign in"]` |
| Form label        | `label=Email address`         |
| Visible text      | `text=Submit`                 |
| Input placeholder | `placeholder=Search`          |
| CSS               | `css=#submit-btn`             |
| XPath             | `xpath=//button[@id="go"]`    |

See [`docs/browser-library-selectors.md`](browser-library-selectors.md) for the full selector reference.

### Unsupported actions

Some recorder actions have no direct Browser Library equivalent and are emitted
as comments:

```robot
    # TODO: assertSnapshot not supported — ariaSnapshot: ...
```

Review `# TODO:` lines after recording and replace them with appropriate
Robot Framework keywords.

### Signals (navigation, popup, download, dialog)

| Signal       | Output                                    | Notes                                                                            |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `navigation` | `# Navigation to: <url>`                  | Informational comment only — Browser Library waits for navigation automatically. |
| `popup`      | `# TODO: Capture popup page (alias: ...)` | A new page/tab opened; add `Wait For New Page` manually.                         |
| `download`   | `# TODO: Handle download (alias: ...)`    | A file download started; add `Wait For Download` manually.                       |
| `dialog`     | `# TODO: Handle dialog signal "..."`      | A JS `alert`/`confirm`/`prompt` appeared; add `Handle Alert` BEFORE the action.  |

---

## Running the generated file

### Robot Framework + Browser Library

```bash
pip install robotframework robotframework-browser
rfbrowser init
robot login.robot
```

Dry-run (syntax check only):

```bash
robot --dryrun login.robot
```

### Playwright Test (TypeScript)

```bash
npm install -D @playwright/test
npx playwright install
npx playwright test tests/login.spec.ts
```

### pytest-playwright (Python)

```bash
pip install pytest pytest-playwright
playwright install
pytest tests/test_login.py
```

---

## Troubleshooting

### `Error: browserType.launch: Executable doesn't exist`

Playwright browsers are not installed. Run:

```bash
npx xlibrary install chromium
```

### The browser opens but the recording toolbar is missing

1. Ensure `playwright-core` is properly installed: `npm install`
2. Try a fresh browser install: `npx playwright install --force chromium`

### The output file is empty or only has the header

The browser was closed before any actions were recorded, or only `about:blank`
was visited. Record at least one interaction before closing.

### `xlibrary: command not found`

Install globally or use `npx`:

```bash
npm install -g xlibrary
# or
npx xlibrary codegen ...
```

### Output has `# TODO:` comments

Some recorded actions (`assertSnapshot`, popup/download/dialog signals) have
no direct Browser Library equivalent. Replace those lines with the appropriate
keywords. See the [Browser Library keyword reference](https://marketsquare.github.io/robotframework-browser/Browser.html).

### `xlibrary emit` fails with "ts/python not supported"

`xlibrary emit` only supports `robot` and `selenium` targets in v0.2. For
TypeScript or Python output, use `xlibrary codegen -l ts` or
`xlibrary codegen -l python` at record time.

### `xlibrary extract` fails with "actions file not found"

The Test Data Wizard requires a sidecar `.jsonl` file generated by
`--save-actions`. Re-record with that flag:

```bash
npx xlibrary codegen https://example.com -o login.robot --save-actions
npx xlibrary extract login.robot
```

Or point to an existing artifact with `--actions <path>`.

### `xlibrary patch` fails at replay

If a step fails during replay (e.g. the page structure changed), xlibrary
pauses and prompts:

```
Step 3 failed to replay: Element not found
[s]kip / [r]ecord from here / [a]bort
```

- `s` — skip the failed step and continue replaying.
- `r` — stop replay here and open the recorder from this point.
- `a` — abort the patch operation (no file is written).

Pass `--non-interactive` to fail-fast instead of prompting (useful in CI).

### `ts` / `python` output requires direct mode

When using `-l ts` or `-l python`, xlibrary must successfully apply its
bundle patch to `playwright-core`. If the patch fails (e.g. after a
`playwright-core` update), you'll see:

```
TypeScript/Python output requires direct mode, but xlibrary's bundle patch
for playwright-core@X.Y.Z is failing. Update xlibrary, downgrade
playwright-core, or use -l robot instead.
```

Check for a newer xlibrary version with `npm info xlibrary version`.

### `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` when downloading Chromium

See the [README troubleshooting section](../README.md#troubleshooting) for the
full corporate-proxy fix guide.
