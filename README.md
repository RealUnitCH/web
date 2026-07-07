# realunit.app

The website served at **realunit.app**. Public, static.

## v1 (current)

A single-image landing page — one hero image from the RealUnit app, nothing else.
Deliberately **without a build toolchain**: plain HTML + assets, served directly by Cloudflare Pages.

- `index.html` — landing, shows `assets/hero.png` centered on a light background
- `assets/hero.png` — hero (source: the app's splash background)
- `assets/og.png` — social sharing image (source: the app's Android feature graphic)
- `assets/favicon.svg` — app icon
- `_headers` — security headers + cache-control for Cloudflare Pages

## Deployment (Cloudflare Pages)

No build. Pages project with:
- **Build command:** _(empty)_
- **Output directory:** `/` (repo root)

Point the custom domain `realunit.app` at the Pages project. The current root
redirect to `handbook.realunit.app` (managed in the DNS/deployment configuration)
must be removed for this; the `handbook.` subdomain stays.

## Roadmap (v2+)

- `/confirm-aktionariat` — guided Aktionariat address confirmation (calls `api.dfx.swiss`)
- Legal pages — rendered from the app's `assets/legal/*.md` (build-time fetch, single source)
- Store buttons by platform (iOS → App Store, Android → Play Store)
- Universal Links / App Links (`/.well-known/*`)

From v2 a build toolchain (Astro) is introduced; the plain-image landing stays the home page.
