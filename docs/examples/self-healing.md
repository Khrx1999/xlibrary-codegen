# Example: Self-Healing Locators

Every step recorded by xlibrary >= 0.2.0 carries a `# xlib:step=N;alts=[...]`
inline comment. The comment encodes a step counter (for `xlibrary patch`) and
up to three ranked alternative selectors. If the primary selector breaks after
a UI change, the alternatives are ready to substitute.

---

## How the markers appear in output

### Robot Framework

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com/login

    Fill Text    role=textbox[name="Email"]    user@example.com    # xlib:step=1;alts=["label=Email address","css=#email-input"]
    Fill Text    role=textbox[name="Password"]    secret    # xlib:step=2;alts=["label=Password","css=#password-input"]
    Click    role=button[name="Sign in"]    # xlib:step=3;alts=["css=.btn-signin","text=Sign in"]
    Get Text    role=heading[level=1]    ==    Dashboard    # xlib:step=4
    Close Browser
```

- **Step 1** — primary `role=textbox[name="Email"]` has two alternatives: a `label=` form and a CSS `#id` fallback.
- **Step 2** — same pattern for password.
- **Step 3** — button click has a CSS class and text fallback.
- **Step 4** — heading assertion has no alternatives (no `alts=` clause, only `xlib:step=N`).

### TypeScript (Playwright Test)

```ts
test('Login Flow', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com'); // xlib:step=1;alts=["label=Email address","css=#email-input"]
  await page.getByRole('textbox', { name: 'Password' }).fill('secret'); // xlib:step=2;alts=["label=Password","css=#password-input"]
  await page.getByRole('button', { name: 'Sign in' }).click(); // xlib:step=3;alts=["css=.btn-signin","text=Sign in"]
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard'); // xlib:step=4
});
```

The comment prefix changes to `//` for TypeScript. The payload format is identical.

---

## Quality grades

Each alternative selector is graded before emission. The primary is the
highest-graded candidate; the `alts` array lists the next best ones.

| Selector kind              | Base grade |
| -------------------------- | ---------- |
| `data-testid` / test-id    | A+         |
| `role` + accessible name   | A          |
| `label` text               | A          |
| `placeholder` text         | B          |
| visible `text` content     | B          |
| CSS (id, class, attribute) | C          |
| XPath                      | D          |

A grade is promoted one tier when the selector uniquely matches exactly one
element on the live page. For example, a `css=[type=email]` that is the only
email input on the page is promoted from C to B.

### Reading the grade from the output

The inline comment does not include the grade letter directly — grades are
computed at record time and used to order the selectors in `alts`. The first
item in `alts` is always the second-best candidate, the second item is
third-best, and so on.

The **live viewer** shows the grade as a colored chip next to each step:

```
A+  [data-testid="email"]
A   role=textbox[name="Email"]         <-- primary
A   label=Email address                <-- alt 1
C   css=#email-input                   <-- alt 2
```

---

## Viewer badge display

When recording with `--viewer` (on by default), a small browser window opens
alongside the recorder. Each emitted step shows:

```
Step 1   A   Fill Text    role=textbox[name="Email"]
         Alternatives (hover to expand):
           A  label=Email address
           C  css=#email-input

Step 2   A   Fill Text    role=textbox[name="Password"]
         Alternatives (hover to expand):
           A  label=Password
           C  css=#password-input

Step 3   A   Click    role=button[name="Sign in"]
         Alternatives (hover to expand):
           C  css=.btn-signin
           B  text=Sign in
```

Grade chip colors:

- **A+ / A** — green
- **B** — yellow
- **C** — orange
- **D** — red

The viewer is view-only in v0.2 — clicking an alternative does not override the
primary in the file. Use `xlibrary patch --at <step>` to re-record a step with
a different primary selector.

---

## Stripping markers

If you prefer clean output without the inline comments:

```bash
# macOS/BSD
sed -i '' 's/[[:space:]]*# xlib:[^[:space:]]*//' login.robot

# GNU/Linux
sed -i 's/[[:space:]]*# xlib:[^[:space:]]*//' login.robot
```

After stripping, `xlibrary patch` can no longer address steps by number.
Re-record the file from scratch or keep a pre-strip copy.

---

## Using alternatives manually

If the primary selector breaks, copy an alternative from the `alts` list and
replace the primary:

Before (broken):

```robot
    Click    role=button[name="Sign in"]    # xlib:step=3;alts=["css=.btn-signin","text=Sign in"]
```

After (manually healed to the first alternative):

```robot
    Click    css=.btn-signin    # xlib:step=3
```

Or re-record the step cleanly:

```bash
npx xlibrary patch login.robot --at 3
```
