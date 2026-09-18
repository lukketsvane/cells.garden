# Contributing

Thanks for helping the garden grow. The [README](README.md) covers what the project is and how it fits together.

## Setup

```sh
npm ci
npx playwright install chromium   # once, for the browser tests
npm run dev                       # http://localhost:5173
```

## Checks

Run these before opening a pull request:

```sh
npm run typecheck    # also typecheck:ext, typecheck:obsidian, typecheck:test
npm run lint         # the rules Obsidian's plugin review applies
npm run test:unit
npm run build        # web (dist/), extension (dist-ext/) and Obsidian plugin (obsidian-plugin/)
npm run test:web     # uses port 4173
```

Also run `npm run test:ext` when you touch `ext/`, and `npm run test:obsidian` when you touch `obsidian-plugin/`. Commit the rebuilt `obsidian-plugin/main.js` and `styles.css`.

## Where things live

- `src/core/`: the app itself, shared by every surface.
- `src/web/`: the web app and PWA shell.
- `ext/`: the Chrome extension, see `ext/README.md`.
- `obsidian-plugin/`: the Obsidian plugin source and its committed build.
- `supabase/`: migrations and backend notes.
- `scripts/`: icon generator and test runners.

## Conventions

- English everywhere, short copy, no em-dashes.
- The garden view follows Max's original plugin (the `original` branch); keep its graphics, animation and layout as they are.
- No tool or assistant trailers in commit messages.
- Branch names are short and descriptive, e.g. `feat/extension`.
