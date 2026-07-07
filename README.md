# realunit.app

The website served at **realunit.app**. Public, static.

## v1 (current)

A single-image landing page — one hero image from the RealUnit app, nothing else.
Deliberately **without a build toolchain**: plain HTML + assets in `public/`,
uploaded to Cloudflare Pages.

- `public/index.html` — landing, shows `assets/hero.png` centered on a light background
- `public/assets/hero.png` — hero (source: the app's splash background)
- `public/assets/og.png` — social sharing image (source: the app's Android feature graphic)
- `public/assets/favicon.svg` — app icon
- `public/_headers` — security headers + cache-control for Cloudflare Pages

## Deployment (Cloudflare Pages, Direct Upload)

No build. `.github/workflows/deploy.yml` uploads `public/` to the Cloudflare
Pages project `realunit-web` via `wrangler pages deploy` on every push to `main`.

Required repo secrets:
- `CLOUDFLARE_API_TOKEN` — scoped to *Account → Cloudflare Pages: Edit*
- `CLOUDFLARE_ACCOUNT_ID`

The custom domain `realunit.app` is attached to the `realunit-web` project in the
DNS/deployment configuration (apex → Pages, `www` → apex redirect). The
`handbook.` subdomain is unaffected.

## Roadmap (v2+)

- `/confirm-aktionariat` — guided Aktionariat address confirmation (calls `api.dfx.swiss`)
- Legal pages — rendered from the app's `assets/legal/*.md` (build-time fetch, single source)
- Store buttons by platform (iOS → App Store, Android → Play Store)
- Universal Links / App Links (`/.well-known/*`)

From v2 a build toolchain (Astro) is introduced; the plain-image landing stays the home page.
