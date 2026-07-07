# realunit.app

The website served at **realunit.app**. Public, static.

## v1 (current)

A single-image landing page — one hero image from the RealUnit app, nothing else.
Deliberately **without a build toolchain**: plain HTML + assets in `public/`,
uploaded to Cloudflare Pages.

- `public/index.html` — landing, shows `assets/hero.jpg` centered on a light background
- `public/assets/hero.jpg` — hero (source: the app's splash background)
- `public/assets/og.png` — social sharing image (source: the app's Android feature graphic)
- `public/assets/favicon.svg` — app icon
- `public/_headers` — security headers + cache-control for Cloudflare Pages

## Branching & deployment

Same `develop → main` flow as the other DFX Cloudflare-Pages sites (e.g. `landing-page`):

- Feature branches → PR into **`develop`** (default branch)
- Push to `develop` → `.github/workflows/dev.yaml` deploys `public/` to the DEV
  Pages project `realunit-web-dev` → **dev.realunit.app**
- `.github/workflows/auto-release-pr.yaml` opens/updates a `develop → main` release PR
- Merge to `main` → `.github/workflows/prd.yaml` deploys `public/` to the PRD
  Pages project `realunit-web` → **realunit.app**

Both deploys are Direct Upload via `wrangler pages deploy` (no build step).

Required repo secrets (both environments share them):
- `CLOUDFLARE_API_TOKEN` — scoped to *Account → Cloudflare Pages: Edit*
- `CLOUDFLARE_ACCOUNT_ID`

The custom domains `realunit.app` / `dev.realunit.app` are attached to the Pages
projects in the DNS/deployment configuration. The `handbook.` subdomain is unaffected.

## Roadmap (v2+)

- `/confirm-aktionariat` — guided Aktionariat address confirmation (calls `api.dfx.swiss`)
- Legal pages — rendered from the app's `assets/legal/*.md` (build-time fetch, single source)
- Store buttons by platform (iOS → App Store, Android → Play Store)
- Universal Links / App Links (`/.well-known/*`)

From v2 a build toolchain (Astro) is introduced; the plain-image landing stays the home page.
