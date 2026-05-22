> Read this in: **English** | [ภาษาไทย](README.th.md)

# xlibrary

Record browser interactions and generate test files for [Robot Framework](https://robotframework.org/) + [Browser Library](https://github.com/MarketSquare/robotframework-browser),
[SeleniumLibrary](https://robotframework.org/SeleniumLibrary/), [Playwright Test (TypeScript)](https://playwright.dev/), or [pytest-playwright (Python)](https://playwright.dev/python/) — powered by [Playwright](https://playwright.dev/).

[![npm version](https://img.shields.io/npm/v/xlibrary)](https://www.npmjs.com/package/xlibrary)
[![node](https://img.shields.io/node/v/xlibrary)](https://nodejs.org/)
[![license](https://img.shields.io/npm/l/xlibrary)](https://github.com/Khrx1999/xlibrary/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/xlibrary)](https://www.npmjs.com/package/xlibrary)

---

## What's new in v0.2

- **Multi-language output** — record once, emit to `robot`, `selenium`, `ts`, or `python` via `-l`/`--lang`. Save the raw action stream with `--save-actions` and re-render later via `xlibrary emit`.
- **Self-healing locators** — every recorded step carries an inline `# xlib:step=N;alts=[...]` comment with up to 3 ranked alternative selectors and a letter grade (A+ to D). The live viewer shows colored grade chips per step.
- **Re-record step** — `xlibrary patch <file>` replays the file up to a target step, lets you re-record it in the browser, and splices the result back in-place. Supports replace, insert-after/before, delete, and move across all four output languages.
- **Test Data Wizard** — `--extract-data` (post-record) or `xlibrary extract <file>` (standalone) detects literal values (emails, passwords, URLs), shows a diff preview, and extracts them into language-appropriate variable declarations.

---

## What it does

- Opens a real browser window with Playwright's visual recorder
- Captures every click, fill, navigation, and assertion as you interact
- Writes a ready-to-run file using your chosen output format
- Attaches alternative selectors and quality grades to every step
- Closes recording when you close the browser or press `Ctrl+C`

---

## Requirements

- Node.js **>= 20**

---

## Quickstart

```bash
# 1. First-time setup — download the Chromium binary (~150 MB, cached).
#    Skip this if you already have Playwright browsers installed.
npx xlibrary install

# 2. Record a session starting at a URL
npx xlibrary codegen https://example.com -o recorded.robot

# Or: emit a different format directly
npx xlibrary codegen https://example.com -l ts -o test.spec.ts --save-actions
```

> If you skip step 1 and run `codegen` directly, xlibrary will detect the
> missing binary and print the exact `install` command to run.

The browser opens. Interact with the page. Close the window (or press `Ctrl+C`). Your output file is ready:

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com
    Click    role=button[name="Get started"]    # xlib:step=1;alts=["css=.btn-primary","text=Get started"]
    Fill Text    role=textbox[name="Search"]    robot framework    # xlib:step=2
    Close Browser
```

> The `# xlib:step=N;alts=[...]` marker is added to every step automatically.
> It powers self-healing and `xlibrary patch`. Remove it with `sed '/# xlib:/d'` if you prefer clean output.

---

## Install

**Global install** (run from anywhere):

```bash
npm install -g xlibrary
xlibrary codegen https://example.com -o login.robot
```

**Local project** (no global install):

```bash
npm install --save-dev xlibrary
npx xlibrary codegen https://example.com -o login.robot
```

---

## Usage

### `xlibrary install [browsers...]`

Download Playwright browser binaries. Wraps `npx playwright install`.

```bash
npx xlibrary install                       # chromium (default)
npx xlibrary install firefox               # just firefox
npx xlibrary install chromium firefox      # multiple
npx xlibrary install --with-deps           # also install OS-level deps (Linux only)
```

### `xlibrary codegen [url] [options]`

Open a browser, record interactions, write an output file.

| Flag                    | Default          | Description                                                                  |
| ----------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `[url]`                 | _(none)_         | URL to open. Omit to navigate manually.                                      |
| `-o, --output <file>`   | `recorded.robot` | Output file path. Extension infers the target language when `-l` is omitted. |
| `-l, --lang <target>`   | _(inferred)_     | Output language: `robot` \| `selenium` \| `ts` \| `python`.                  |
| `-b, --browser <name>`  | `chromium`       | Browser: `chromium`, `firefox`, or `webkit`.                                 |
| `--test-name <name>`    | `Recorded Flow`  | Name of the generated test case.                                             |
| `--save-actions [file]` | _(off)_          | Save the raw action stream as a `.jsonl` artifact for later `emit` use.      |
| `--extract-data`        | _(off)_          | After recording ends, run the Test Data Wizard.                              |
| `--quiet`               | _(off)_          | Suppress the live keyword preview printed during recording.                  |
| `--open`                | _(off)_          | After recording ends, open the output file in your editor.                   |
| `--no-viewer`           | _(viewer on)_    | Disable the auxiliary live-viewer window (enabled by default).               |
| `--open-viewer`         | _(off)_          | Auto-open the viewer window in your browser at startup.                      |

**Language inference from `-o` extension:**

| Extension         | Target     |
| ----------------- | ---------- |
| `.robot`          | `robot`    |
| `.selenium.robot` | `selenium` |
| `.spec.ts`, `.ts` | `ts`       |
| `.py`             | `python`   |
| _(other)_         | `robot`    |

**Examples:**

```bash
# Record Robot Framework output with a custom test name
npx xlibrary codegen https://example.com/login -o login.robot --test-name "Login Flow"

# Record Playwright TypeScript output and save the action artifact
npx xlibrary codegen https://example.com -l ts -o tests/login.spec.ts --save-actions

# Record SeleniumLibrary output (inferred from extension)
npx xlibrary codegen https://example.com -o login.selenium.robot

# Record and immediately extract variables
npx xlibrary codegen https://example.com -o login.robot --save-actions --extract-data

# Use Firefox
npx xlibrary codegen https://example.com -b firefox -o firefox-test.robot
```

### `xlibrary emit <actions.jsonl> [options]`

Re-render a previously saved action artifact into a target language — no re-recording needed.

Supported targets in v0.2: `robot`, `selenium`. (`ts` and `python` require `xlibrary codegen -l ts/python` directly.)

| Flag                  | Required | Description                                        |
| --------------------- | -------- | -------------------------------------------------- |
| `-l, --lang <target>` | yes      | Output target: `robot` \| `selenium`.              |
| `-o, --output <file>` | yes      | Destination file path.                             |
| `--test-name <name>`  | no       | Override the test-case name from the JSONL header. |

```bash
# First, record and save the artifact
npx xlibrary codegen https://example.com/login -o login.robot --save-actions

# Re-emit as SeleniumLibrary (no browser needed)
npx xlibrary emit recorded.robot.jsonl -l selenium -o login.selenium.robot

# Re-emit as Robot Framework with a different test name
npx xlibrary emit recorded.robot.jsonl -l robot -o login-v2.robot --test-name "Login v2"
```

### `xlibrary extract <file> [options]`

Run the Test Data Wizard on an existing file. Detects literal values (emails, passwords, URLs), shows a diff preview, and extracts them into variables.

Requires a sidecar `.jsonl` from `--save-actions`, or pass `--actions <path>` to specify one explicitly.

| Flag                     | Default      | Description                                               |
| ------------------------ | ------------ | --------------------------------------------------------- |
| `-o, --output <file>`    | _(in-place)_ | Write to a separate file instead of editing in-place.     |
| `--yes`                  | _(off)_      | Skip the confirmation prompt and apply immediately.       |
| `-l, --lang <target>`    | _(inferred)_ | Override language inference from file extension.          |
| `--actions <jsonl-path>` | _(auto)_     | Override sidecar `.jsonl` path (default: `<file>.jsonl`). |

```bash
# Inspect what would be extracted (interactive prompt)
npx xlibrary extract login.robot

# Apply without prompting (for CI)
npx xlibrary extract login.robot --yes

# Write to a new file instead of editing in-place
npx xlibrary extract login.robot -o login-extracted.robot
```

Example output before extraction:

```robot
Fill Text    role=textbox[name="Email"]    qa@example.com    # xlib:step=2
Fill Text    role=textbox[name="Password"]    Hunter2!        # xlib:step=3
```

After extraction:

```robot
*** Variables ***
${VALID_EMAIL}       qa@example.com
${VALID_PASSWORD}    Hunter2!

*** Test Cases ***
Login Flow
    ...
    Fill Text    role=textbox[name="Email"]    ${VALID_EMAIL}    # xlib:step=2
    Fill Text    role=textbox[name="Password"]    ${VALID_PASSWORD}    # xlib:step=3
```

### `xlibrary patch <file> [options]`

Re-record one or more steps in an existing generated file. Requires `xlib:step=N` markers (present in all files generated by xlibrary >= 0.2.0).

| Flag                   | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `--at <id>`            | Replace step. `id` is a step number or fuzzy keyword content. |
| `--insert-after <id>`  | Record new steps to insert after step `id`.                   |
| `--insert-before <id>` | Record new steps to insert before step `id`.                  |
| `--delete <id>`        | Delete step or range (e.g. `5` or `3-7`).                     |
| `--move <spec>`        | Reorder steps — spec is `"<from> to <to>"`.                   |
| `--range <range>`      | Replace a range of steps — combine with `--at`.               |
| `--non-interactive`    | Fail-fast instead of pausing on replay failure.               |
| `--no-backup`          | Skip the `.bak` backup file.                                  |

```bash
# Replace step 5 by re-recording it in the browser
npx xlibrary patch login.robot --at 5

# Replace by fuzzy keyword content
npx xlibrary patch login.robot --at "Click Sign in"

# Delete steps 6 through 8
npx xlibrary patch login.robot --delete 6-8

# Insert new steps after step 3
npx xlibrary patch login.robot --insert-after 3

# Move step 2 to position 5
npx xlibrary patch login.robot --move "2 to 5"

# Replace without creating a backup
npx xlibrary patch login.robot --at 4 --no-backup
```

See [`docs/USAGE.md`](docs/USAGE.md) for the complete CLI reference and workflows.

---

## Targets section

### Robot Framework + Browser Library (default)

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com/login
    Fill Text    role=textbox[name="Email"]    ${VALID_EMAIL}    # xlib:step=2;alts=["label=Email","css=#email"]
    Click    role=button[name="Sign in"]    # xlib:step=3
    Close Browser
```

### SeleniumLibrary

```robot
*** Settings ***
Library    SeleniumLibrary

*** Test Cases ***
Login Flow
    Open Browser    https://example.com/login    Chrome
    Input Text    name:email    ${VALID_EMAIL}    # xlib:step=2
    Click Button    name:signin    # xlib:step=3
    Close Browser
```

### Playwright Test (TypeScript)

```ts
import { test, expect } from '@playwright/test';

test('Login Flow', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(VALID_EMAIL); // xlib:step=2;alts=["label=Email","css=#email"]
  await page.getByRole('button', { name: 'Sign in' }).click(); // xlib:step=3
});
```

### pytest-playwright (Python)

```python
def test_login_flow(page):
    page.goto("https://example.com/login")
    page.get_by_role("textbox", name="Email").fill(VALID_EMAIL)  # xlib:step=2
    page.get_by_role("button", name="Sign in").click()  # xlib:step=3
```

---

## Self-healing locators

Every recorded step carries a `# xlib:step=N;alts=[...]` inline comment. The `alts` list contains up to 3 ranked alternative selectors that can substitute for the primary if it breaks.

Selectors are graded A+ to D:

| Selector kind            | Grade |
| ------------------------ | ----- |
| `data-testid` / test-id  | A+    |
| `role` + accessible name | A     |
| `label` text             | A     |
| `placeholder` text       | B     |
| visible `text` content   | B     |
| CSS (id / class)         | C     |
| XPath                    | D     |

A grade is promoted one tier when the selector uniquely matches a single element on the page.

The live viewer (`--viewer`, enabled by default) shows the grade as a colored chip per step. Hover to expand the alternative list.

---

## Generated output format

Every recorded session produces a single file. For Robot Framework:

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
<test-name>
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    <url>
    <...recorded steps with xlib:step markers...>
    Close Browser
```

Selectors use Browser Library syntax — `role=`, `label=`, `css=`, `xpath=` — matching what the Playwright recorder captures.

When the recorder emits a role selector with the case-insensitive (substring) `i` flag — e.g. `internal:role=button[name="Sign in" i]` — the generator keeps the `internal:` prefix so the substring semantic is preserved. Exact-match selectors are emitted as the public `role=` form.

---

## Action to keyword mapping

<!-- generated:keyword-table -->

| Recorded action        | Browser Library keyword                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Open page              | `New Page    ${url}`                                                                       |
| Navigate               | `Go To    ${url}`                                                                          |
| Click                  | `Click    ${selector}`                                                                     |
| Double-click           | `Click    ${selector}    clickCount=2`                                                     |
| Modifier+Click         | `Keyboard Key    down    ${mod}` / `Click    ${selector}` / `Keyboard Key    up    ${mod}` |
| Fill input             | `Fill Text    ${selector}    ${text}`                                                      |
| Press key              | `Press Keys    ${selector}    ${key}`                                                      |
| Check checkbox         | `Check Checkbox    ${selector}`                                                            |
| Uncheck checkbox       | `Uncheck Checkbox    ${selector}`                                                          |
| Select option          | `Select Options By    ${selector}    value    ${option}`                                   |
| Hover                  | `Hover    ${selector}`                                                                     |
| Upload file            | `Upload File By Selector    ${selector}    ${path}` _(one call per file)_                  |
| Assert visible         | `Get Element States    ${selector}    *=    visible`                                       |
| Assert text (exact)    | `Get Text    ${selector}    ==    ${text}`                                                 |
| Assert text (contains) | `Get Text    ${selector}    *=    ${text}`                                                 |
| Assert input value     | `Get Property    ${selector}    value    ==    ${value}`                                   |
| Assert checkbox        | `Get Checkbox State    ${selector}    ==    checked`                                       |

Full mapping source: [`src/codegen/keywords-map.ts`](src/codegen/keywords-map.ts)

---

## Examples

- [Login flow](docs/examples/login.md)
- [Form submission](docs/examples/form-submit.md)
- [Navigation and assertions](docs/examples/navigation.md)
- [Record once, emit to multiple languages](docs/examples/multi-language.md)
- [Self-healing locators in action](docs/examples/self-healing.md)
- [Patch workflow — re-record a step](docs/examples/patch-workflow.md)
- [Extract test data variables](docs/examples/extract-data.md)

---

## Troubleshooting

### `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` when downloading Chromium

You are on a corporate/enterprise network with SSL inspection (Zscaler /
Cisco Umbrella / Forcepoint / Symantec / Palo Alto, etc.). The proxy re-signs
HTTPS traffic with an internal CA that's trusted by your OS — but Node's
bundled CA list doesn't know about it.

**Best fix (Node >= 22.10):** xlibrary automatically passes `--use-system-ca`
to the install step. If you're on Node 22.10+ and it's still failing, your IT
team probably hasn't installed the corp CA into the system keychain — ask
them for the `.pem` bundle and use the next option.

**Universal fix:** point Node at the corp CA file directly.

```bash
# If npm is already configured with a CA, reuse it:
NODE_EXTRA_CA_CERTS="$(npm config get cafile)" npx xlibrary install

# Or extract from macOS keychain:
security find-certificate -a -p /Library/Keychains/System.keychain > /tmp/corp-ca.pem
NODE_EXTRA_CA_CERTS=/tmp/corp-ca.pem npx xlibrary install
```

**Do NOT** set `NODE_TLS_REJECT_UNAUTHORIZED=0` outside one-off diagnostics —
it disables ALL cert validation and exposes you to real MITM attacks.

---

## Programmatic API (experimental)

> The CLI is the stable surface. The programmatic API is **experimental until
> 1.0** — pin an exact version (`xlibrary@0.1.6`) if you rely on it.

```ts
import { runRecorder } from 'xlibrary';
import { RobotFrameworkLanguageGenerator } from 'xlibrary/codegen';
import type { ActionInContext } from 'xlibrary/types';

// Record and write an output file (same as the CLI):
await runRecorder({
  url: 'https://example.com',
  output: 'recorded.robot',
  browser: 'chromium',
  testName: 'My Flow',
});

// Or feed actions through the generator yourself:
const gen = new RobotFrameworkLanguageGenerator('My Flow');
const header = gen.generateHeader({
  browserName: 'chromium',
  launchOptions: {},
  contextOptions: {},
});
const step = gen.generateAction(someAction as ActionInContext);
const footer = gen.generateFooter();
```

Sub-entries available:

| Import path         | What it exposes                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `xlibrary`          | High-level: `runRecorder`, `createReplayController`, generator classes                                                  |
| `xlibrary/codegen`  | Generators + utilities: `RobotFrameworkLanguageGenerator`, `translateSelector`, `escapeRobotValue`, `ACTION_TO_KEYWORD` |
| `xlibrary/recorder` | Recorder orchestrator: `runRecorder`                                                                                    |
| `xlibrary/types`    | All public types: `Action`, `ActionInContext`, `ActionName`, options                                                    |

---

## Documentation

- [CLI reference](docs/USAGE.md) — all flags, common workflows, troubleshooting
- [Contributing](CONTRIBUTING.md) — repo layout, adding new action mappings, running tests
- [Architecture](docs/architecture-recorder-flow.md) — how the recorder and code generator work together
- [Security policy](SECURITY.md) — reporting vulnerabilities, trust boundaries

---

## License

[MIT](LICENSE) © Tassana Khrueawan
