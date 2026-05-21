> 🌐 อ่านในภาษา: [English](README.md) | **ภาษาไทย**

# xlibrary

บันทึกการใช้งานเบราว์เซอร์แล้วสร้างไฟล์ `.robot` สำหรับ [Robot Framework](https://robotframework.org/) + [Browser Library](https://github.com/MarketSquare/robotframework-browser) — ขับเคลื่อนด้วย [Playwright](https://playwright.dev/)

[![npm version](https://img.shields.io/npm/v/xlibrary)](https://www.npmjs.com/package/xlibrary)
[![node](https://img.shields.io/node/v/xlibrary)](https://nodejs.org/)
[![license](https://img.shields.io/npm/l/xlibrary)](https://github.com/Khrx1999/xlibrary/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/xlibrary)](https://www.npmjs.com/package/xlibrary)

---

## ทำอะไรได้บ้าง

- เปิดหน้าต่างเบราว์เซอร์จริงพร้อม visual recorder ของ Playwright
- บันทึกทุกการคลิก กรอกข้อมูล navigate และ assertion ขณะที่คุณใช้งานหน้าเว็บ
- เขียนไฟล์ `.robot` ที่พร้อมรันทันทีโดยใช้ keyword ของ Browser Library
- หยุดการบันทึกเมื่อคุณปิดหน้าต่างเบราว์เซอร์ หรือกด `Ctrl+C`

---

## ความต้องการของระบบ

- Node.js **≥ 20**

---

## เริ่มใช้งานเร็ว

```bash
# 1️⃣  ติดตั้งครั้งแรก — ดาวน์โหลด binary ของ Chromium (~150 MB, จะถูก cache ไว้)
#     ถ้าคุณติดตั้ง Playwright browsers ไว้แล้ว สามารถข้ามขั้นตอนนี้ได้
npx xlibrary install

# 2️⃣  บันทึก session โดยเริ่มจาก URL
npx xlibrary codegen https://example.com -o recorded.robot

# หรือ: เปิดเบราว์เซอร์เปล่าแล้วพิมพ์ URL เอง
npx xlibrary codegen -o recorded.robot
```

> 💡 ถ้าข้ามขั้นตอนที่ 1 แล้วรัน `codegen` ทันที xlibrary จะตรวจพบว่า binary
> ยังไม่มีและจะแสดงคำสั่ง `install` ที่ต้องใช้ให้คุณ

เบราว์เซอร์จะเปิดขึ้น ใช้งานหน้าเว็บตามที่ต้องการ จากนั้นปิดหน้าต่าง (หรือกด `Ctrl+C`) ไฟล์ `.robot` ของคุณจะถูกบันทึกพร้อมใช้:

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

> ค่าเริ่มต้น `args=["--start-maximized"]` และ `viewport=None` ของ Chromium
> ทำให้เบราว์เซอร์ที่บันทึกครอบคลุมหน้าจอจริง เพื่อให้ selector สะท้อน viewport
> ที่ใช้งานจริง ส่วน Firefox และ WebKit จะไม่ได้รับ `args=["--start-maximized"]`
> เนื่องจากเป็น flag ของ Chromium อย่างเดียว

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

เปิดเบราว์เซอร์ บันทึกการใช้งาน เขียนไฟล์ `.robot`

| Flag                   | ค่าเริ่มต้น        | คำอธิบาย                                                                  |
| ---------------------- | ---------------- | ----------------------------------------------------------------------- |
| `[url]`                | _(ไม่มี)_         | URL ที่จะเปิด ถ้าไม่ระบุจะเปิดเบราว์เซอร์เปล่าให้พิมพ์ URL เอง                       |
| `-o, --output <file>`  | `recorded.robot` | path ของไฟล์ `.robot` ที่จะบันทึก                                          |
| `-b, --browser <name>` | `chromium`       | เบราว์เซอร์: `chromium`, `firefox`, หรือ `webkit`                          |
| `--test-name <name>`   | `Recorded Flow`  | ชื่อของ test case ที่จะสร้าง                                                |
| `--quiet`              | _(ปิด)_          | ปิดการแสดง keyword preview แบบ live ระหว่างบันทึก                          |
| `--open`               | _(ปิด)_          | เมื่อบันทึกเสร็จ เปิดไฟล์ `.robot` ใน editor ของคุณอัตโนมัติ                    |
| `--no-viewer`          | _(viewer เปิด)_  | ปิดหน้าต่าง live-viewer (เปิดเป็นค่าเริ่มต้น)                                 |

**ตัวอย่าง:**

```bash
# บันทึกพร้อมตั้งชื่อ test case
npx xlibrary codegen https://example.com/login -o login.robot --test-name "Login Flow"

# ใช้ Firefox
npx xlibrary codegen https://example.com -b firefox -o firefox-test.robot

# เปิดเบราว์เซอร์เปล่า พิมพ์ URL เอง และบันทึกไปยัง path ที่ต้องการ
npx xlibrary codegen -o tests/my-flow.robot --test-name "My Flow"
```

ดู [`docs/USAGE.md`](docs/USAGE.md) สำหรับ CLI reference เต็มและ workflow ทั้งหมด

---

## รูปแบบไฟล์ที่สร้าง

ทุก session ที่บันทึกจะสร้างไฟล์ `.robot` หนึ่งไฟล์:

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

Selector ใช้ syntax แบบ semantic ของ Browser Library — `role=`, `label=`, `css=`, `xpath=` — ตามที่ Playwright recorder จับมาได้

เมื่อ recorder ส่ง role selector มาพร้อม flag case-insensitive (substring) `i` — เช่น `internal:role=button[name="Sign in" i]` — generator จะคง prefix `internal:` ไว้เพื่อรักษา semantic แบบ substring ส่วน selector แบบ exact-match จะถูก emit เป็น `role=` form ปกติ

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

---

## Troubleshooting

ดู [Troubleshooting (English)](README.md#troubleshooting) สำหรับวิธีแก้ปัญหาที่พบบ่อย — รวมถึงปัญหา `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` เมื่อดาวน์โหลด Chromium ผ่าน corporate proxy (Zscaler / Cisco Umbrella / Forcepoint ฯลฯ)

---

## Programmatic API (experimental)

> ⚠ CLI คือ surface ที่ stable ส่วน programmatic API ยังเป็น **experimental จนกว่า
> จะถึง 1.0** — ถ้าใช้งานในระบบจริง ให้ pin version แบบ exact (`xlibrary@0.1.6`)

```ts
import { runRecorder } from 'xlibrary';
import { RobotFrameworkLanguageGenerator } from 'xlibrary/codegen';
import type { ActionInContext } from 'xlibrary/types';

// บันทึกและเขียนไฟล์ .robot (เหมือนกับ CLI):
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

| Import path         | สิ่งที่ export ออกมา                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `xlibrary`          | ระดับสูง: `runRecorder`, `createReplayController`, generator classes                                                       |
| `xlibrary/codegen`  | Generators + utilities: `RobotFrameworkLanguageGenerator`, `translateSelector`, `escapeRobotValue`, `ACTION_TO_KEYWORD` |
| `xlibrary/recorder` | Recorder orchestrator: `runRecorder`                                                                                    |
| `xlibrary/types`    | public types ทั้งหมด: `Action`, `ActionInContext`, `ActionName`, options ต่าง ๆ                                            |

---

## เอกสารเพิ่มเติม

- [CLI reference](docs/USAGE.md) — flag ทั้งหมด workflow ที่ใช้บ่อย และ troubleshooting
- [Contributing](CONTRIBUTING.md) — โครงสร้าง repo การเพิ่ม action mapping ใหม่ การรันเทส
- [Architecture](docs/architecture-recorder-flow.md) — recorder กับ code generator ทำงานร่วมกันอย่างไร
- [Security policy](SECURITY.md) — การรายงาน vulnerability และ trust boundaries

---

## License

[MIT](LICENSE) © Tassana Khrueawan
