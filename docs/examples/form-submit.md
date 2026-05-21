# Example: Form Submission

Records a multi-field registration form: text inputs, a dropdown, a checkbox, a file upload, and post-submit assertions.

**Source file:** [`examples/form-submit.robot`](../../examples/form-submit.robot)

---

## Command

```bash
npx xlibrary codegen https://example.com/register \
  -o form-submit.robot \
  --test-name "Form Submission"
```

---

## Generated output

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
Form Submission
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com/register

    Fill Text    role=textbox[name="First Name"]    Alice
    Fill Text    role=textbox[name="Last Name"]     Smith
    Fill Text    label=Email address                alice@example.com

    Select Options By    role=combobox[name="Country"]    text    Australia

    Check Checkbox    role=checkbox[name="I agree to the terms and conditions"]

    Upload File By Selector    css=input[type="file"]    ${CURDIR}/fixtures/avatar.png

    Click    role=button[name="Create Account"]

    Get Text    role=heading[level=1]    ==    Account Created
    Get Property    role=textbox[name="Email"]    value    ==    alice@example.com
    Close Browser
```

---

## Step-by-step walkthrough

### Fill text fields

```robot
    Fill Text    role=textbox[name="First Name"]    Alice
    Fill Text    role=textbox[name="Last Name"]     Smith
```

Both use `role=textbox` with the field's accessible name. The recorder picks this selector because it maps directly to the HTML `<input>` associated with the `<label>First Name</label>`.

```robot
    Fill Text    label=Email address    alice@example.com
```

When a field has a `<label>` element, the recorder may produce a `label=` selector instead. Both `role=textbox[name="..."]` and `label=...` are valid Browser Library selectors that find the same element.

### Select a dropdown option

```robot
    Select Options By    role=combobox[name="Country"]    text    Australia
```

- **Keyword:** `Select Options By`
- **Selector:** `role=combobox[name="Country"]` — ARIA role for a `<select>` element
- **Strategy:** `text` — selects the `<option>` whose visible text equals `Australia`
- **Value:** `Australia` — the visible label the recorder captured

Browser Library's `Select Options By` supports four strategies: `value`, `label`, `text`, and `index`. The generator currently emits `text` for every recorded `select` action; if you need to match by the underlying HTML `value` attribute, change `text` to `value` in the generated file.

### Check a checkbox

```robot
    Check Checkbox    role=checkbox[name="I agree to the terms and conditions"]
```

`Check Checkbox` sets the checkbox to the checked state. Use `Uncheck Checkbox` to uncheck. The recorder captures the accessible name from the associated `<label>` text.

### Upload a file

```robot
    Upload File By Selector    css=input[type="file"]    ${CURDIR}/fixtures/avatar.png
```

- **Keyword:** `Upload File By Selector` — sets files on a `<input type="file">` element
- **Selector:** `css=input[type="file"]` — targets the file input by CSS (no semantic role for file inputs)
- **Path:** `${CURDIR}/fixtures/avatar.png` — path to the file to upload

`${CURDIR}` is a built-in Robot Framework variable that resolves to the directory of the `.robot` file. Replace the path with your actual file.

> **Note:** The recorder captures the file paths from your own machine. Update them to paths that are valid in your test environment.

### Submit the form

```robot
    Click    role=button[name="Create Account"]
```

Standard button click to submit the form.

### Assert success heading

```robot
    Get Text    role=heading[level=1]    ==    Account Created
```

Verifies the `<h1>` text matches exactly.

### Assert input value was retained

```robot
    Get Property    role=textbox[name="Email"]    value    ==    alice@example.com
```

- **Keyword:** `Get Property` — reads a DOM property from an element
- **Property:** `value` — the current value of the `<input>` field
- **Assertion operator:** `==` — exact match
- **Expected:** `alice@example.com`

This checks that the form echoed back the submitted email address.

---

## Adapting this example

**Parameterise test data** with variables:

```robot
*** Variables ***
${FIRST_NAME}    Alice
${LAST_NAME}     Smith
${EMAIL}         alice@example.com
${COUNTRY}       AU
${AVATAR}        ${CURDIR}/fixtures/avatar.png

*** Test Cases ***
Form Submission
    ...
    Fill Text    role=textbox[name="First Name"]    ${FIRST_NAME}
    Select Options By    role=combobox[name="Country"]    text    ${COUNTRY}
    Upload File By Selector    css=input[type="file"]    ${AVATAR}
    ...
```

**Run the test:**

```bash
robot form-submit.robot
```
