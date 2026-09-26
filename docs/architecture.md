# Architecture

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
scripts/       icon generation, tests and development/release helpers
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

- Signed out: `LocalStore` (localStorage, key `cells.garden/v1`). Tabs stay in step through the `storage` event. Obsidian uses Plugin.loadData/saveData for its per-vault garden, preferences and account session. Browser storage is disabled in that build. Signed-in gardens catch up through realtime events and when the window regains focus.
- Signed in: `SupabaseStore` is primary and a per-user `LocalStore` mirrors every save, so the device keeps an offline copy and sign-out never loses anything. The whole garden is one JSON blob per owner; saves are compare-and-swap on a server revision and merge by plant and cell id when someone wrote first; realtime pushes changes to the other devices.
- Shared: an owner shares their garden by link (`#join=<token>`); members edit the same blob. See `supabase/README.md`.
- Garden spaces: more gardens than your own (New garden space in the pill menu), shared the same way.
- Assign cells: right-click or hold a cell, choose Assign, and pick people who share its garden or plant. Their small avatars stay on the cell. Assignment notices appear under Notifications in the account menu.
- Phone notifications: open Settings, Notifications, Turn on. On iPhone or iPad (iOS 16.4+), add cells.garden to the Home Screen and open it from there first. Tapping a notification opens the assigned cell. Pushes are optional and stop on this device when you turn them off or sign out.
- Garden settings (pill menu, Settings): fireflies, the sky's colours through the day or one fixed colour, minerals that fade with depth, and the standby look. They belong to the garden, so everyone who shares it sees the same; the defaults are Max's original garden.
- Collaborative plants: one plant shared by link (`#plant=<token>`) into other people's gardens; everyone who has it edits it live.
- First sign-in on a device offers the anonymous garden to an account that has none yet, once.
- Camera, kanban scroll and the divider between them are per surface (web, new tab, side panel) and stay on the device.

The `.env` file carries the Supabase URL and publishable key on purpose; both are public by design and RLS protects the data. Private credentials must never enter the repository. See `supabase/README.md` for the migrations and dashboard settings.

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

A plant's menu names each type from `PLANT_TYPE_NAMES` in `assets.ts` (Bell, Branch, Vine, Spray, Arch, Fork, Starburst, Cluster and Plume); a folder without a name goes by its own. Its seed list shows `seeds/seed_icons/seed<n>.png` for the seed `seeds/seed<n>.png`.

The first web build carried the twelve `plant_1` sprites bundled with the plugin, under their names there (`plant_1_part3.png`, `plant_1_flower2.png`). Gardens saved then still hold those paths, so `asset-paths.ts` maps them onto the same ordinal in the vault naming and they keep rendering.
