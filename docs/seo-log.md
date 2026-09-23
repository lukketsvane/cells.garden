# Search discovery release log

## 2026-09-23 — Initial release, live

- Commit: `0edd01d63b843174b868a05c878d4e72f630ef22`.
- Live canonical pages: `/`, `/guide/`, `/chrome-extension/`, `/obsidian/`,
  `/privacy.html`.
- Added readable initial HTML, distinct metadata, canonical URLs, robots.txt,
  sitemap.xml, internal links and utility-page noindex directives. Restricted
  the app service-worker fallback to the root so it does not swallow guides or
  turn missing pages into app-shell soft 404s.
- Production deployment was verified ready, with public pages responding 200
  and an unknown page responding 404.
- IndexNow received five URLs with HTTP 202 (ownership validation pending).
  This is not proof of indexing or ranking.
- Typecheck, lint, security checks, individual builds and SEO checks passed.
  The aggregate asset-contract failure and full-Chromium runtime restriction
  were recorded in `seo.md`.

## 2026-09-23 — Workflow guides, awaiting release

- Prepared `/guide/mobile/`, `/guide/sync-sharing/` and `/guide/backups/`, with
  cross-links from the guide hub and platform pages. Instructions were checked
  against the current application code; mobile installation wording was checked
  against Apple and Google support documentation.
- Added canonical redirects and sitemap entries. Added a separate SEO CI job
  without weakening existing CI, plus checks for exact sitemap coverage,
  homepage reachability, redirects and all offline guide routes.
- Passed locally: typecheck, lint, security invariants, web build,
  `npm run test:seo` (eight pages) and `git diff --check`.
- Release blocker: `npm run build` stops at the existing asset contract. Four
  files in `src/assets/pack/kanban_icons/` are not mapped in `figma/exports.json`;
  the manifest lists 287 assets while the repository contains 291. No assets,
  mappings or verification gates were altered by this batch.
- `npm run test:web` again passed the desktop, mobile and offline scenarios but
  could not finish: the account/push scenario requires full Chromium, which
  this runtime cannot launch because its process-singleton socket is denied.
  That scenario remains unverified here; the test was not weakened or skipped.
- This batch is not yet in production and has not been sent to IndexNow.
- Daily improvement task enabled for around 08:00 Europe/Oslo starting
  24 September 2026. Continue this pending batch before creating another one.

### Next actions

1. Resolve the existing asset-contract discrepancy with verified source mapping,
   then pass the full repository checks and review the deployment preview.
2. Publish this batch only after the required checks pass, verify live canonical
   URLs and redirects, then submit only changed pages to IndexNow.
3. With owner-authorized Search Console access, submit the sitemap and establish
   an impressions/clicks/indexing baseline for 7- and 28-day comparisons.
