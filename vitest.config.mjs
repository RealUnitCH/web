import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      // The extracted, side-effect-free browser logic and the Pages Function
      // that decides which page a landing path is answered with. The
      // DOM/network glue in public/*.js is covered by the Playwright
      // functional suite instead (see CONTRIBUTING.md).
      include: ['public/js/lib/**/*.js', 'functions/lib/**/*.js', 'functions/_middleware.js'],
      // Report every matched file even if no test imports it, so a new, untested
      // public/js/lib/*.js drops coverage below 100% instead of silently passing.
      all: true,
      reporter: ['text', 'json-summary'],
      thresholds: {
        // The browser lib stays at 100%: it is the extracted, side-effect-free
        // logic this suite exists for.
        'public/js/lib/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // functions/lib is the code the Pages Function actually runs. It was
        // outside `include` entirely, so its gaps were invisible while a
        // browser-side mirror of the same logic carried the 100% badge. It is
        // now measured and ratcheted at the level it reaches today; raise these
        // numbers as the gaps close, never lower them.
        'functions/lib/**': {
          lines: 98,
          functions: 100,
          branches: 87,
          statements: 98,
        },
        // The middleware decides which page and which status every crawler
        // sees. It was outside `include` while it did so, which is how a
        // change that served the 404 page on every invite link passed a full
        // review. It is measured at 100% and stays there.
        'functions/_middleware.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
