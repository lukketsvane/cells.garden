# cells.garden with GitHub Desktop

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

Steps 1 and 2 are where conflicts get avoided. Pulling first means you start
from what everyone else already has; a branch of your own means your
half-finished work sits somewhere nobody is reading from.

`main` publishes to cells.garden and `dev` to dev.cells.garden, both the moment
something lands on them. That is why the work goes on a branch and arrives
through a pull request instead.

## Folders

| folder | what it is |
| --- | --- |
| `obsidian/` | your plugin as you shipped it. It stays put as the reference the port is checked against, so changes to how the garden behaves go into `src/core/`. |
| `src/assets/pack/` | the art, under the same names as `Garden-Assets/` in your vault. |
| `src/core/` | the port. `garden.ts` is your `main.ts`. |

## Adding art

Copy PNGs into `src/assets/pack/<plant>/stem/` or `/flowers/`, keeping the
filenames. A new `plant_9/` folder becomes a ninth plant type by itself — the
code reads whatever the pack holds.

Any sprite size works; the view reads each image's own size.

Leave the vault's working copies behind: `… copy`, `… bkp`, `minerals old`,
`.psd`. A folder called `plant_6 copy` would come out as a real plant type, and
every sprite is inlined into the download, so a duplicate costs everyone who
opens the site.

## Conflicts

GitHub Desktop names the files it could not merge on its own.

- **A PNG** has no lines to merge, so one version has to win: keep both under
  different names, or delete the one you don't want.
- **Code** gets `<<<<<<<` markers around the two versions. If both sides
  changed the same lines for different reasons, ask — that is a decision, not a
  merge.
- **Anything not committed yet**: right-click the file → **Discard changes**.

## Running the web app (optional)

Install [Node.js](https://nodejs.org), then in the repository folder:

```sh
npm install
npm run dev
```
