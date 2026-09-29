# Search discovery

Baseline checked on 23 September 2026: the live home page had a brand-only title,
one short description and an empty app container in the initial HTML.
Both robots.txt and sitemap.xml returned 404. Search lookup found the home and
privacy pages; this is not a Search Console coverage report or traffic baseline.

## Public pages

| URL | Purpose |
| --- | --- |
| https://cells.garden/ | Open the app; visual project planner and task garden |
| https://cells.garden/guide/ | Product explanation, first project and visual kanban workflow |
| https://cells.garden/chrome-extension/ | Chrome new-tab task board, side panel and installation |
| https://cells.garden/obsidian/ | Obsidian project-management plugin and installation |
| https://cells.garden/privacy.html | Data handling and privacy |

These are the only sitemap entries. Keep canonical tags, internal links and the
sitemap consistent. OAuth and refresh utility pages are noindex. Never add
private gardens, invitations, user content or authentication parameters.
The homepage introduction is a loading/no-JavaScript fallback; normal app use
still starts in the garden. The guide is a separate, permanently readable page.
The service worker uses the app fallback only at the root, including query strings.

## Release checks and discovery

Run `npm run build:web` followed by `npm run test:seo` to check static content,
metadata, internal links, mobile overflow, service-worker routing, offline use
and unknown-page status. Run the repository's normal checks too.

After deploying changed public pages, run `node scripts/submit-indexnow.mjs`.
For later updates, pass only changed canonical URLs as arguments. The script
checks the live ownership file and pages before notifying IndexNow. The hosted
IndexNow key proves domain ownership; it is not an account or database secret.
HTTP 200 means received; 202 means ownership validation is pending. Neither
means the URLs are indexed or ranking. Do not repeatedly submit unchanged pages.

Google Search Console is separate. With owner access, submit
`https://cells.garden/sitemap.xml`, inspect the homepage and three product pages,
and request indexing. Record impressions, clicks, queries and indexed pages
before comparing at 7 and 28 days. Do not infer traffic or rankings from a site:
search alone. No analytics or tracking was added to the app.

## Existing validation limits found during this change

- Individual web, extension and Obsidian builds pass, as do typecheck, lint,
  security checks and the SEO browser checks.
- The web smoke test passes its desktop, mobile and offline scenarios here, but
  full Chromium cannot start for the account/push scenario because this runtime
  disallows its process-singleton socket. That scenario remains unverified here.

References: [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics),
[Google recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl),
[IndexNow protocol](https://www.indexnow.org/documentation).
