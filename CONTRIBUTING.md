# Contributing

This repo is the **realunit.app** website — public, static. See the
[README](README.md) for the architecture and the list of files under `public/`.

## Ground rules

- **No build toolchain in v1.** Plain HTML/CSS/JS only. Everything in `public/`
  ships verbatim to Cloudflare Pages — what you commit is what gets served.
- **Keep the page self-contained.** `public/_headers` sets a strict CSP:
  - No inline `<script>` and no external resources of any kind (scripts, styles,
    images, fonts, fetch). Load JS from **same-origin** files instead.
  - Inline `style="…"` attributes and `<style>` blocks are fine (`style-src`
    allows `'unsafe-inline'`).
- **Don't put mutable files under `public/assets/`.** That path has an immutable,
  one-year cache header — only content-hashed or otherwise stable-named assets
  belong there. If a file's bytes may change under the same name, keep it out.
- **Public repo — never commit secrets or personal data.**

## Local preview

```
python3 -m http.server -d public
```

(or any static file server). Note that `_headers` — CSP, cache-control — is
applied by **Cloudflare Pages only**, so CSP violations do **not** show up
locally. Sanity-check them in the dev deployment.

## Branch & PR flow

- Feature branch → PR into **`develop`** (the default branch).
- Merging to `develop` auto-deploys to **dev.realunit.app**.
- The `develop → main` release PR is opened automatically — no need to create it.
- Merging that PR to **`main`** deploys production, **realunit.app**.

## PR expectations

- Small, focused diffs.
- **English** commit messages and code comments; **German** for user-facing page
  text.
- Verify rendering on both **mobile and desktop** viewports before requesting
  review.
- Confirm no CSP violations in the dev deployment for anything touching scripts,
  images, or external resources.
