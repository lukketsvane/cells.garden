# cells.garden Chrome extension (M2)

The same garden as the web app, packaged as a Manifest V3 extension with two surfaces around one build of `src/core`:

- **New Tab** (`newtab.html`): the garden replaces Chrome's new tab page, so it is the start page.
- **Side Panel** (`sidepanel.html`): the garden in a strip along the window while you work. Clicking the toolbar icon opens it (the service worker in `background.ts` sets `openPanelOnActionClick`).

Both pages share the extension's origin, so they share the same `localStorage` garden, and the same Supabase session once you sign in.

## Build

```sh
npm run build:ext      # -> dist-ext/ (manifest.json, newtab.html, sidepanel.html, background.js, assets/, icons/)
npm run dev:ext        # same build, rebuilt on every change; reload the extension in Chrome to pick it up
npm run test:ext       # builds if stale, then drives both pages in headless Chromium (Playwright)
```

`npx tsc --noEmit -p tsconfig.ext.json` typechecks `ext/` together with the `src/core` it imports.

The manifest is generated from `ext/manifest.ts` by the small plugin in `vite.ext.config.ts`. The version and description come from `package.json` (Chrome only accepts 1 to 4 dot-separated integers as a version), the icons from `ext/public/icons/` (`npm run icons` regenerates them from `public/icon.svg`), and the Supabase origin from the env, see below.

## Load unpacked

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** and pick the `dist-ext/` folder.
4. Open a new tab: the garden. Click the toolbar icon (pin it from the puzzle-piece menu): the side panel.

After a rebuild, press the reload icon on the extension's card.

## Files

```
ext/
  newtab.html      <html data-context="newtab">, mounts #app
  sidepanel.html   <html data-context="sidepanel">, mounts #app
  main.ts          shared entry: imports the core CSS, calls bootGarden() with the magic-link landing page
  ext.css          extension-only tweaks (compact pill, no sideways scroll in the panel)
  background.ts    module service worker: toolbar icon opens the side panel
  manifest.ts      buildManifest(env) -> manifest.json, emitted at build time
  public/icons/    16, 32, 48, 128 px PNGs
vite.ext.config.ts   root ext/, base ./, outDir dist-ext/, background.js unhashed, everything else under assets/
scripts/test-ext.mjs end-to-end test of dist-ext/
```

## Sign-in

The extension only shows the **Sign in** pill when the build has Supabase config (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, from the repo root `.env` or the environment; see `supabase/README.md`). Both ways of finishing a sign-in come from the same email:

**6-digit code (reliable).** Type the code from the email into the pill's dialog. This works on any install without any Supabase configuration per extension, and it is the recommended path: an unpacked extension gets a different id on every machine (unless the manifest carries a `key`, which this build does not), and the magic link below has to know that id. The code needs `{{ .Token }}` in the Supabase **Magic Link** email template (Authentication, Email Templates).

**Magic link.** The link lands on `chrome-extension://<id>/newtab.html`, where the app picks the session out of the URL. For that to work:

1. Find the id on `chrome://extensions` (or in the service worker URL).
2. Add `chrome-extension://<id>/newtab.html` to the **Redirect URLs** in Supabase (Authentication, URL configuration).
3. The generated manifest already lists `newtab.html` under `web_accessible_resources` for the Supabase origin only, which is what lets the auth server's redirect navigate into the extension page. This entry is only emitted when a Supabase URL is configured.

Once signed in on one surface, the other is signed in too.

## Permissions

`sidePanel` only. No host permissions: the garden talks to Supabase with ordinary `fetch` from the extension pages, which needs none.
