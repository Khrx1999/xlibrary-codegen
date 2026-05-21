# xlibrary

Record browser interactions and generate [Robot Framework](https://robotframework.org/) + [Browser Library](https://github.com/MarketSquare/robotframework-browser) `.robot` files — powered by [Playwright](https://playwright.dev/).

[![npm version](https://img.shields.io/npm/v/xlibrary)](https://www.npmjs.com/package/xlibrary)
[![node](https://img.shields.io/node/v/xlibrary)](https://nodejs.org/)
[![license](https://img.shields.io/npm/l/xlibrary)](https://github.com/Khrx1999/xlibrary/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/xlibrary)](https://www.npmjs.com/package/xlibrary)

---

## What it does

- Opens a real browser window with Playwright's visual recorder
- Captures every click, fill, navigation, and assertion as you interact
- Writes a ready-to-run `.robot` file using Browser Library keywords
- Closes recording when you close the browser or press `Ctrl+C`

---

## Requirements

- Node.js **≥ 20**

---

## Quickstart

```bash
# 1️⃣  First-time setup — download the Chromium binary (~150 MB, cached).
#     Skip this if you already have Playwright browsers installed.
npx xlibrary install

# 2️⃣  Record a session starting at a URL
npx xlibrary codegen https://example.com -o recorded.robot

# Or: open a blank browser and navigate manually
npx xlibrary codegen -o recorded.robot
```

> 💡 If you skip step 1 and run `codegen` directly, xlibrary will detect the
> missing binary and print the exact `install` command to run.

The browser opens. Interact with the page. Close the window (or press `Ctrl+C`). Your `.robot` file is ready:

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com
    Click    role=button[name="Get started"]
    Fill Text    role=textbox[name="Search"]    robot framework
    Close Browser
```

> The Chromium default `args=["--start-maximized"]` and `viewport=None` make the
> recorded browser fill the real screen so selectors reflect the actual viewport.
> Firefox and WebKit do not receive `args=["--start-maximized"]` (Chromium-only flag).

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

Open a browser, record interactions, write a `.robot` file.

| Flag                   | Default          | Description                                                        |
| ---------------------- | ---------------- | ------------------------------------------------------------------ |
| `[url]`                | _(none)_         | URL to open. Omit to navigate manually.                            |
| `-o, --output <file>`  | `recorded.robot` | Output `.robot` file path                                          |
| `-b, --browser <name>` | `chromium`       | Browser: `chromium`, `firefox`, or `webkit`                        |
| `--test-name <name>`   | `Recorded Flow`  | Name of the generated test case                                    |
| `--quiet`              | _(off)_          | Suppress the live keyword preview printed during recording         |
| `--open`               | _(off)_          | After recording ends, open the output `.robot` file in your editor |
| `--no-viewer`          | _(viewer on)_    | Disable the auxiliary live-viewer window (enabled by default)      |

**Examples:**

```bash
# Record with a custom test name
npx xlibrary codegen https://example.com/login -o login.robot --test-name "Login Flow"

# Use Firefox
npx xlibrary codegen https://example.com -b firefox -o firefox-test.robot

# Open blank browser, navigate manually, save to custom path
npx xlibrary codegen -o tests/my-flow.robot --test-name "My Flow"
```

See [`docs/USAGE.md`](docs/USAGE.md) for the complete CLI reference and workflows.

---

## Generated output format

Every recorded session produces a single `.robot` file:

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
<test-name>
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    <url>
    <...recorded steps...>
    Close Browser
```

Selectors use semantic Browser Library syntax — `role=`, `label=`, `css=`, `xpath=` — matching what the Playwright recorder captures.

When the recorder emits a role selector with the case-insensitive (substring) `i` flag — e.g. `internal:role=button[name="Sign in" i]` — the generator keeps the `internal:` prefix so the substring semantic is preserved. Exact-match selectors are emitted as the public `role=` form.

---

## Action → keyword mapping

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

---

## Troubleshooting

### `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` when downloading Chromium

You are on a corporate/enterprise network with SSL inspection (Zscaler /
Cisco Umbrella / Forcepoint / Symantec / Palo Alto, etc.). The proxy re-signs
HTTPS traffic with an internal CA that's trusted by your OS — but Node's
bundled CA list doesn't know about it.

**Best fix (Node ≥ 22.10):** xlibrary automatically passes `--use-system-ca`
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

> ⚠ The CLI is the stable surface. The programmatic API is **experimental until
> 1.0** — pin an exact version (`xlibrary@0.1.6`) if you rely on it.

```ts
import { runRecorder } from 'xlibrary';
import { RobotFrameworkLanguageGenerator } from 'xlibrary/codegen';
import type { ActionInContext } from 'xlibrary/types';

// Record and write a .robot file (same as the CLI):
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
