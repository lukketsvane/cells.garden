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
- Vercel's production fetch tool still returned an access error even though
  direct public HTTP inspection succeeded. Protected preview access must be
  verified before publishing.
- Production URLs changed this cycle: none. Pending public changes remain `/`,
  `/guide/`, `/chrome-extension/`, `/obsidian/`, plus the three unpublished guides
  `/guide/mobile/`, `/guide/sync-sharing/`, and `/guide/backups/`.
  No IndexNow submission, Google sitemap submission or recrawl request was made.
- Next: obtain passing hosted checks on this refreshed PR and verify its preview.
  Keep the batch in review until those gates pass. After publication, verify
  production before submitting only materially changed canonical URLs.
