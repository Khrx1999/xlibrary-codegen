# Example: Login Flow

Records a username + password login and verifies the user lands on the dashboard.

**Source file:** [`examples/login.robot`](../../examples/login.robot)

---

## Command

```bash
npx xlibrary codegen https://example.com/login \
  -o login.robot \
  --test-name "Login Flow"
```

---

## Generated output

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com/login

    Fill Text    role=textbox[name="Email"]    user@example.com
    Fill Text    role=textbox[name="Password"]    supersecret
    Click    role=button[name="Sign in"]

    Get Text    role=heading[level=1]    ==    Dashboard
    Get Element States    role=link[name="Logout"]    *=    visible
    Close Browser
```

---

## Step-by-step walkthrough

### Header boilerplate

```robot
*** Settings ***
Library    Browser
```

The `*** Settings ***` section imports Browser Library. This is always emitted — the Library keyword enables all Browser Library keywords in the test.

```robot
*** Test Cases ***
Login Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
```

- `New Browser` — launches Chromium in headed mode (always `headless=${False}` for recorded sessions). The `args=["--start-maximized"]` flag is emitted for Chromium only so the recorder window fills the real screen.
- `New Context` — opens a fresh browser context (isolated cookies, localStorage). `viewport=None` makes the page fill the actual window instead of Playwright's default `1280×720`.

### Open the target page

```robot
    New Page    https://example.com/login
```

`New Page` navigates to the starting URL. If you started the recording with a URL argument, it appears here. Without a URL argument, this line is absent and the first `Go To` appears instead.

### Fill the email field

```robot
    Fill Text    role=textbox[name="Email"]    user@example.com
```

- **Keyword:** `Fill Text` — clears the field and types the value instantly (no keystroke-by-keystroke simulation)
- **Selector:** `role=textbox[name="Email"]` — targets an `<input>` by ARIA role + accessible name
- **Value:** `user@example.com` — the text recorded from your keystrokes

Role selectors (`role=`) are preferred over CSS because they remain stable even when HTML structure changes.

### Fill the password field

```robot
    Fill Text    role=textbox[name="Password"]    supersecret
```

Same pattern. The password field is also a `textbox` role with name `"Password"`.

### Click the submit button

```robot
    Click    role=button[name="Sign in"]
```

`Click` triggers a left mouse click. The selector targets the submit button by its accessible name. Browser Library automatically waits for the page to be ready before clicking.

### Assert the heading text

```robot
    Get Text    role=heading[level=1]    ==    Dashboard
```

- **Keyword:** `Get Text` — reads the visible text of an element
- **Assertion operator:** `==` means exact match (as opposed to `*=` for "contains")
- **Expected value:** `Dashboard` — verifies the user landed on the right page

This assertion was added using the recorder's **Assert** toolbar button.

### Assert the logout link is visible

```robot
    Get Element States    role=link[name="Logout"]    *=    visible
```

- **Keyword:** `Get Element States` — returns a set of state flags for the element
- **Assertion operator:** `*=` means "set contains" — checks that `visible` is in the returned states
- Confirms the logout link exists and is visible, which means the user is logged in

---

## Adapting this example

**Different credentials:** Replace the hardcoded values with Robot Framework variables:

```robot
*** Variables ***
${EMAIL}      user@example.com
${PASSWORD}   supersecret

*** Test Cases ***
Login Flow
    ...
    Fill Text    role=textbox[name="Email"]    ${EMAIL}
    Fill Text    role=textbox[name="Password"]    ${PASSWORD}
    ...
```

**Different selectors:** If `role=textbox[name="Email"]` doesn't match your page, use the recorder's inspect mode to find the correct selector, or fall back to CSS:

```robot
    Fill Text    css=#email-input    user@example.com
```

**Run the test:**

```bash
pip install robotframework robotframework-browser
rfbrowser init
robot login.robot
```
