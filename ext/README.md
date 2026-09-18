# cells.garden Chrome extension

The same garden as the web app, packaged as a Manifest V3 extension with three surfaces around one build of `src/core`:

- **New Tab** (`newtab.html`): the garden replaces Chrome's new tab page, so it is the start page.
- **Side Panel** (`sidepanel.html`): the garden in a strip along the window while you work.
- **Popup** (`popup.html`): click the toolbar icon for one plant at a time, a 320x440 cutout of the same canvas. Left and right (buttons or arrow keys) cycle through the plants; the popup remembers which one it showed. Buttons open the full garden in a new tab or the side panel (`chrome.sidePanel.open`, Chrome 116+).

All three share the extension's origin, so they share the same `localStorage` garden, and the same Supabase session once you sign in.

## Build

```sh
npm run build:ext      # -> dist-ext/ (manifest.json, newtab.html, sidepanel.html, popup.html, background.js, assets/, icons/)
npm run dev:ext        # same build, rebuilt on every change; reload the extension in Chrome to pick it up
npm run test:ext       # builds if stale, then drives all three pages in headless Chromium (Playwright)
npm run typecheck:ext  # ext/ together with the src/core it imports
```

The manifest is generated from `ext/manifest.ts` by the small plugin in `vite.ext.config.ts`. The version and description come from `package.json` (Chrome only accepts 1 to 4 dot-separated integers as a version), the icons from `ext/public/icons/` (`npm run icons` regenerates them from `public/icon.svg`), and the Supabase origin from the env, see below.

## Load unpacked

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** and pick the `dist-ext/` folder.
4. Open a new tab: the garden. Click the toolbar icon (pin it from the puzzle-piece menu): the popup, with a button for the side panel.

After a rebuild, press the reload icon on the extension's card.

## Files

```
ext/
  newtab.html      <html data-context="newtab">, mounts #app
  sidepanel.html   <html data-context="sidepanel">, mounts #app
  popup.html       <html data-context="popup">, mounts #app; popup.ts adds the plant controls
  main.ts          shared entry: imports the core CSS, calls bootGarden() with the magic-link landing page
  popup.ts         popup entry: main.ts plus prev/next, plant label, Garden and Side panel buttons
  ext.css          extension-only tweaks (compact pill, popup layout)
  background.ts    module service worker: keeps the side panel off the toolbar click, which the popup owns
  manifest.ts      buildManifest(env) -> manifest.json, emitted at build time
  public/icons/    16, 32, 48, 128 px PNGs
vite.ext.config.ts   root ext/, base ./, outDir dist-ext/, background.js unhashed, everything else under assets/
scripts/test-ext.mjs end-to-end test of dist-ext/
```

## Sign-in

The extension only shows the **Sign in** pill when the build has Supabase config (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, from the repo root `.env` or the environment; see `supabase/README.md`).

**Email and password** is the default way in and needs no setup per extension. So does the **6-digit code** from the emailed-link fallback (it needs `{{ .Token }}` in the Supabase **Magic Link** email template). Only the **magic link** itself has to know the extension: an unpacked extension gets a different id on every machine (the manifest carries no `key`), and the link lands on `chrome-extension://<id>/newtab.html`, where the app picks the session out of the URL. For that to work:

1. Find the id on `chrome://extensions` (or in the service worker URL).
2. Add `chrome-extension://<id>/newtab.html` to the **Redirect URLs** in Supabase (Authentication, URL configuration).
3. The generated manifest already lists `newtab.html` under `web_accessible_resources` for the Supabase origin only, which is what lets the auth server's redirect navigate into the extension page. This entry is only emitted when a Supabase URL is configured.

Once signed in on one surface, the other is signed in too.

## Permissions

`sidePanel` only. No host permissions: the garden talks to Supabase with ordinary `fetch` from the extension pages, which needs none.
