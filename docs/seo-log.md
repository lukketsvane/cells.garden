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

## 2026-09-23 — Branded query priority, awaiting release

- Clarified the main goal: Google's first page for the unquoted query
  `cells garden`, prioritizing Norway on mobile and desktop. The recurring task
  was updated with this priority without changing its schedule.
- General web searches returned the homepage and official product listings.
  Those results are not a measured Google Norway rank. No Search Console query,
  impression, click or position data is available in this session.
- Added the natural spaced brand `Cells Garden` to the homepage title,
  description and introduction, with a matching reference in the guide.
  WebSite microdata keeps `cells.garden` as the primary name and `Cells Garden`
  as the alternate name. It remains in the document after app startup without
  adding executable scripts or loosening the Content Security Policy.
- Extended the SEO browser checks to verify this site identity both without
  JavaScript and after the interactive garden starts.
- Passed locally: typecheck, lint, security invariants, web build, all eight-page
  SEO checks and `git diff --check`. The aggregate build still fails at the same
  four missing asset mappings. The previously recorded full-browser runtime
  restriction is unresolved; that test is not claimed as passed.
- Prior PR revision `ed57ce5` passed the hosted SEO checks. Its full CI run
  failed specifically at Verify Figma asset contract. Its preview was READY,
  but the Vercel connection could not fetch protected preview pages; additional
  project/team access is needed before that verification can continue.
- These brand-specific changes are saved to the pending SEO branch, not
  production. No IndexNow submission or Google recrawl request was made.
- Followed Google's [site-name guidance](https://developers.google.com/search/docs/appearance/site-names)
  and [recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl).
  Site-name markup expresses identity, not a ranking guarantee.

### Next actions

1. Complete hosted CI and review the protected deployment preview. The old
   asset-contract blocker was resolved upstream; see the 27 September entry.
2. Publish this batch only after the required checks pass, verify live canonical
   URLs and redirects, then submit only changed pages to IndexNow.
3. With owner-authorized Search Console access, submit the sitemap and establish
   an impressions/clicks/indexing baseline for `cells garden` in Norway on
   mobile and desktop, for 7- and 28-day comparisons. Inspect the homepage's
   Google-selected canonical and request indexing after the published change.


## 2026-09-27 — Refresh pending SEO batch against current production

- Continued PR #20 instead of creating another content batch. Merged production
  main `7f8adb1806192c876e6e4a0d9b2aa45ed01d9fc6` into the pending branch.
  The diff against main remains limited to the existing SEO files; no beta
  application code, generated plugin bundle or asset changes were introduced.
  The 26 September production rollback and removal of the obsolete Figma
  integration are preserved. No release checks were removed by this refresh.
- Verified production homepage HTTP 200, self-canonical, readable initial HTML
  and no noindex response header. The four other published sitemap pages return
  200 with matching canonicals. robots.txt allows crawling and advertises the
  five-URL sitemap. An unknown route and the unpublished mobile guide return 404.
  Production still has the original homepage title, without the spaced brand.
- General searches for both brand spellings found official Chrome and Obsidian
  listings, but provide no measured Google Norway position. Search Console is
  still unavailable. Google's public DNS resolver returned no TXT answer for
  cells.garden; DNS verification was not modified in this cycle.
- Rechecked pending feature instructions against current transfer, vault,
  sharing, notification and Obsidian code. No further pages were added.
- Passed locally: npm run typecheck, npm run lint, npm run build (all three
  targets plus security invariants), npm run test:seo (all eight pages), and
  git diff --check. Reviewed generated desktop guide and mobile Chrome-page
  screenshots; content is readable without horizontal overflow.
- npm run test:web completed the initial headless-browser scenarios, then failed
  launching full Chromium for account/push coverage: process_singleton_posix.cc,
  socket() failed: Operation not permitted. That coverage remains unverified
  locally. Browser binaries were installed, but the runtime restriction remains;
  no test was skipped or weakened. Hosted CI must pass before release.
- Preview deployment `dpl_5kCVBZhGino95CDmgxX7d96HYpnS` for commit
  `07bc8bdb67335a84b21339f60653ae7a0aca3217` is READY. Vercel's fetch tool
  returned an access error, but direct public requests succeeded: all eight
  canonical page bodies, robots.txt and sitemap.xml returned 200 and exactly
  matched the locally tested build. Preview:
  https://cellsgarden-1j2np3hu2-iverfinnes-projects.vercel.app/
- Hosted SEO run 36301654973 passed. Full CI run 36301654976 passed dependency
  audit, security, all typechecks, lint, unit tests and the aggregate build, then
  failed Web/PWA smoke at scripts/test-web.mjs:1233: dragging the mobile divider
  did not resize the canvas (422 -> 422). Extension and Obsidian smoke stages
  were consequently skipped. This differs from the local Chromium launch limit
  and needs investigation; neither the application code nor this test changed
  in the SEO diff. CI: https://github.com/lukketsvane/cells.garden/actions/runs/36301654976
- Production URLs changed this cycle: none. Pending public changes remain `/`,
  `/guide/`, `/chrome-extension/`, `/obsidian/`, plus the three unpublished guides
  `/guide/mobile/`, `/guide/sync-sharing/`, and `/guide/backups/`.
  No IndexNow submission, Google sitemap submission or recrawl request was made.
- Next: investigate the hosted mobile-divider failure and obtain passing full
  CI before publishing this draft. Preview content verification is complete.
  After publication, verify production before submitting only materially
  changed canonical URLs.

## 2026-09-28 — Refresh after product updates

- Continued PR #20. The prior revision `c7464283cfbcb535ca3e8e9c148b5b1ac0952fff`
  passed both hosted CI run 36301773730 and SEO run 36301773787, clearing the
  mobile-divider failure recorded above without weakening a test.
- Production main advanced to `fef3d8cfb41c389dab7f2a4536e77720a1a6ec43`.
  Merged that main revision into the pending branch; the diff against main still
  contains only the same 14 SEO files. Current product and generated-plugin
  changes are preserved. No new content page or feature claim was added.
- Verified production on 28 September: the homepage, robots.txt and five-URL
  sitemap return HTTP 200; the homepage remains self-canonical and still uses
  the original title without the spaced brand. The latest Vercel production
  deployment is READY at commit `fef3d8c`.
- General web search returned the homepage plus current official Chrome and
  Obsidian listings. This is useful corroboration, not a measured Google Norway
  rank. Search Console remains unavailable. Google's public DNS resolver still
  returns no TXT record for cells.garden, so the supplied domain-verification
  record is not public and no sitemap or recrawl request was made.
- Production URLs changed this cycle: none. No IndexNow submission was made.
- Passed locally after the merge: `npm run typecheck`, `npm run lint`, the full
  aggregate build, the eight-page SEO browser checks and `git diff --check`.
  `npm run test:web` passed its headless desktop, mobile, offline and divider
  scenarios, then hit the previously documented runtime restriction when full
  Chromium could not create its process-singleton socket. Hosted CI remains the
  authoritative check for that final account/push coverage.
- Next: pass the required checks and verify the refreshed preview. If those pass,
  the remaining release action is human review/merge of PR #20. After release,
  verify production, submit only the changed canonical URLs to IndexNow, and use
  authorized Search Console access for the Google-specific baseline and recrawl.
