import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      // Only the extracted, side-effect-free browser logic is unit-tested to
      // 100%. The DOM/network glue in public/*.js is covered by the Playwright
      // functional suite instead (see CONTRIBUTING.md).
      include: ['public/js/lib/**/*.js'],
      // Report every matched file even if no test imports it, so a new, untested
      // public/js/lib/*.js drops coverage below 100% instead of silently passing.
      all: true,
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
