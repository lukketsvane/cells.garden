# cells.garden

A kanban-style project garden where tasks grow into pixel-art plants. Web port of Max's Obsidian plugin **Garden Cells**.

Use it at [cells.garden](https://cells.garden), as an app on your phone's home screen, as a Chrome extension, or in Obsidian: search for **cells.garden** under Settings, Community plugins, and open it from the sprout in the ribbon. Without an account the garden stays on your device. Sign in to have the same garden everywhere and to share gardens and plants with others.

**Disclosures (Obsidian plugin).** Network: when you sign in, the garden syncs with the cells.garden server (Supabase), and only then. Account: optional, needed only to sync or share. No telemetry, no ads, no payments. It reads your vault only when you run "Import this vault's garden", and never writes to it. Open source under Apache-2.0.

The original code is ~4,200 lines of vanilla TypeScript in one file: DOM + CSS transforms, no canvas engine, touch and pinch already in place. The Obsidian coupling was thin, so the port was a port, not a rewrite: Max's code lives on in `src/core/garden.ts`, with the same structure and rather less of it.

## Getting started

See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks and conventions.

```sh
npm install
npm run dev            # http://localhost:5173, with the Sign in pill (reads .env)
npm run build          # everything: web, extension and Obsidian plugin
npm run build:web      # typecheck + static web build into dist/
npm run preview        # serves dist/ on http://localhost:4173
npm run build:ext      # Chrome extension into dist-ext/
npm run dev:ext        # extension build in watch mode
npm run icons          # regenerates the PNG icons from the pixel grid
npm run typecheck      # tsc for the web app (also :ext, :obsidian and :test)
npm run test:unit      # node --test over src/**/*.test.ts
npm run test:web       # Playwright smoke test of the web build + PWA offline start
npm run test:ext       # Playwright test of the extension (new tab, side panel, popup)
npm run build:obsidian # Obsidian plugin into obsidian-plugin/ (committed; CI rebuilds it), copied to the root
npm run test:obsidian  # loads the plugin build behind a stand-in Obsidian API
```

The tests use the repo's Playwright and a Chromium it can find; run `npx playwright install chromium` once on a fresh machine.

## Architecture

The web app is the core. The PWA, the extension and the Obsidian plugin are shells around the same code.

- **Web**: the garden at a URL, deployed by Vercel: `main` is `cells.garden`, `dev` is `dev.cells.garden`.
- **PWA**: same app on a phone; service worker precaches the shell so it opens offline.
- **Extension**: New Tab override, Side Panel and a popup that shows one plant at a time, same core, same local storage.
- **Obsidian**: the same app in an Obsidian tab, see below.

## Repository

```
src/core/      the core, independent of web, extension and Obsidian; every file opens
               with a comment saying what it holds. garden.ts is Max's main.ts ported,
               styles.css his styles.css, shim.ts and ui.ts the bits of Obsidian's API he used.
               Max's plugin itself, untouched, is on the `original` branch.
src/web/       index.html, main.ts, app.css (theme tokens), service-worker registration
src/assets/    sprites; pack/<plantType>/<category>/ is what Garden-Assets/ was in the vault
ext/           Chrome extension (Manifest V3), see ext/README.md
public/        icons (SVG + PNG); the web manifest is generated at build time
scripts/       the icon generator, the three browser tests, the .ts loader for the unit tests
supabase/      migrations + README (auth, RLS, sharing)
obsidian-plugin/  the synced Obsidian plugin; main.js and styles.css are its committed build
main.js, styles.css  copies of that build beside manifest.json (ignored)
dist/          web build (ignored)
dist-ext/      extension build (ignored)
```

## Obsidian plugin

`obsidian-plugin/` runs the same app in an Obsidian tab. Sign in with the same account and the garden syncs live with the web app, the phone and the extension. The folder is a complete plugin: `main.js` and `styles.css` are its build, committed, and CI rebuilds them on every push to `main` and `dev` that touches the code (`npm run build:obsidian` does the same locally). Link the folder into a vault once (Windows; `ln -s` elsewhere):

```
mklink /J "<vault>\.obsidian\plugins\cells-garden" "<repo>\obsidian-plugin"
```

Then turn on cells.garden under Settings, Community plugins. From then on a pull (GitHub Desktop: Fetch origin, then Pull) is the update: reload the plugin, or restart Obsidian, to pick it up. With the Hot Reload community plugin installed, the empty `.hotreload` file makes it reload on its own. Its id is `cells-garden`. Turn Max's `garden-cells` off in the same vault: both style the same class names, and the plugin says so if both are on. A release is made from the root `manifest.json`: bump its `version` (and `versions.json`), push to `main`, and CI publishes the release Obsidian installs from, with build attestations. `npm run lint` runs the rules Obsidian's review applies. The review builds with `npm run build` and looks for `main.js` beside `manifest.json`, so the plugin build copies `main.js` and `styles.css` to the root too; those copies are ignored. The command "Import this vault's garden" brings the plants Max's plugin keeps in `Garden-Cells/` into the synced garden.

## Storage and sync

Everything goes through one interface, so the UI never knows where the garden lives:

```ts
interface GardenStore {
  load(): Promise<Garden | null>
  save(garden: Garden): Promise<void>
  subscribe?(listener: (garden: Garden) => void): () => void
}
```

- Signed out: `LocalStore` (localStorage, key `cells.garden/v1`). Tabs stay in step through the `storage` event. In Obsidian this storage is per vault (copied once from the old shared keys) and other Obsidian windows do not update live; the anonymous-garden claim stays device-wide.
- Signed in: `SupabaseStore` is primary and a per-user `LocalStore` mirrors every save, so the device keeps an offline copy and sign-out never loses anything. The whole garden is one JSON blob per owner; saves are compare-and-swap on a server revision and merge by plant and cell id when someone wrote first; realtime pushes changes to the other devices.
- Shared: an owner shares their garden by link (`#join=<token>`); members edit the same blob. See `supabase/README.md`.
- Garden spaces: more gardens than your own (New garden space in the pill menu), shared the same way.
- Garden settings (pill menu, Settings): fireflies, the sky's colours through the day or one fixed colour, minerals that fade with depth, and the standby look. They belong to the garden, so everyone who shares it sees the same; the defaults are Max's original garden.
- Collaborative plants: one plant shared by link (`#plant=<token>`) into other people's gardens; everyone who has it edits it live.
- First sign-in on a device offers the anonymous garden to an account that has none yet, once.
- Camera, kanban scroll and the divider between them are per surface (web, new tab, side panel) and stay on the device.

The `.env` file carries the Supabase URL and publishable key on purpose; both are public by design and RLS protects the data. Anything private for local tooling goes in `.env.local`, which git ignores. See `supabase/README.md` for the migrations and the dashboard settings.

## Assets

Images are bundled by Vite as data URLs (as esbuild did). `imagePath` on a cell is the path relative to `src/assets/pack/`, e.g. `plant_1/stem/stem3.png`, so it survives markdown export unchanged.

The pack is a copy of Max's `Garden-Assets/` vault folder, filenames and all, so a garden exported from Obsidian resolves here and back:

```
pack/plant_1 … plant_8/stem/stem<n>.png        19, 11, 7, 8, 5, 10, 7, 3 stems
pack/plant_1 … plant_8/flowers/flower<n>.png    9,  3, 2, 2, 3,  2, 5, 3 flowers
pack/roots/root<n>.png                         14
pack/minerals/mineral<n>.png                  100
pack/seeds/seed<n>.png                         27
pack/seeds/seed_icons/seed<n>.png               27
```

`PLANT_TYPES` in `assets.ts` is whatever the pack holds, so a new plant folder is a new plant type with no code change. Sprite sizes are per plant (35×7 for `plant_1`, roots, minerals and seeds; 45×7 for `plant_3`; down to 15×8 for a `plant_7` stem) and the view reads each one's natural size before scaling it by `PIXEL_SCALE`, so a folder can hold whatever the drawing needs.

### Figma handoff

The production Figma library keeps source sprites at exact native 1x size. Its `EXPORTS` section maps export frames to repo destinations; `figma/exports.json` is the machine-readable copy of that contract. Run `npm run verify:figma-assets` after changing sprites or the Figma export surface. It checks all mapped PNG paths and native dimensions, and requires every file under `src/assets/**` to be represented either by a Figma export or an explicit repo-source-only reference. `stars_pattern.gif` and the original brand PNGs remain repo-source-of-truth rather than Figma round-trips.

The first web build carried the twelve `plant_1` sprites bundled with the plugin, under their names there (`plant_1_part3.png`, `plant_1_flower2.png`). Gardens saved then still hold those paths, so `asset-paths.ts` maps them onto the same ordinal in the vault naming and they keep rendering.

## Milestones

- **M0**: runs in a browser, localStorage, deployed on Vercel. Done.
- **M1**: Supabase auth + sync, PWA. Same garden on phone and desktop. Done.
- **M2**: Chrome extension (new tab + side panel), service worker, per-surface camera, hardened sync. Done.
- **M3**: Obsidian import/export in the UI, the extension popup (one plant at a time), and the Obsidian plugin on the same backend. Done. Custom images are out of scope for now.
- **M4**: shared gardens (invite by link, live co-editing, merge on conflict). Done.
