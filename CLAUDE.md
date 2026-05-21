# Robot Codegen — Project Conventions

> Generate Robot Framework + Browser Library `.robot` files via Playwright recorder.

## Goal

Mirror `npx playwright codegen` but emit Robot Framework syntax that uses Marketsquare's [Browser Library](https://github.com/MarketSquare/robotframework-browser) (Playwright-powered) instead of JS/Python/Java/.NET.

User flow target:

```bash
npx xlibrary codegen https://example.com -o login.robot
# → opens Chromium, records actions, writes .robot file on exit
```

## Architecture

```
playwright-core (recorder)               THIS REPO
─────────────────────────────────        ──────────────────────────────
Recorder captures Action[]      ───►     RobotFrameworkLanguageGenerator
                                          implements LanguageGenerator
                                          (vendor/playwright/.../codegen/types.ts)
                                              │
                                              ▼
                                          .robot output
```

We implement the `LanguageGenerator` interface from playwright-core and inject it via the recorder's language registry. Closest reference is `vendor/playwright/packages/playwright-core/src/server/codegen/python.ts`.

## Key directories

| Path                                | Purpose                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/codegen/robotframework.ts`     | `LanguageGenerator` implementation (THE main deliverable; embeds `RobotFormatter` for `.robot` line/section formatting) |
| `src/codegen/keywords-map.ts`       | Action → Browser Library keyword-name lookup (single source of truth for KEYWORD NAMES only)                            |
| `src/codegen/locator-translator.ts` | Internal selector → BL selector translation + Robot Framework value escaping                                            |
| `src/codegen/signal-handler.ts`     | Playwright signal (navigation/popup/download/dialog) → Robot Framework lines                                            |
| `src/recorder/runner.ts`            | Glue code: launch Chromium, inject our generator into recorder                                                          |
| `src/recorder/viewer-server.ts`     | HTTP + WebSocket live `.robot` preview window                                                                           |
| `src/cli.ts`                        | Commander-based CLI entry                                                                                               |
| `vendor/playwright/`                | Read-only reference clone — do NOT modify                                                                               |
| `tests/snapshots/`                  | Golden `.robot` output for fixture flows                                                                                |
| `examples/`                         | Sample `.robot` files showing target output                                                                             |

## Coding rules

1. **Never modify `vendor/playwright/`** — it is read-only reference. Copy snippets if needed.
2. **One generator class** in `robotframework.ts` — split helpers into separate files, keep the generator focused.
3. **Keyword mapping table is the source of truth** — never inline keyword names in the generator, always look up via `keywords-map.ts`.
4. **Output must run** — every generated `.robot` should pass `robot --dryrun` (eventually `robot` with Browser Library installed).
5. **Selectors**: prefer `getByRole`/`getByLabel` style → translate to Browser Library `role=`/`label=` selectors when supported, fall back to CSS otherwise.
6. **Test with snapshots**: every action type must have a `tests/snapshots/<action>.robot` fixture.

## Reference paths (read-only)

- `vendor/playwright/packages/playwright-core/src/server/codegen/types.ts` — `LanguageGenerator` interface
- `vendor/playwright/packages/playwright-core/src/server/codegen/language.ts` — `generateCode()` orchestrator
- `vendor/playwright/packages/playwright-core/src/server/codegen/python.ts` — closest analog (formatter + async/sync split)
- `vendor/playwright/packages/playwright-core/src/server/codegen/javascript.ts` — reference for locator handling
- `vendor/playwright/packages/playwright-core/src/server/recorder/recorderRunner.ts` — how recorder dispatches to generators
- `vendor/playwright/packages/recorder/src/actions.d.ts` — `Action` / `ActionInContext` types

## Browser Library keyword cheat sheet

| Playwright action        | Browser Library keyword                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `openPage` (with url)    | `New Page    ${url}`                                                                                               |
| `navigate`               | `Go To    ${url}`                                                                                                  |
| `click`                  | `Click    ${selector}`                                                                                             |
| `click` (clickCount=2)   | `Click    ${selector}    clickCount=2` _(no separate "Double Click" keyword in BL)_                                |
| `click` (with modifiers) | `Keyboard Key    down    ${mod}` / `Click ${selector}` / `Keyboard Key    up    ${mod}`                            |
| `fill`                   | `Fill Text    ${selector}    ${value}`                                                                             |
| `press` (key)            | `Press Keys    ${selector}    ${key}`                                                                              |
| `check`                  | `Check Checkbox    ${selector}`                                                                                    |
| `uncheck`                | `Uncheck Checkbox    ${selector}`                                                                                  |
| `select`                 | `Select Options By    ${selector}    value    ${value}` _(Playwright records HTML `value` attr, not visible text)_ |
| `hover`                  | `Hover    ${selector}`                                                                                             |
| `setInputFiles`          | `Upload File By Selector    ${selector}    ${file}` _(emit one call per file)_                                     |
| `assertVisible`          | `Get Element States    ${selector}    *=    visible`                                                               |
| `assertText`             | `Get Text    ${selector}    ==    ${text}`                                                                         |
| `assertValue`            | `Get Property    ${selector}    value    ==    ${value}`                                                           |
| `assertChecked`          | `Get Checkbox State    ${selector}    ==    checked`                                                               |
| `assertSnapshot`         | _(no BL equivalent — emitter writes a `# TODO` comment)_                                                           |

The `browser-keyword` agent owns this table — verify each row against actual Browser Library docs.

## Out of scope (for MVP)

- Multi-context recording (only single context for now)
- Mobile emulation flags
- VS Code extension integration
- Robot Framework dependency injection / variable file generation
