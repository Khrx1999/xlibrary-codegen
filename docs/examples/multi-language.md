# Example: Record Once, Emit to Multiple Languages

Record a login flow once, save the action artifact, then render it as Robot
Framework, SeleniumLibrary, Playwright Test (TypeScript), and pytest (Python)
without opening the browser again.

---

## Step 1 — Record and save the artifact

```bash
npx xlibrary codegen https://example.com/login \
  -o login.robot \
  --test-name "Login Flow" \
  --save-actions
```

This produces two files:

```
login.robot           Robot Framework output (default target)
login.robot.jsonl     Raw action artifact
```

The artifact starts with an xlibrary header:

```jsonl
{"xlib":1,"recorded-at":"2026-05-22T10:00:00.000Z","browser":"chromium","test-name":"Login Flow"}
{"actions":[{"name":"openPage","url":"about:blank",...}]}
...
```

---

## Step 2 — Re-emit as SeleniumLibrary (no browser needed)

```bash
npx xlibrary emit login.robot.jsonl \
  -l selenium \
  -o login.selenium.robot
```

Output:

```robot
*** Settings ***
Library    SeleniumLibrary

*** Test Cases ***
Login Flow
    Open Browser    https://example.com/login    Chrome
    Input Text    name:email    user@example.com    # xlib:step=1
    Input Password    name:password    supersecret    # xlib:step=2
    Click Button    name:signin    # xlib:step=3
    Element Should Be Visible    id:dashboard-heading    # xlib:step=4
    Close Browser
```

---

## Step 3 — Emit TypeScript directly during recording

`xlibrary emit` does not support `ts` or `python` in v0.2 — for those
targets, specify the language at record time:

```bash
npx xlibrary codegen https://example.com/login \
  -l ts \
  -o tests/login.spec.ts \
  --save-actions
```

Output (`tests/login.spec.ts`):

```ts
import { test, expect } from '@playwright/test';

test('Login Flow', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com'); // xlib:step=1;alts=["label=Email","css=#email"]
  await page.getByRole('textbox', { name: 'Password' }).fill('supersecret'); // xlib:step=2
  await page.getByRole('button', { name: 'Sign in' }).click(); // xlib:step=3
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard'); // xlib:step=4
});
```

---

## Step 4 — Emit Python directly during recording

```bash
npx xlibrary codegen https://example.com/login \
  -l python \
  -o tests/test_login.py \
  --save-actions
```

Output (`tests/test_login.py`):

```python
def test_login_flow(page):
    page.goto("https://example.com/login")
    page.get_by_role("textbox", name="Email").fill("user@example.com")  # xlib:step=1;alts=["label=Email","css=#email"]
    page.get_by_role("textbox", name="Password").fill("supersecret")  # xlib:step=2
    page.get_by_role("button", name="Sign in").click()  # xlib:step=3
    assert page.get_by_role("heading", level=1).text_content() == "Dashboard"  # xlib:step=4
```

---

## Language support matrix

| Target     | Via `xlibrary codegen -l` | Via `xlibrary emit` |
| ---------- | ------------------------- | ------------------- |
| `robot`    | Yes                       | Yes                 |
| `selenium` | Yes                       | Yes                 |
| `ts`       | Yes (direct mode)         | Not in v0.2         |
| `python`   | Yes (direct mode)         | Not in v0.2         |

`ts` and `python` require the bundle patch to succeed. If your `playwright-core`
version is not yet supported, use `-l robot` and re-emit when a patch is available.

---

## Extension inference

You can omit `-l` entirely and let the file extension determine the target:

```bash
# robot (from .robot)
npx xlibrary codegen https://example.com -o login.robot

# selenium (from .selenium.robot)
npx xlibrary codegen https://example.com -o login.selenium.robot

# TypeScript (from .spec.ts)
npx xlibrary codegen https://example.com -o tests/login.spec.ts

# Python (from .py)
npx xlibrary codegen https://example.com -o tests/test_login.py
```

---

## Running each output format

### Robot Framework

```bash
pip install robotframework robotframework-browser
rfbrowser init
robot login.robot
```

### SeleniumLibrary

```bash
pip install robotframework robotframework-seleniumlibrary
robot login.selenium.robot
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
