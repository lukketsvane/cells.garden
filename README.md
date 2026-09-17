# cells.garden

A kanban-style project garden where tasks grow into pixel-art plants. Web port of Max's Obsidian plugin **Garden Cells**.

The original code is ~4,200 lines of vanilla TypeScript in one file: DOM + CSS transforms, no canvas engine, touch and pinch already in place. The Obsidian coupling was thin, so the port is a port, not a rewrite: Max's code lives on in `src/core/garden.ts` with the same structure as before.

## Getting started

```sh
npm install
npm run dev            # http://localhost:5173, with the Sign in pill (reads .env)
npm run build          # typecheck + static web build into dist/
npm run preview        # serves dist/ on http://localhost:4173
npm run build:ext      # Chrome extension into dist-ext/
npm run dev:ext        # extension build in watch mode
npm run icons          # regenerates the PNG icons from the pixel grid
npm run typecheck      # tsc for the web app
npm run typecheck:ext  # tsc for the extension entry
npm run test:web       # Playwright smoke test of the web build + PWA offline start
npm run test:ext       # Playwright test of the extension (new tab + side panel)
```

The tests use the repo's Playwright and a Chromium it can find; run `npx playwright install chromium` once on a fresh machine.

## Architecture

The web app is the core. The extension and the PWA are shells around the same build.

- **Web** — the garden at a URL, deployed by Vercel: `main` is `cells.garden`, `dev` is `dev.cells.garden`.
- **PWA** — same app on a phone; service worker precaches the shell so it opens offline.
- **Extension** — New Tab override and Side Panel, same core, same local storage.

Same code, three distributions. Diagrams: `docs/architecture.html` (and the PNG next to it).

## Repository

```
src/core/      the core (independent of web, extension and Obsidian)
  shim.ts        createDiv/createEl/empty/setText/addClass … on Node/Element, as Obsidian does
  ui.ts, ui.css  View, Modal, Setting (a few dozen lines of our own)
  model.ts       data model, constants, DEFAULT_SETTINGS
  store.ts       GardenStore { load, save, subscribe? } + LocalStore
  supabase.ts    Supabase client + SupabaseStore (cloud)
  auth.ts        sign-in pill, magic link + 6-digit code
  boot.ts        bootGarden(host): mounts the garden and wires sign-in/sync
  assets.ts      AssetManager over the bundled asset pack in src/assets/pack/
  modals.ts      Max's three modals
  garden.ts      GardenView — Max's main.ts, ported
  app.ts         GardenApp — owns data, settings, the store switch
  markdown.ts    Max's markdown format (frontmatter + ## Flowers/Stem/Roots/Minerals), import/export
  styles.css     Max's styles.css
src/web/       index.html, main.ts, app.css (theme tokens), service-worker registration
src/assets/    sprites; pack/<plantType>/<category>/ is what Garden-Assets/ was in the vault
ext/           Chrome extension (Manifest V3): newtab.html, sidepanel.html, background.ts, manifest.ts
public/        icons (SVG + PNG); the web manifest is generated at build time
scripts/       make-icons.mjs, test-web.mjs, test-ext.mjs
supabase/      migrations + README (auth, RLS, SMTP)
docs/          architecture diagrams
obsidian/      Max's plugin, untouched. Hooks into the core later.
dist/          web build (ignored)
dist-ext/      extension build (ignored)
```

## Storage and sync

Everything goes through one interface, so the UI never knows where the garden lives:

```ts
interface GardenStore {
  load(): Promise<Garden | null>
  save(garden: Garden): Promise<void>
  subscribe?(listener: (garden: Garden) => void): () => void
}
```

- Signed out: `LocalStore` (localStorage, key `cells.garden/v1`). Tabs stay in step through the `storage` event.
- Signed in: `SupabaseStore` is primary and a per-user `LocalStore` mirrors every save, so the device keeps an offline copy and sign-out never loses anything. The whole garden is one JSON blob per user; the newest `updatedAt` wins; realtime pushes changes to the other devices.
- First sign-in on a device offers the anonymous garden to an account that has none yet, once.
- Camera and kanban scroll are per surface (web, new tab, side panel) and stay on the device.

The `.env` file carries the Supabase URL and publishable key on purpose; both are public by design and RLS protects the data. Anything private for local tooling goes in `.env.local`, which git ignores. See `supabase/README.md` for the migrations and the dashboard settings.

## Assets

Images are bundled by Vite as data URLs (as esbuild did). `imagePath` on a cell is the path relative to `src/assets/pack/`, e.g. `plant_1/stem/plant_1_part3.png`, so it survives markdown export unchanged. The pack only has `plant_1` (stems + flowers) today. Roots, minerals and seeds have no art yet and render invisibly, exactly as in Obsidian without `Garden-Assets/`.

## Milestones

- **M0** — runs in a browser, localStorage, deployed on Vercel. Done.
- **M1** — Supabase auth + sync, PWA. Same garden on phone and desktop. Done.
- **M2** — Chrome extension (new tab + side panel), service worker, per-surface camera, hardened sync. Done.
- **M3** — Obsidian import/export in the UI, custom images, an Obsidian plugin on top of the core syncing to the same backend.
