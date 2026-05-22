# Example: Extract Test Data Variables

The Test Data Wizard detects hardcoded literal values in a recorded test file —
emails, passwords, URLs, phone numbers — and extracts them into named variables
in the appropriate section for the output language.

---

## Two ways to run it

### During recording (`--extract-data`)

```bash
npx xlibrary codegen https://example.com/login \
  -o login.robot \
  --save-actions \
  --extract-data
```

When the browser closes, the wizard runs automatically and prompts for confirmation.

### On an existing file (`xlibrary extract`)

```bash
npx xlibrary extract login.robot
```

Requires a sidecar `.jsonl` from `--save-actions`. If you didn't save the
artifact at record time, re-record with `--save-actions`:

```bash
npx xlibrary codegen https://example.com/login \
  -o login.robot \
  --save-actions
npx xlibrary extract login.robot
```

---

## Before extraction

Starting file (`login.robot`):

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://app.example.com/login
    Fill Text    role=textbox[name="Email"]    qa@example.com    # xlib:step=1;alts=["label=Email","css=#email"]
    Fill Text    role=textbox[name="Password"]    Hunter2!    # xlib:step=2;alts=["label=Password","css=#password"]
    Click    role=button[name="Sign in"]    # xlib:step=3
    Get Text    role=heading[level=1]    ==    Dashboard    # xlib:step=4
    Close Browser
```

---

## Interactive session

```bash
npx xlibrary extract login.robot
```

Output:

```
--- Detected 3 variables ---------------------------------
- ${VALID_EMAIL}       = "qa@example.com"    (1 site)
- ${VALID_PASSWORD}    = "Hunter2!"          (1 site)
- ${BASE_URL}          = "https://app.example.com"    (1 site)
--- Diff preview -----------------------------------------
+*** Variables ***
+${VALID_EMAIL}       qa@example.com
+${VALID_PASSWORD}    Hunter2!
+${BASE_URL}          https://app.example.com
+
 *** Settings ***
 Library    Browser

 *** Test Cases ***
 Login Flow
     ...
-    New Page    https://app.example.com/login
+    New Page    ${BASE_URL}/login
-    Fill Text    role=textbox[name="Email"]    qa@example.com
+    Fill Text    role=textbox[name="Email"]    ${VALID_EMAIL}
-    Fill Text    role=textbox[name="Password"]    Hunter2!
+    Fill Text    role=textbox[name="Password"]    ${VALID_PASSWORD}
     ...
Apply? [Y/n]
```

Press `Y` (or `Enter`) to apply. Press `n` to cancel.

---

## After extraction

```robot
*** Variables ***
${VALID_EMAIL}       qa@example.com
${VALID_PASSWORD}    Hunter2!
${BASE_URL}          https://app.example.com

*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    ${BASE_URL}/login
    Fill Text    role=textbox[name="Email"]    ${VALID_EMAIL}    # xlib:step=1;alts=["label=Email","css=#email"]
    Fill Text    role=textbox[name="Password"]    ${VALID_PASSWORD}    # xlib:step=2;alts=["label=Password","css=#password"]
    Click    role=button[name="Sign in"]    # xlib:step=3
    Get Text    role=heading[level=1]    ==    Dashboard    # xlib:step=4
    Close Browser
```

The `*** Variables ***` section is inserted above `*** Settings ***`. All
three literal values are replaced with variable references throughout the file.

---

## Backup

The original file is preserved as `login.robot.bak` before any change is
written. To restore:

```bash
cp login.robot.bak login.robot
```

---

## Skip confirmation (unattended)

For CI pipelines, pass `--yes` to apply without prompting:

```bash
npx xlibrary extract login.robot --yes
```

Or combine with `--extract-data` at record time:

```bash
npx xlibrary codegen https://example.com/login \
  -o login.robot \
  --save-actions \
  --extract-data
```

The `--extract-data` flag always prompts interactively. For fully unattended
extraction, use `xlibrary extract --yes` as a separate step.

---

## Write to a separate file

```bash
npx xlibrary extract login.robot -o login-parametrized.robot
```

When `-o` is given, the source file is not modified and no `.bak` is written.

---

## Override language

By default the language is inferred from the file extension. Override it:

```bash
npx xlibrary extract tests/login.robot -l selenium
```

---

## Detection logic

### Field context (priority)

The wizard reads the field context from the action stream (sidecar `.jsonl`),
not the output file. This lets it identify variable semantics:

| Selector signal                   | Variable name      |
| --------------------------------- | ------------------ |
| `[type=email]`                    | `VALID_EMAIL`      |
| `[type=password]`                 | `VALID_PASSWORD`   |
| `[type=tel]`                      | `VALID_PHONE`      |
| `[autocomplete=username]`         | `USERNAME`         |
| `[autocomplete=current-password]` | `CURRENT_PASSWORD` |
| `[name=email]` or similar         | `EMAIL`            |

### Value regex (fallback)

When no field context is available, the wizard falls back to value-shape matching:

| Value shape          | Variable name         |
| -------------------- | --------------------- |
| URL (`https?://...`) | `BASE_URL` or `URL_N` |
| Email shape (`@`)    | `EMAIL_N`             |

### Deduplication

- Same value at multiple sites → single variable, all sites reference it.
- Different values for the same semantic category → numbered suffix:
  `VALID_EMAIL`, `VALID_EMAIL_2`, `VALID_EMAIL_3`, etc.

---

## Per-language variable output

### Robot Framework and SeleniumLibrary (`.robot`)

```robot
*** Variables ***
${VALID_EMAIL}       qa@example.com
${VALID_PASSWORD}    Hunter2!
```

Variables are inserted in a `*** Variables ***` section above `*** Test Cases ***`.

### TypeScript (`.spec.ts`, `.ts`)

```ts
const VALID_EMAIL = 'qa@example.com';
const VALID_PASSWORD = 'Hunter2!';

import { test, expect } from '@playwright/test';

test('Login Flow', async ({ page }) => {
  ...
  await page.getByRole('textbox', { name: 'Email' }).fill(VALID_EMAIL);
  ...
});
```

Constants are inserted at the top of the file, before the first `import`.

### Python (`.py`)

```python
VALID_EMAIL = "qa@example.com"
VALID_PASSWORD = "Hunter2!"


def test_login_flow(page):
    ...
    page.get_by_role("textbox", name="Email").fill(VALID_EMAIL)
    ...
```

Module-level constants are inserted above the first `def test_` function.

---

## Multiple test cases

When the file contains multiple test cases that share the same email address,
the wizard uses a single variable for all occurrences:

```robot
*** Variables ***
${VALID_EMAIL}    qa@example.com

*** Test Cases ***
Login Flow
    Fill Text    role=textbox[name="Email"]    ${VALID_EMAIL}    # xlib:step=1

Update Profile
    Fill Text    role=textbox[name="Email"]    ${VALID_EMAIL}    # xlib:step=2
```
