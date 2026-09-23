# cells.garden Chrome extension

The same garden as the web app, packaged as a Manifest V3 extension with three surfaces around one build of `src/core`:

- **New Tab** (`newtab.html`): the garden replaces Chrome's new tab page, so it is the start page.
- **Side Panel** (`sidepanel.html`): the garden in a strip along the window while you work.
- **Popup** (`popup.html`): click the toolbar icon for one plant at a time in a 320x320 garden scene. The Kanban strip opens its editable board below (368px tall collapsed, 600px expanded). Small corner icons open the side panel or the full garden in a new tab. Left and right arrows cycle through plants; the selection and board state are remembered. Arrow keys stay inside text fields while editing.

All three share the extension's origin, so they share the same `localStorage` garden, and the same Supabase session once you sign in.

## Build

```sh
npm run build:ext      # -> dist-ext/ (manifest.json, newtab.html, sidepanel.html, popup.html, background.js, assets/, icons/)
npm run dev:ext        # same build, rebuilt on every change; reload the extension in Chrome to pick it up
npm run test:ext       # builds if stale, then drives all three pages in headless Chromium (Playwright)
npm run typecheck:ext  # ext/ together with the src/core it imports
```

The manifest is generated from `ext/manifest.ts` by the small plugin in `vite.ext.config.ts`. The version and description come from `package.json` (Chrome only accepts 1 to 4 dot-separated integers as a version), the icons from `ext/public/icons/` (`npm run icons` regenerates them from `public/icon.svg`), and the Supabase origin from the env, see below.

## Chrome Web Store

Item `cighiofbnmdgppphnofkgfoneldalbbf` (publisher iverfinne). The original 0.1.0 submission entered review on 18 September 2026. If a newer build supersedes a pending review, cancel the pending review first, then upload the higher-version package and submit that revision. The canonical dashboard copy and privacy answers live in `ext/WEBSTORE.md`. To package an update: bump `version` in `package.json`, run `npm run build:ext`, zip the contents of `dist-ext/` with `manifest.json` at the archive root, then upload it under Package.

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

The extension only shows the **Sign in** pill when the build has Supabase config (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`).

Email/password and emailed-code sign-in are handled by Supabase Auth. Google sign-in uses a nonce-gated web bridge because Supabase's stable Site URL is `https://cells.garden/`:

1. The extension stores a short-lived OAuth intent nonce in `chrome.storage.local`.
2. It opens `https://cells.garden/privacy/oauth-extension-start.html`, which starts Google OAuth.
3. Supabase returns to `https://cells.garden/`; the static return page forwards only the OAuth result to the declared extension ID through `externally_connectable`.
4. The extension service worker verifies the matching intent, stores the return briefly, and the extension exchanges the code for its own Supabase session.
5. Query parameters are removed from the website return URL immediately.

The normal garden does not need `chrome.storage`; it uses local app storage. `chrome.storage` exists only for this cross-tab OAuth handoff.

## Permissions

- `sidePanel`: opens and hosts the garden in Chrome's side panel.
- `storage`: temporarily stores the nonce and OAuth return needed to finish optional Google sign-in across tabs.

There are **no host permissions**, no browsing-history permission, and no content script. The extension does not inspect pages the user visits. Supabase is reached from extension pages with normal HTTPS/WSS requests allowed by the extension CSP.

