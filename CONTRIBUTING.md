# Contributing

This repo is the **realunit.app** website — public, static. See the
[README](README.md) for the architecture and the list of files under `public/`.

## Ground rules

- **No build toolchain for the site.** Plain HTML/CSS/JS only. Everything in
  `public/` ships verbatim to Cloudflare Pages — what you commit is what gets
  served. The dev dependencies exist **only** for the quality gates below
  (formatting, HTML validation, unit tests, screenshots); nothing compiles or
  bundles the site.
- **Keep the page self-contained.** `public/_headers` sets a strict CSP:
  - No inline `<script>` and no external resources of any kind (scripts, styles,
    images, fonts, fetch). Load JS from **same-origin** files instead.
  - Inline `style="…"` attributes and `<style>` blocks are fine (`style-src`
    allows `'unsafe-inline'`).
- **Put the reusable, side-effect-free JS in `public/js/lib/`.** That is the only
  code with a unit-coverage gate (see below); DOM/network glue stays in the
  page-level scripts and is covered by the Playwright suite.
- **Don't put mutable files under `public/assets/`.** That path has an immutable,
  one-year cache header — only content-hashed or otherwise stable-named assets
  belong there. If a file's bytes may change under the same name, keep it out.
- **Public repo — never commit secrets or personal data.**

## Setup

- **Node 22** (`engines.node >= 22`)
- **Docker** — only for the visual regression gate

```bash
npm install
npm run serve   # preview at http://127.0.0.1:4173 (Cloudflare-Pages-like routing)
```

`npm run serve` mirrors the Cloudflare Pages routing (serves `public/` at the
root, custom 404). Note that `_headers` — CSP, cache-control — is applied by
**Cloudflare Pages only**, so CSP violations do **not** show up locally;
sanity-check anything touching scripts/images in the dev deployment.

## Quality gates

Every pull request must pass the gates below; CI runs them as required status
checks.

| Gate              | Command                 | What it enforces                                                                                    |
| ----------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| Formatting        | `npm run format:check`  | Prettier formatting of the maintained code (the hand-written HTML pages are validated, not reformatted) |
| HTML validity     | `npm run validate:html` | Valid markup on every page under `public/`                                                          |
| Site completeness | `npm run check:site`    | Every `<html lang>`, every internal link/asset resolves, and each glue script loads its `js/lib` core first |
| Unit coverage     | `npm run test:coverage` | 100% line/branch/function/statement coverage of the extracted browser logic (`public/js/lib/**`)    |
| Functional        | `npm run test:e2e`      | Playwright smoke + behavior suite (every page loads, platform detection, the full confirm flow)     |
| Visual regression | `npm run e2e:docker`    | Every view in the visual matrix (page × viewport × language × state) matches its committed baseline, then `check:visual` |

`npm run check` runs the first four locally in one go. The Playwright suites run
against a local dev server (`test:e2e`); the visual gate runs in a pinned
container (see below).

### CI

- **Quality** (`.github/workflows/quality.yml`) — the first four gates.
- **Screenshots** (`.github/workflows/visual.yml`) — the visual gate, in the
  pinned Playwright container.

Both run on every pull request and on pushes to `develop`/`main`.

## Browser JS and unit coverage

The shipped page scripts (`public/platform.js`,
`public/confirm-aktionariat/confirm.js`) are classic, DOM-coupled IIFEs. Rather
than chase 100% coverage through the DOM, the **pure** logic — platform
detection, language resolution, API-base derivation, response→state mapping, and
the i18n copy — is extracted into `public/js/lib/` (side-effect free, exposed on
a `window.*` global) and unit-tested to 100% with Vitest + jsdom. Everything else
is covered end-to-end by the Playwright functional suite
(`tests/behavior.spec.mjs`).

If you add a file under `public/js/lib/`, it must reach 100% coverage or the
Quality gate fails (the threshold reports every matched file, tested or not). A
glue script must load its core first — `check:site` enforces the ordering.

## Visual regression & baselines

Screenshots are only reproducible when they render against the exact browsers the
baselines were generated with. Therefore:

- Baselines are generated and compared **inside the pinned container**
  (`mcr.microsoft.com/playwright:v<version>-noble`).
- `@playwright/test` is pinned to an **exact** version equal to that image tag. A
  guard step in `visual.yml` fails the build if the two drift apart.
- **Never** generate baselines on macOS/Windows — they would not match the Linux
  CI render.

```bash
npm run e2e:docker          # run the suite + compare against baselines + check:visual
npm run e2e:docker:update   # regenerate baselines after an intentional UI change
```

The visual matrix lives in `tests/pages.mjs` (`VIEWS`): the landing page in both
its equal-badge and platform-matched layouts, every confirm-page state in both
languages, and the 404 page — across `desktop-chromium`, `tablet-chromium` and
`mobile-safari`. `check:visual` enforces that every view × applicable viewport
has exactly one committed baseline, nothing is orphaned, and the report ran them
all. When you intentionally change a page's look, run `e2e:docker:update` and
commit the updated PNGs under `tests/__screenshots__/`.

## Branch & PR flow

- Feature branch → PR into **`develop`** (the default branch).
- Merging to `develop` auto-deploys to **dev.realunit.app**.
- The `develop → main` release PR is opened automatically — no need to create it.
- Merging that PR to **`main`** deploys production, **realunit.app**.

## PR expectations

- Small, focused diffs.
- **English** commit messages and code comments; **German** for user-facing page
  text.
- Run **`npm run check`** and the Playwright suites before requesting review.
- Confirm no CSP violations in the dev deployment for anything touching scripts,
  images, or external resources.
