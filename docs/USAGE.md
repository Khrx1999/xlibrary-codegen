# CLI Usage Reference

> Full reference for the `xlibrary` command.

---

## Synopsis

```
xlibrary codegen [url] [options]
```

`url` is optional. When omitted, the browser opens at a blank page and you can navigate manually.

---

## Flags

| Flag                   | Type         | Default          | Description                                                                                                                                                                 |
| ---------------------- | ------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[url]`                | positional   | _(none)_         | URL to open when the browser launches. Supports `https://`, `http://`, and `file://` schemes. Bare domains (e.g. `example.com`) are prefixed with `https://` automatically. |
| `-o, --output <file>`  | string       | `recorded.robot` | Path for the generated `.robot` file. Directories must already exist.                                                                                                       |
| `-b, --browser <name>` | string       | `chromium`       | Browser engine to use. Accepted values: `chromium`, `firefox`, `webkit`.                                                                                                    |
| `--test-name <name>`   | string       | `Recorded Flow`  | Name of the test case written inside the `.robot` file.                                                                                                                     |
| `--quiet`              | boolean flag | _(off)_          | Suppress the live keyword preview printed to the terminal during recording. The output file is still updated.                                                               |
| `--open`               | boolean flag | _(off)_          | After the recording session ends, open the generated `.robot` file in your default editor (VS Code preferred; falls back to the OS default).                                |
| `--no-viewer`          | boolean flag | _(viewer on)_    | Disable the auxiliary live-viewer browser window that shows the `.robot` output syntax-highlighted and refreshed via WebSocket. The viewer is enabled by default.           |
| `--headed`             | boolean flag | _(always on)_    | Recording always runs in headed mode. This flag is accepted but has no effect.                                                                                              |

---

## Flag details

### `[url]`

The URL to open when the browser starts.

```bash
# Opens https://playwright.dev/docs
npx xlibrary codegen https://playwright.dev/docs -o docs.robot

# Bare domain — automatically becomes https://example.com
npx xlibrary codegen example.com -o example.robot

# No URL — browser opens blank; navigate manually before recording
npx xlibrary codegen -o manual.robot
```

### `-o, --output <file>`

Path where the `.robot` file is written.

- The file is **updated incrementally** every ~400 ms as you record, so you can inspect it live.
- On `Ctrl+C` or browser close, a final flush writes the complete file.
- The parent directory must exist. `xlibrary` will not create directories.

```bash
npx xlibrary codegen https://example.com -o tests/robot/login.robot
```

### `-b, --browser <name>`

Controls which browser engine Playwright launches.

| Value      | Browser                            |
| ---------- | ---------------------------------- |
| `chromium` | Google Chrome-compatible (default) |
| `firefox`  | Mozilla Firefox                    |
| `webkit`   | Safari-compatible                  |

Each browser engine must be installed separately:

```bash
npx playwright install chromium
npx playwright install firefox
npx playwright install webkit
```

```bash
npx xlibrary codegen https://example.com -b firefox -o firefox-test.robot
npx xlibrary codegen https://example.com -b webkit  -o safari-test.robot
```

### `--test-name <name>`

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

### `--quiet`

By default, every newly-captured keyword is printed inside a Unicode-box preview on the terminal so you can verify the recording in real time:

```
┌─ Generated keyword ───────────────────────────────────
│     Click    role=button[name="Sign in"]
└───────────────────────────────────────────────────────
```

Pass `--quiet` to suppress this preview when you only want the final file written.

### `--open`

When the recording ends (browser closed or `Ctrl+C`), the output file is opened automatically in your default editor.

```bash
npx xlibrary codegen https://example.com -o login.robot --open
```

VS Code is preferred when available (`code <file>` on `PATH`). Otherwise the OS-default action for `.robot` files is used.

### `--no-viewer`

While recording, `xlibrary` also opens a small auxiliary browser window that shows the generated `.robot` content with syntax highlighting, refreshed live via WebSocket. Pass `--no-viewer` to disable it (useful in headless environments or when you only need the file).

```bash
npx xlibrary codegen https://example.com -o login.robot --no-viewer
```

---

## Recording session

1. Run the command — the browser opens with a purple recording toolbar at the top.
2. Interact with the page: click, type, select, hover, check.
3. Use the "Assert" toolbar in the recorder to add assertions.
4. Close the browser window **or** press `Ctrl+C` in the terminal.
5. The `.robot` file is saved.

```
🤖 Robot Codegen — recording in progress
   Mode    : JSONL bridge
   Output  : login.robot
   Preview : on — each recorded keyword prints below
   Close the browser window or press Ctrl+C to finish.

⏹  Browser closed — saving output…
✅  Saved: login.robot
```

### Recording modes

`xlibrary` runs in one of two modes (the choice is automatic):

| Mode             | When                                               | What happens                                                                                                                                           |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Direct**       | `playwright-core` was installed from source (rare) | Playwright Inspector's "Target:" dropdown is patched to include "Robot Framework / Browser Library", and the recorder writes the `.robot` file itself. |
| **JSONL bridge** | Standard npm-bundled `playwright-core` (default)   | The recorder writes raw JSONL into a temp file; `xlibrary` translates it to Robot Framework on every poll.                                             |

Both modes produce the same `.robot` output. The mode is printed at startup (`Mode : ...`).

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
    Fill Text    role=textbox[name="Email"]    user@example.com
    Fill Text    role=textbox[name="Password"]    secret
    Click    role=button[name="Sign in"]
    Get Text    role=heading[level=1]    ==    Dashboard
    Close Browser
```

### Record a form submission

```bash
npx xlibrary codegen https://example.com/register \
  -o register.robot \
  --test-name "Registration Form"
```

### Record across multiple pages (manual navigation)

Start without a URL, navigate yourself, and record the full multi-page journey:

```bash
npx xlibrary codegen -o checkout.robot --test-name "E-Commerce Checkout"
```

The tool captures `Go To` keywords for every navigation.

### Record in Firefox

```bash
npx playwright install firefox   # one-time setup
npx xlibrary codegen https://example.com -b firefox -o firefox-test.robot
```

### Save to a specific directory

```bash
# directory must already exist
mkdir -p tests/robot
npx xlibrary codegen https://example.com -o tests/robot/smoke.robot
```

---

## Output file anatomy

Every generated `.robot` file has this structure:

```robot
*** Settings ***
Library    Browser                                                # Browser Library import

*** Test Cases ***
<test-name>                                                       # from --test-name flag
    New Browser    chromium    headless=${False}    args=["--start-maximized"]   # browser setup
    New Context    viewport=None                                  # context setup (viewport=None lets the page fill the actual window)
    New Page    <url>                                             # first navigation (if URL provided)
    <...recorded actions...>                                      # your interactions
    Close Browser                                                 # teardown
```

### Built-in defaults

The generator emits two opinionated defaults that match how the recorder actually runs:

- `args=["--start-maximized"]` — emitted for **chromium only**; Firefox and WebKit ignore Chromium command-line flags so the arg is omitted for them.
- `viewport=None` — emitted on every `New Context` call (unless the caller explicitly supplied a viewport) so the page fills the real window rather than the default `1280×720`.

If you pass explicit `contextOptions.viewport` via the underlying API, the explicit value wins and `viewport=None` is skipped.

### `openPage(about:blank) + navigate` collapse

The Playwright recorder always emits two actions when the browser opens at a URL:

1. `openPage(url="about:blank")` — the implicit first tab,
2. `navigate(url=<your URL>)` — the real navigation.

The generator collapses this pair into a single `New Page <url>` keyword so the test reads naturally. If any other action occurs between the two (e.g. a click on the blank page), the collapse window cancels and the subsequent `navigate` is emitted as a regular `Go To <url>`.

### Selector syntax

Selectors use Browser Library's supported formats. The code generator prefers semantic selectors:

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

Some recorder actions have no direct Browser Library equivalent. These are emitted as comments:

```robot
    # TODO: assertSnapshot not supported — ariaSnapshot: ...
```

Review `# TODO:` lines after recording and replace them with appropriate Robot Framework keywords.

### Signals (navigation, popup, download, dialog)

Recorded actions sometimes carry **signals** — side-effects that happen alongside the action:

| Signal       | Output                                    | Notes                                                                            |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `navigation` | `# Navigation to: <url>`                  | Informational comment only — Browser Library waits for navigation automatically. |
| `popup`      | `# TODO: Capture popup page (alias: ...)` | A new page/tab opened; add `Wait For New Page` manually.                         |
| `download`   | `# TODO: Handle download (alias: ...)`    | A file download started; add `Wait For Download` manually.                       |
| `dialog`     | `# TODO: Handle dialog signal "..."`      | A JS `alert`/`confirm`/`prompt` appeared; add `Handle Alert` BEFORE the action.  |

---

## Running the generated file

The generated `.robot` file requires [Robot Framework](https://robotframework.org/) and [Browser Library](https://github.com/MarketSquare/robotframework-browser) to run.

**Install:**

```bash
pip install robotframework
pip install robotframework-browser
rfbrowser init
```

**Run:**

```bash
robot login.robot
```

**Dry-run** (syntax check only):

```bash
robot --dryrun login.robot
```

---

## Troubleshooting

### `Error: browserType.launch: Executable doesn't exist`

Playwright browsers are not installed. Run:

```bash
npx playwright install chromium
```

### The browser opens but recording toolbar is missing

The toolbar is provided by Playwright's recorder UI. This should appear automatically. If missing:

1. Ensure `playwright-core` is properly installed: `npm install`
2. Try a fresh browser install: `npx playwright install --force chromium`

### The `.robot` file is empty or only has the header

This means the browser was closed before any actions were recorded, or only `about:blank` was visited. Record at least one interaction before closing.

### `xlibrary: command not found`

Install globally or use `npx`:

```bash
npm install -g xlibrary
# or
npx xlibrary codegen ...
```

### Output has `# TODO:` comments

Some recorded actions (`assertSnapshot`, popup/download/dialog signals) have no direct Browser Library equivalent. Review those lines and replace them with the appropriate keywords. See the [Browser Library keyword reference](https://marketsquare.github.io/robotframework-browser/Browser.html).
