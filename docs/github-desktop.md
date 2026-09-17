# cells.garden with GitHub Desktop

No terminal needed.

## Setup, once

1. Install GitHub Desktop: <https://desktop.github.com>
2. Sign in: **Settings → Accounts → GitHub.com**
3. **File → Clone repository → lukketsvane/cells.garden → Clone**

## Every change

1. **Current Branch → `main`**, then **Fetch origin**, then **Pull origin**
2. **Current Branch → New Branch**, name it, based on `main`
3. Change files
4. Bottom left: tick the files, write a summary, **Commit**
5. **Push origin**
6. **Preview Pull Request → Create Pull Request**, base `dev`

Steps 1 and 2 are what prevent conflicts. Don't skip them.

## Never commit to `main` or `dev`

Both are live the moment something lands:

| `main` | cells.garden |
| --- | --- |
| `dev` | dev.cells.garden |

Always a branch, then a pull request.

## Folders

| `obsidian/` | your plugin, as you shipped it. Don't edit. |
| --- | --- |
| `src/assets/pack/` | the art. Same names as `Garden-Assets/` in your vault. |
| `src/core/` | the port. `garden.ts` is your `main.ts`. |

## Adding art

1. Branch first.
2. Copy PNGs into `src/assets/pack/<plant>/stem/` or `/flowers/`, keeping the filenames.
3. A new `plant_9/` folder is a new plant type. No code to write.
4. Leave out `… copy`, `… bkp`, `minerals old`, `.psd`. A folder named `plant_6 copy` would become a real plant type.
5. Commit → Push → Pull Request.

Any sprite size works. The view reads each image's own size.

## Conflicts

- **PNG** — never merge. Keep both under different names, or pick one.
- **Code** — find the `<<<<<<<` markers. Ask if both sides changed the same lines.
- **Undo, not yet committed** — right-click the file → **Discard changes**.

## Running the web app (optional)

Install [Node.js](https://nodejs.org), then in the repository folder:

```sh
npm install
npm run dev
```

## The loop

Clone → Branch → Commit → Push → Pull Request → Review → Merge
