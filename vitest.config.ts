import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    environment: 'node',
    // Several integration tests (bundle-patcher, selenium, replay-engine,
    // inspector-toolbar) each launch a real Chromium via Playwright. When
    // vitest runs them in parallel they compete for CPU + disk and a single
    // launch can take 15-20 seconds. 60 s leaves comfortable headroom while
    // still surfacing a hung test.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Run integration suites serially per file. Inside a file tests run in
    // sequence already (vitest default). This avoids 4 Chromium instances
    // spinning up at the same time on CI hosts with limited resources.
    fileParallelism: false,
  },
});
