# Search discovery

Baseline checked on 23 September 2026: the live home page had a brand-only title,
one short description and an empty app container in the initial HTML.
Both robots.txt and sitemap.xml returned 404. Search lookup found the home and
privacy pages; this is not a Search Console coverage report or traffic baseline.

## Public pages

Primary goal: make the homepage discoverable on Google's first page for the
unquoted branded query `cells garden`, prioritizing Norway and both mobile and
desktop. This is a target, not a ranking claim. Also monitor `cells.garden`.
Work on homepage identity, crawlability and genuine existing product references
before expanding generic keyword coverage.

The homepage identifies `cells.garden` as the site name and `Cells Garden` as its
alternate name through WebSite microdata. The metadata remains in the document
after the interactive app starts. This expresses site identity; it is not a
ranking guarantee. Keep both names natural and consistent, without adding
keyword variants or changing the product's established identity.

| URL | Purpose |
| --- | --- |
| https://cells.garden/ | Open the app; visual project planner and task garden |
| https://cells.garden/guide/ | Product explanation, first project and visual kanban workflow |
| https://cells.garden/guide/mobile/ | Home Screen installation, offline use and optional phone alerts |
| https://cells.garden/guide/sync-sharing/ | Account sync, invitations, collaboration and access management |
| https://cells.garden/guide/backups/ | Export, import and the difference between Merge and Replace |
| https://cells.garden/chrome-extension/ | Chrome new-tab task board, side panel and installation |
| https://cells.garden/obsidian/ | Obsidian project-management plugin and installation |
| https://cells.garden/privacy.html | Data handling and privacy |

These are the sitemap entries in this branch. See [the release log](seo-log.md)
for what is live versus awaiting release. Keep canonical tags, internal links and the
sitemap consistent. OAuth and refresh utility pages are noindex. Never add
private gardens, invitations, user content or authentication parameters.
The homepage introduction is a loading/no-JavaScript fallback; normal app use
still starts in the garden. The guide is a separate, permanently readable page.
The service worker uses the app fallback only at the root, including query strings.

## Release checks and discovery

Run `npm run build:web` followed by `npm run test:seo` to check static content,
metadata, internal links, mobile overflow, service-worker routing, offline use
and unknown-page status. The checks also require every sitemap page to be
reachable from the homepage and test canonical redirects with query strings.
Run the repository's normal checks too. The SEO workflow runs on pull requests
and pushes to main/dev; it supplements, not replaces, the full CI workflow.

After deploying changed public pages, run `node scripts/submit-indexnow.mjs`.
For later updates, pass only changed canonical URLs as arguments. The script
checks the live ownership file and pages before notifying IndexNow. The hosted
IndexNow key proves domain ownership; it is not an account or database secret.
HTTP 200 means received; 202 means ownership validation is pending. Neither
means the URLs are indexed or ranking. Do not repeatedly submit unchanged pages.

Google Search Console is separate. With owner access, submit
`https://cells.garden/sitemap.xml`, inspect the homepage and changed public pages,
and request indexing. Record impressions, clicks, queries and indexed pages
before comparing at 7 and 28 days. Do not infer traffic or rankings from a site:
search alone. No analytics or tracking was added to the app.

For the branded baseline, use Search Console's Web performance report, filter
the query exactly to `cells garden` and the country to Norway, and review mobile
and desktop separately. Track impressions, clicks and average position, while
checking whether the homepage is the returned URL. Average position is not a
guarantee of every user's first-page placement. Record a manual Google check's
date, location, device, query and homepage position separately when available;
general web-search tool results are not a measured Google ranking.

With authorized owner access, inspect `https://cells.garden/` and its
Google-selected canonical, run the live test and request indexing after a real
published change. Submit the sitemap once; do not repeatedly request unchanged
URLs. IndexNow submission is separate and does not request Google indexing.

## Daily improvement cycle

A daily task is scheduled for around 08:00 Europe/Oslo, starting 24 September
2026. Each run must first read the repository instructions, this document, the
release log, current main and open SEO pull requests. Prefer continuing an
existing batch to opening a duplicate.

- Check live pages and available search data before selecting the next task.
- Prioritize the exact branded query `cells garden` and the homepage until the
  first-page goal is supported by Google evidence; do not infer success from a
  generic web search, a successful build or an indexing submission receipt.
- Make at most one coherent, useful improvement batch. Improve existing pages
  before adding pages, and verify every product claim against the current code.
- Keep the free, local-first product and privacy commitments intact. Do not add
  tracking, paid services, purchased links, bulk directory submissions or thin
  keyword-variant pages.
- Run required checks and verify a preview before publishing. If required checks
  fail, leave a reviewable pull request and report the blocker; do not disable
  checks or change unrelated contracts just to obtain a passing release.
- Submit only genuinely changed canonical pages after they are live. An IndexNow
  receipt is not indexing, ranking or traffic evidence.
- Record changes, tests, deployment state, submission results and the next useful
  action in the release log. Notify only for meaningful changes or new blockers.

Search Console is not connected. Until owner access is available, report public
observations and technical checks only, not invented impressions, clicks, ranking
gains or conversion figures. There is no page-count or traffic-multiplier target.

## Existing validation limits found during this change

- Individual web, extension and Obsidian builds pass, as do typecheck, lint,
  security checks and the SEO browser checks.
- The web smoke test passes its desktop, mobile and offline scenarios here, but
  full Chromium cannot start for the account/push scenario because this runtime
  disallows its process-singleton socket. That scenario remains unverified here.

References: [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics),
[Google recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl),
[IndexNow protocol](https://www.indexnow.org/documentation).
