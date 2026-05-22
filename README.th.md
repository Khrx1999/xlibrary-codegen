> อ่านในภาษา: [English](README.md) | **ภาษาไทย**

# xlibrary

บันทึกการใช้งานเบราว์เซอร์แล้วสร้างไฟล์ทดสอบสำหรับ [Robot Framework](https://robotframework.org/) + [Browser Library](https://github.com/MarketSquare/robotframework-browser),
[SeleniumLibrary](https://robotframework.org/SeleniumLibrary/), [Playwright Test (TypeScript)](https://playwright.dev/) หรือ [pytest-playwright (Python)](https://playwright.dev/python/) — ขับเคลื่อนด้วย [Playwright](https://playwright.dev/)

[![npm version](https://img.shields.io/npm/v/xlibrary)](https://www.npmjs.com/package/xlibrary)
[![node](https://img.shields.io/node/v/xlibrary)](https://nodejs.org/)
[![license](https://img.shields.io/npm/l/xlibrary)](https://github.com/Khrx1999/xlibrary/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/xlibrary)](https://www.npmjs.com/package/xlibrary)

---

## มีอะไรใหม่ใน v0.2

- **รองรับหลายภาษา** — บันทึกครั้งเดียว แล้ว emit เป็น `robot`, `selenium`, `ts` หรือ `python` ผ่าน `-l`/`--lang` บันทึก action stream ดิบด้วย `--save-actions` แล้ว render ใหม่ภายหลังด้วย `xlibrary emit`
- **Self-healing locators** — ตอนที่มี alternative selectors ระบบจะแนบคอมเมนต์ `# xlib:step=N;alts=[...]` พร้อม selector ทางเลือกสูงสุด 3 รายการที่ ranked และเกรดอักษร (A+ ถึง D) viewer แสดง grade chip สีต่างๆ ต่อ step (v0.2.1: ถ้าไม่มี alts ก็ไม่ใส่คอมเมนต์ — output ปกติจะสะอาด)
- **Re-record step** — `xlibrary patch <file>` เล่น replay ไฟล์ถึง step เป้าหมาย ให้คุณ re-record ในเบราว์เซอร์ แล้วนำผลลัพธ์ splicing กลับในที่เดิม รองรับ replace, insert-after/before, delete และ move ทุกภาษา output
- **Test Data Wizard** — `--extract-data` (หลังบันทึก) หรือ `xlibrary extract <file>` (standalone) ตรวจจับค่า literal (email, password, URL) แสดง diff preview แล้ว extract เป็นการประกาศ variable ตามภาษา

---

## ทำอะไรได้บ้าง

- เปิดหน้าต่างเบราว์เซอร์จริงพร้อม visual recorder ของ Playwright
- บันทึกทุกการคลิก กรอกข้อมูล navigate และ assertion ขณะที่คุณใช้งานหน้าเว็บ
- เขียนไฟล์ที่พร้อมรันทันทีในรูปแบบ output ที่คุณเลือก
- แนบ alternative selectors และ quality grades ให้กับทุก step
- หยุดการบันทึกเมื่อคุณปิดหน้าต่างเบราว์เซอร์ หรือกด `Ctrl+C`

---

## ความต้องการของระบบ

- Node.js **>= 20**

---

## เริ่มใช้งานเร็ว

```bash
# 1. ติดตั้งครั้งแรก — ดาวน์โหลด binary ของ Chromium (~150 MB, จะถูก cache ไว้)
#    ถ้าคุณติดตั้ง Playwright browsers ไว้แล้ว สามารถข้ามขั้นตอนนี้ได้
npx xlibrary install

# 2. บันทึก session โดยเริ่มจาก URL
npx xlibrary codegen https://example.com -o recorded.robot

# หรือ: emit รูปแบบอื่นโดยตรง
npx xlibrary codegen https://example.com -l ts -o test.spec.ts --save-actions
```

> ถ้าข้ามขั้นตอนที่ 1 แล้วรัน `codegen` ทันที xlibrary จะตรวจพบว่า binary
> ยังไม่มีและจะแสดงคำสั่ง `install` ที่ต้องใช้ให้คุณ

เบราว์เซอร์จะเปิดขึ้น ใช้งานหน้าเว็บตามที่ต้องการ จากนั้นปิดหน้าต่าง (หรือกด `Ctrl+C`) ไฟล์ output ของคุณจะถูกบันทึกพร้อมใช้:

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

> marker `# xlib:step=N;alts=[...]` จะถูกเพิ่มให้กับทุก step โดยอัตโนมัติ
> มันเป็น power ของ self-healing และ `xlibrary patch` สามารถลบออกด้วย `sed '/# xlib:/d'` ถ้าต้องการ output ที่สะอาด

---

## ติดตั้ง

**ติดตั้ง global** (เรียกใช้ได้จากทุกที่):

```bash
npm install -g xlibrary
xlibrary codegen https://example.com -o login.robot
```

**ติดตั้งในโปรเจกต์** (ไม่ต้องติดตั้ง global):

```bash
npm install --save-dev xlibrary
npx xlibrary codegen https://example.com -o login.robot
```

---

## วิธีใช้งาน

### `xlibrary install [browsers...]`

ดาวน์โหลด browser binaries ของ Playwright — เป็น wrapper ครอบ `npx playwright install`

```bash
npx xlibrary install                       # chromium (ค่าเริ่มต้น)
npx xlibrary install firefox               # firefox อย่างเดียว
npx xlibrary install chromium firefox      # หลายตัว
npx xlibrary install --with-deps           # ติดตั้ง OS-level deps ด้วย (Linux เท่านั้น)
```

### `xlibrary codegen [url] [options]`

เปิดเบราว์เซอร์ บันทึกการใช้งาน เขียนไฟล์ output

| Flag                    | ค่าเริ่มต้น      | คำอธิบาย                                                                |
| ----------------------- | ---------------- | ----------------------------------------------------------------------- |
| `[url]`                 | _(ไม่มี)_        | URL ที่จะเปิด ถ้าไม่ระบุจะเปิดเบราว์เซอร์เปล่าให้พิมพ์ URL เอง          |
| `-o, --output <file>`   | `recorded.robot` | path ของไฟล์ output extension จะ infer ภาษาเมื่อไม่มี `-l`              |
| `-l, --lang <target>`   | _(inferred)_     | ภาษา output: `robot` \| `selenium` \| `ts` \| `python`                  |
| `-b, --browser <name>`  | `chromium`       | เบราว์เซอร์: `chromium`, `firefox` หรือ `webkit`                        |
| `--test-name <name>`    | `Recorded Flow`  | ชื่อของ test case ที่จะสร้าง                                            |
| `--save-actions [file]` | _(ปิด)_          | บันทึก action stream ดิบเป็น `.jsonl` artifact สำหรับใช้ `emit` ภายหลัง |
| `--extract-data`        | _(ปิด)_          | หลังจากบันทึกเสร็จ รัน Test Data Wizard                                 |
| `--quiet`               | _(ปิด)_          | ปิดการแสดง keyword preview แบบ live ระหว่างบันทึก                       |
| `--open`                | _(ปิด)_          | เมื่อบันทึกเสร็จ เปิดไฟล์ output ใน editor ของคุณอัตโนมัติ              |
| `--no-viewer`           | _(viewer เปิด)_  | ปิดหน้าต่าง live-viewer (เปิดเป็นค่าเริ่มต้น)                           |
| `--open-viewer`         | _(ปิด)_          | Auto-open หน้าต่าง viewer ในเบราว์เซอร์ของคุณเมื่อเริ่ม                 |

**การ infer ภาษาจาก extension ของ `-o`:**

| Extension         | Target     |
| ----------------- | ---------- |
| `.robot`          | `robot`    |
| `.selenium.robot` | `selenium` |
| `.spec.ts`, `.ts` | `ts`       |
| `.py`             | `python`   |
| _(อื่นๆ)_         | `robot`    |

**ตัวอย่าง:**

```bash
# บันทึก Robot Framework output พร้อมตั้งชื่อ test case
npx xlibrary codegen https://example.com/login -o login.robot --test-name "Login Flow"

# บันทึก Playwright TypeScript output และบันทึก action artifact
npx xlibrary codegen https://example.com -l ts -o tests/login.spec.ts --save-actions

# บันทึก SeleniumLibrary output (infer จาก extension)
npx xlibrary codegen https://example.com -o login.selenium.robot

# บันทึกแล้ว extract variables ทันที
npx xlibrary codegen https://example.com -o login.robot --save-actions --extract-data

# ใช้ Firefox
npx xlibrary codegen https://example.com -b firefox -o firefox-test.robot
```

### `xlibrary emit <actions.jsonl> [options]`

Render artifact action ที่บันทึกไว้ก่อนหน้าเป็นภาษาเป้าหมาย — ไม่ต้อง re-record

รองรับใน v0.2: `robot`, `selenium` (`ts` และ `python` ต้องใช้ `xlibrary codegen -l ts/python` โดยตรง)

| Flag                  | Required | คำอธิบาย                                 |
| --------------------- | -------- | ---------------------------------------- |
| `-l, --lang <target>` | ใช่      | Output target: `robot` \| `selenium`     |
| `-o, --output <file>` | ใช่      | path ของไฟล์ปลายทาง                      |
| `--test-name <name>`  | ไม่      | Override ชื่อ test case จาก JSONL header |

```bash
# ขั้นแรก บันทึกและบันทึก artifact
npx xlibrary codegen https://example.com/login -o login.robot --save-actions

# Re-emit เป็น SeleniumLibrary (ไม่ต้องเปิดเบราว์เซอร์)
npx xlibrary emit recorded.robot.jsonl -l selenium -o login.selenium.robot

# Re-emit เป็น Robot Framework พร้อมเปลี่ยนชื่อ test
npx xlibrary emit recorded.robot.jsonl -l robot -o login-v2.robot --test-name "Login v2"
```

### `xlibrary extract <file> [options]`

รัน Test Data Wizard บนไฟล์ที่มีอยู่แล้ว ตรวจจับค่า literal (email, password, URL) แสดง diff preview และ extract เป็น variables

ต้องการ sidecar `.jsonl` จาก `--save-actions` หรือระบุด้วย `--actions <path>`

| Flag                     | ค่าเริ่มต้น  | คำอธิบาย                                                     |
| ------------------------ | ------------ | ------------------------------------------------------------ |
| `-o, --output <file>`    | _(in-place)_ | เขียนไปยังไฟล์แยก แทนที่จะแก้ไข in-place                     |
| `--yes`                  | _(ปิด)_      | ข้าม confirmation prompt แล้ว apply ทันที                    |
| `-l, --lang <target>`    | _(inferred)_ | Override การ infer ภาษาจาก extension ของไฟล์                 |
| `--actions <jsonl-path>` | _(auto)_     | Override path ของ sidecar `.jsonl` (default: `<file>.jsonl`) |

```bash
# ดูว่าจะ extract อะไร (interactive prompt)
npx xlibrary extract login.robot

# Apply โดยไม่ prompt (สำหรับ CI)
npx xlibrary extract login.robot --yes

# เขียนไปยังไฟล์ใหม่แทนที่จะแก้ไข in-place
npx xlibrary extract login.robot -o login-extracted.robot
```

### `xlibrary patch <file> [options]`

Re-record หนึ่งหรือหลาย step ในไฟล์ที่สร้างไว้แล้ว ถ้าไฟล์มี `xlib:step=N` markers จะค้นด้วย step number ตรงๆ ถ้าไม่มีก็ fallback เป็น fuzzy match บน keyword line (case-insensitive substring) พร้อมตาราง disambiguation ตอนเจอหลายตัว

| Flag                   | คำอธิบาย                                                    |
| ---------------------- | ----------------------------------------------------------- |
| `--at <id>`            | แทนที่ step `id` คือ step number หรือ fuzzy keyword content |
| `--insert-after <id>`  | บันทึก step ใหม่เพื่อ insert หลัง step `id`                 |
| `--insert-before <id>` | บันทึก step ใหม่เพื่อ insert ก่อน step `id`                 |
| `--delete <id>`        | ลบ step หรือ range (เช่น `5` หรือ `3-7`)                    |
| `--move <spec>`        | จัดเรียง step ใหม่ — spec คือ `"<from> to <to>"`            |
| `--range <range>`      | แทนที่ range ของ steps — ใช้ร่วมกับ `--at`                  |
| `--non-interactive`    | Fail-fast แทนที่จะหยุดรอเมื่อ replay ล้มเหลว                |
| `--no-backup`          | ข้ามการสร้างไฟล์ backup `.bak`                              |

```bash
# แทนที่ step 5 โดย re-record ในเบราว์เซอร์
npx xlibrary patch login.robot --at 5

# แทนที่โดยใช้ fuzzy keyword content
npx xlibrary patch login.robot --at "Click Sign in"

# ลบ step 6 ถึง 8
npx xlibrary patch login.robot --delete 6-8

# Insert step ใหม่หลัง step 3
npx xlibrary patch login.robot --insert-after 3

# ย้าย step 2 ไปที่ตำแหน่ง 5
npx xlibrary patch login.robot --move "2 to 5"
```

ดู [`docs/USAGE.md`](docs/USAGE.md) สำหรับ CLI reference เต็มและ workflow ทั้งหมด

---

## รูปแบบ output ที่รองรับ

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

ทุก step ที่บันทึกมีคอมเมนต์ `# xlib:step=N;alts=[...]` inline ลิสต์ `alts` มี alternative selectors ranked สูงสุด 3 รายการที่สามารถแทน primary ได้ถ้ามันพัง

Selectors จะถูก grade ด้วย A+ ถึง D:

| ประเภท selector          | Grade |
| ------------------------ | ----- |
| `data-testid` / test-id  | A+    |
| `role` + accessible name | A     |
| `label` text             | A     |
| `placeholder` text       | B     |
| visible `text` content   | B     |
| CSS (id / class)         | C     |
| XPath                    | D     |

Grade จะถูก promote หนึ่ง tier เมื่อ selector match เพียง element เดียวบนหน้า

live viewer (`--viewer` เปิดเป็นค่าเริ่มต้น) แสดง grade เป็น colored chip ต่อ step hover เพื่อดู alternative list

---

## รูปแบบไฟล์ที่สร้าง

ทุก session ที่บันทึกจะสร้างไฟล์หนึ่งไฟล์ สำหรับ Robot Framework:

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

Selector ใช้ syntax แบบ semantic ของ Browser Library — `role=`, `label=`, `css=`, `xpath=` — ตามที่ Playwright recorder จับมาได้

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

ที่มาของ mapping ทั้งหมด: [`src/codegen/keywords-map.ts`](src/codegen/keywords-map.ts)

---

## ตัวอย่าง

- [Login flow](docs/examples/login.md)
- [Form submission](docs/examples/form-submit.md)
- [Navigation and assertions](docs/examples/navigation.md)
- [บันทึกครั้งเดียว emit หลายภาษา](docs/examples/multi-language.md)
- [Self-healing locators ในทางปฏิบัติ](docs/examples/self-healing.md)
- [Patch workflow — re-record step](docs/examples/patch-workflow.md)
- [Extract test data variables](docs/examples/extract-data.md)

---

## Troubleshooting

ดู [Troubleshooting (English)](README.md#troubleshooting) สำหรับวิธีแก้ปัญหาที่พบบ่อย — รวมถึงปัญหา `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` เมื่อดาวน์โหลด Chromium ผ่าน corporate proxy (Zscaler / Cisco Umbrella / Forcepoint ฯลฯ)

---

## Programmatic API (experimental)

> CLI คือ surface ที่ stable ส่วน programmatic API ยังเป็น **experimental จนกว่า
> จะถึง 1.0** — ถ้าใช้งานในระบบจริง ให้ pin version แบบ exact (`xlibrary@0.1.6`)

```ts
import { runRecorder } from 'xlibrary';
import { RobotFrameworkLanguageGenerator } from 'xlibrary/codegen';
import type { ActionInContext } from 'xlibrary/types';

// บันทึกและเขียนไฟล์ output (เหมือนกับ CLI):
await runRecorder({
  url: 'https://example.com',
  output: 'recorded.robot',
  browser: 'chromium',
  testName: 'My Flow',
});

// หรือจะ feed actions ผ่าน generator เองก็ได้:
const gen = new RobotFrameworkLanguageGenerator('My Flow');
const header = gen.generateHeader({
  browserName: 'chromium',
  launchOptions: {},
  contextOptions: {},
});
const step = gen.generateAction(someAction as ActionInContext);
const footer = gen.generateFooter();
```

Sub-entries ที่มีให้ใช้:

| Import path         | สิ่งที่ export ออกมา                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `xlibrary`          | ระดับสูง: `runRecorder`, `createReplayController`, generator classes                                                    |
| `xlibrary/codegen`  | Generators + utilities: `RobotFrameworkLanguageGenerator`, `translateSelector`, `escapeRobotValue`, `ACTION_TO_KEYWORD` |
| `xlibrary/recorder` | Recorder orchestrator: `runRecorder`                                                                                    |
| `xlibrary/types`    | public types ทั้งหมด: `Action`, `ActionInContext`, `ActionName`, options ต่าง ๆ                                         |

---

## เอกสารเพิ่มเติม

- [CLI reference](docs/USAGE.md) — flag ทั้งหมด workflow ที่ใช้บ่อย และ troubleshooting
- [Contributing](CONTRIBUTING.md) — โครงสร้าง repo การเพิ่ม action mapping ใหม่ การรันเทส
- [Architecture](docs/architecture-recorder-flow.md) — recorder กับ code generator ทำงานร่วมกันอย่างไร
- [Security policy](SECURITY.md) — การรายงาน vulnerability และ trust boundaries

---

## License

[MIT](LICENSE) © Tassana Khrueawan
