# cells.garden

Ein kanban-hage der oppgåver veks til planter. Webport av Max sin Obsidian-plugin **Garden Cells**.

Eksisterande kode er ~4 200 linjer vanilla TypeScript i éi fil. DOM + CSS-transform, ikkje canvas. Touch/pinch er allereie implementert. Obsidian-koplinga var tynn, og porten er gjort som ein port, ikkje ei omskriving: Max sin kode ligg i `src/core/garden.ts` med same struktur som før.

## Kom i gang

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typesjekk + statisk build til dist/
npm run preview    # serverer dist/
```

Hagen blir lagra i `localStorage` (nøkkel `cells.garden/v1`). Ingen innlogging, ingen backend.

## Arkitektur

Webappen er kjernen. Extensionen er eit skall rundt same build.

- **Web** — hagen som vanleg URL
- **PWA** — same app på mobil
- **Extension** — New Tab + Side Panel

Extension:
1. **New Tab override** — hagen som startside
2. **Side Panel** — hagen langs sida medan ein jobbar

Same kode, tre distribusjonar.

## Repo

```
src/core/      kjernen (uavhengig av web/extension/Obsidian)
  shim.ts        createDiv/createEl/empty/setText/addClass … på Node/Element, som Obsidian gjer
  ui.ts, ui.css  View, Modal, Setting (60 linjer eigne)
  model.ts       datamodell, konstantar, DEFAULT_SETTINGS
  store.ts       GardenStore { load, save, subscribe? } + LocalStore
  assets.ts      AssetManager over den bundla assetpakka i src/assets/pack/
  modals.ts      Max sine tre modalar
  garden.ts      GardenView — Max sin main.ts, porta
  app.ts         GardenApp — det GardenPlugin var; eig data, settings, store
  markdown.ts    Max sitt markdown-format (frontmatter + ## Flowers/Stem/Roots/Minerals), import/eksport
  styles.css     Max sin styles.css
src/web/       index.html, main.ts, app.css (temavariablar), PWA
src/assets/    sprites; pack/<plantType>/<kategori>/ er det som var Garden-Assets/ i vaulten
public/        manifest.webmanifest, ikon
obsidian/      Max sin plugin, urørt. Heng på core seinare.
ext/           (M2) manifest v3, newtab.html, sidepanel.html
supabase/      (M1) migrasjonar + RLS
```

## Stack

- Vite + TypeScript, vanilla TS, ingen rammeverk
- Lagring bak eitt interface `GardenStore`: `LocalStore` no, `SupabaseStore` når ein er innlogga (last-write-wins på `updatedAt`)
- Heile hagen som éin JSON-blob (`Garden { version, projects, settings, updatedAt }`)
- Vercel — statisk hosting (`vercel.json`)

```ts
interface GardenStore {
  load(): Promise<Garden | null>
  save(garden: Garden): Promise<void>
  subscribe?(listener: (garden: Garden) => void): () => void
}
```

## Assets

Bileta blir bundla av Vite som data-URL-ar (som esbuild gjorde). `imagePath` på ein celle er stien relativt til `src/assets/pack/`, t.d. `plant_1/stem/plant_1_part3.png`, så han overlever markdown-eksport uendra. Pakka har i dag berre `plant_1` (stem + flowers). Roots, minerals og seeds har ingen bilete enno og blir rendra usynlege, akkurat som i Obsidian utan `Garden-Assets/`.

## Milepælar

- **M0** — køyrer i nettlesar, localStorage, deployert. ✅ (denne PR-en)
- **M1** — Supabase auth + sync, PWA med service worker. Same hage på mobil og PC.
- **M2** — extension (new tab + side panel).
- **M3** — Obsidian-import/eksport i UI, eigne bilete, Obsidian-plugin som synkar mot same backend.
