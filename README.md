# Garden Cells

Eksisterande kode er ~4 200 linjer vanilla TypeScript i éi fil. DOM + CSS-transform, ikkje canvas. Touch/pinch er allereie implementert. Obsidian-koplinga er tynn: 38 `this.app.`, 27 `vault`, DOM-hjelparar (`createDiv`/`createEl`/`addClass`) og `Modal`/`Setting`.

**Porten er éin kveld, ikkje ei omskriving.**

## Arkitektur

Webappen er kjernen. Extensionen er eit skall rundt same build.

- **Web** — hagen som vanleg URL
- **PWA** — same app på mobil
- **Extension** — New Tab + Side Panel

Extension:
1. **New Tab override** — hagen som startside
2. **Side Panel** — hagen langs sida medan ein jobbar

Same kode, tre distribusjonar.

## Stack

- Vite + TypeScript
- Vanilla TS, ingen rammeverk
- Max sin eksisterande kode blir bevart
- Vercel — statisk hosting

### Storage

```ts
interface GardenStore {
  load(): Promise<Garden | null>
  save(garden: Garden): Promise<void>
}
