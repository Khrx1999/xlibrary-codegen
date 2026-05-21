# Browser Library Selector Syntax Conventions

> **Owned by:** `browser-keyword` agent  
> **Last updated:** 2026-05-19  
> **Status:** Canonical — this document drives `src/codegen/keywords-map.ts` and `examples/*.robot`

---

## Overview

Browser Library (robotframework-browser) uses Playwright's selector engine under the hood.
Selectors are passed as plain strings to keywords like `Click`, `Fill Text`, `Get Text`, etc.

Playwright records actions using **internal selector format** strings
(e.g. `internal:role=button[name="Submit"]`). The emitter's selector-translation layer
must convert these to Browser Library–compatible strings before passing them to `argTemplate`.

This document is the authoritative reference for that translation.

---

## 1. Selector Prefixes Supported by Browser Library

| Prefix         | Meaning                                    | Example                       |
| -------------- | ------------------------------------------ | ----------------------------- |
| `role=`        | ARIA role selector                         | `role=button[name="Sign in"]` |
| `text=`        | Visible text (exact or substring)          | `text=Submit`                 |
| `label=`       | Form label text (by `<label>` association) | `label=Email address`         |
| `placeholder=` | Input placeholder text                     | `placeholder=Search...`       |
| `css=`         | CSS selector                               | `css=#login-btn`              |
| `xpath=`       | XPath expression                           | `xpath=//button[@id="go"]`    |
| `id=`          | Element ID shorthand                       | `id=submit-btn`               |
| `data-testid=` | `data-testid` attribute                    | `data-testid=login-form`      |

---

## 2. Translating Playwright Internal Selectors

The Playwright recorder stores selectors in its **internal format** which is NOT the same as Browser Library format. The selector-translation layer (in the emitter) must convert them.

### 2.1 Role Selectors (most common)

| Playwright internal                           | Browser Library equivalent           |
| --------------------------------------------- | ------------------------------------ |
| `internal:role=button[name="Sign in"]`        | `role=button[name="Sign in"]`        |
| `internal:role=textbox[name="Email"]`         | `role=textbox[name="Email"]`         |
| `internal:role=checkbox[name="Remember me"]`  | `role=checkbox[name="Remember me"]`  |
| `internal:role=link[name="Forgot password?"]` | `role=link[name="Forgot password?"]` |
| `internal:role=heading[name="Welcome"]`       | `role=heading[name="Welcome"]`       |
| `internal:role=combobox[name="Country"]`      | `role=combobox[name="Country"]`      |

**Translation rule:** Strip the `internal:` prefix. The `role=...` part passes through unchanged.

### 2.2 Label Selectors

| Playwright internal              | Browser Library equivalent |
| -------------------------------- | -------------------------- |
| `internal:label="Email address"` | `label=Email address`      |
| `internal:label="Password"`      | `label=Password`           |

**Translation rule:** Strip `internal:label=` and surrounding quotes → prefix with `label=`.

### 2.3 Text Selectors

| Playwright internal          | Browser Library equivalent                    |
| ---------------------------- | --------------------------------------------- |
| `internal:text="Click here"` | `text=Click here`                             |
| `internal:text="Submit"i`    | `text=Submit` (case-insensitive flag dropped) |

**Translation rule:** Strip `internal:text=` and surrounding quotes/flags → prefix with `text=`.

### 2.4 Attribute Selectors

| Playwright internal                    | Browser Library equivalent |
| -------------------------------------- | -------------------------- |
| `internal:attr=[placeholder="Search"]` | `placeholder=Search`       |
| `internal:attr=[alt="Logo"]`           | `css=[alt="Logo"]`         |
| `internal:attr=[data-testid="submit"]` | `data-testid=submit`       |

**Translation rule:** Map well-known attributes to their Browser Library prefix; fall back to `css=[attr="value"]` for others.

### 2.5 CSS and XPath (pass-through)

| Playwright internal        | Browser Library equivalent |
| -------------------------- | -------------------------- |
| `css=.submit-btn`          | `css=.submit-btn`          |
| `css=#username`            | `css=#username`            |
| `xpath=//button[@id="go"]` | `xpath=//button[@id="go"]` |

**Translation rule:** Pass through unchanged.

### 2.6 Test-ID Selectors

| Playwright internal              | Browser Library equivalent |
| -------------------------------- | -------------------------- |
| `internal:testid=["submit-btn"]` | `data-testid=submit-btn`   |

**Translation rule:** Extract the value from the array notation, prefix with `data-testid=`.

---

## 3. Selector Preference Order

When the Playwright recorder generates multiple candidate selectors (it picks one),
the preferred priority for Robot Framework output (best → last resort):

1. **`role=`** — semantically meaningful, resilient to HTML changes
2. **`label=`** — user-facing, great for form inputs
3. **`text=`** — user-facing, good for buttons and links
4. **`placeholder=`** — useful for inputs without labels
5. **`data-testid=`** — stable test-targeted attribute
6. **`css=`** — specific but fragile to HTML structure changes
7. **`xpath=`** — last resort; avoid unless no other option works

---

## 4. Role Selector Attribute Syntax

Browser Library role selectors use square-bracket attribute filters:

```
role=<aria-role>[<attribute>="<value>"]
```

### Supported attributes in role filters

| Attribute  | Meaning                                         | Example                                     |
| ---------- | ----------------------------------------------- | ------------------------------------------- |
| `name`     | Accessible name (aria-label, inner text, title) | `role=button[name="Submit"]`                |
| `exact`    | Exact name match (`true`/`false`)               | `role=button[name="Submit"][exact=true]`    |
| `checked`  | Checkbox/radio state                            | `role=checkbox[name="Agree"][checked=true]` |
| `disabled` | Disabled state                                  | `role=button[disabled=true]`                |
| `expanded` | Expanded state (for accordions, menus)          | `role=button[expanded=true]`                |
| `pressed`  | Pressed state (toggle buttons)                  | `role=button[pressed=true]`                 |
| `level`    | Heading level                                   | `role=heading[level=2]`                     |

### Examples

```robot
# A submit button identified by its accessible name
Click    role=button[name="Sign in"]

# A text input identified by ARIA role
Fill Text    role=textbox[name="Email"]    user@example.com

# A checked checkbox
Check Checkbox    role=checkbox[name="Remember me"]

# A heading level 1
Get Text    role=heading[level=1]    ==    Welcome Back
```

---

## 5. Text Selector Matching Rules

```
text=<visible text>          # Substring match (default)
text=<visible text>          # Case-sensitive (default)
```

Browser Library text selectors match visible text content. Prefer `role=` with `name=`
attribute over `text=` for interactive elements (buttons, links) as it is more precise.

---

## 6. CSS Selector Guidelines

Use CSS selectors when:

- No semantic role/label/text selector is available
- Targeting by ID: `css=#element-id` (or `id=element-id` shorthand)
- Targeting by class + element: `css=button.primary`
- Targeting by data attribute: `css=[data-qa="submit"]`

Avoid:

- Deep descendant chains: `css=.container > div > section > form > button`
- Position-based selectors: `css=li:nth-child(3)` (fragile)

---

## 7. Complete Selector Translation Table

| Playwright internal selector           | Browser Library selector      | Notes                            |
| -------------------------------------- | ----------------------------- | -------------------------------- |
| `internal:role=button[name="Sign in"]` | `role=button[name="Sign in"]` | Strip `internal:` prefix         |
| `internal:role=textbox[name="Email"]`  | `role=textbox[name="Email"]`  | Strip `internal:` prefix         |
| `internal:label="Password"`            | `label=Password`              | Strip `internal:label=` + quotes |
| `internal:text="Submit"`               | `text=Submit`                 | Strip `internal:text=` + quotes  |
| `internal:attr=[placeholder="Search"]` | `placeholder=Search`          | Map known attr                   |
| `internal:attr=[alt="Logo"]`           | `css=[alt="Logo"]`            | Fallback to CSS attr             |
| `internal:testid=["my-btn"]`           | `data-testid=my-btn`          | Strip array notation             |
| `css=#username`                        | `css=#username`               | Pass-through                     |
| `xpath=//button`                       | `xpath=//button`              | Pass-through                     |

---

## 8. Quoting Conventions in Robot Framework

Robot Framework does **not** require quoting around selector strings:

```robot
# Correct — no quotes needed
Click    role=button[name="Sign in"]
Fill Text    css=#email-input    user@example.com

# Avoid — unnecessary quoting (but valid in some contexts)
Click    ${{"role=button[name=\"Sign in\"]"}}
```

If a selector contains `    ` (4+ spaces, which would be parsed as an argument separator),
wrap it in a Robot variable: `${sel}` set in `*** Variables ***`.

---

## 9. Examples in Context

```robot
*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Page    https://example.com/login
    Fill Text    role=textbox[name="Email"]    user@example.com
    Fill Text    role=textbox[name="Password"]    secret123
    Click    role=button[name="Sign in"]
    Get Text    role=heading[level=1]    ==    Dashboard

Form With Dropdown
    New Page    https://example.com/form
    Fill Text    label=First Name    Alice
    Select Options By    role=combobox[name="Country"]    value    US
    Check Checkbox    role=checkbox[name="I agree to the terms"]
    Click    role=button[name="Submit"]

Navigation Assertion
    New Page    https://example.com
    Click    role=link[name="About"]
    Get Text    role=heading[level=1]    ==    About Us
    Get Element States    role=link[name="Home"]    *=    visible
```

---

## References

- [Browser Library Keywords](https://marketsquare.github.io/robotframework-browser/Browser.html)
- [Playwright Selector Engines](https://playwright.dev/docs/selectors)
- [ARIA Roles Reference](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles)
- [Robot Framework User Guide — Data Types](https://robotframework.org/robotframework/latest/RobotFrameworkUserGuide.html)
