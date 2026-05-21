# Security Policy

## Supported Versions

xlibrary is pre-1.0. Only the latest 0.x release receives security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not open a public issue for security reports.**

Two private channels are accepted:

1. **GitHub Security Advisories (preferred)** — open a private advisory at
   https://github.com/Khrx1999/xlibrary/security/advisories/new
2. **Email** — `Tassana.khr@gmail.com` with subject `[xlibrary-security] …`

Expect an acknowledgement within 5 business days. Resolution timing depends on
the severity and complexity of the issue; a coordinated disclosure window will
be agreed before any public discussion.

## Trust boundaries

A few aspects of xlibrary are unusually privileged and worth knowing about:

- **`Module._compile` interception** (`src/recorder/bundle-patcher.ts`).
  xlibrary patches `playwright-core`'s bundled JavaScript in-memory at module
  load time. The patch MUST run before any `import 'playwright-core'` in the
  dependency graph — see `src/cli.ts` for the load-order guarantee. No file
  on disk is modified.

- **Viewer HTTP/WebSocket server** (`src/recorder/viewer-server.ts`).
  Binds to `127.0.0.1` on an ephemeral port. Not exposed to the network.

- **`--use-system-ca`** (`src/cli.ts`).
  Only **adds** the OS trust store on top of Node's bundled CA list. It does
  not disable TLS validation. xlibrary never sets
  `NODE_TLS_REJECT_UNAUTHORIZED=0`; documentation explicitly warns against it.

## Out of scope

- Bugs in `playwright-core`, `playwright`, or browser binaries themselves.
  Report those upstream at https://github.com/microsoft/playwright/issues.
- Robot Framework or Browser Library runtime behaviour. xlibrary only emits
  the `.robot` file; execution is the runtime's responsibility.
