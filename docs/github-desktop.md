# Working on cells.garden with GitHub Desktop

For contributing art and plugin work without using the terminal, and without
stepping on anyone's changes. GitHub Desktop is the whole toolchain here: no
command line is needed for any of it.

The idea that makes conflicts rare: **`origin` on GitHub is the one source of
truth, your clone is a copy of it.** Pull before you start, work on a branch of
your own, and push often. Nothing you do locally is real to anyone else until
you push it, and nothing anyone else does reaches you until you pull.

## Set up, once

1. Install GitHub Desktop from <https://desktop.github.com>, open it, and sign
   in: **GitHub Desktop → Settings → Accounts → Sign in** to GitHub.com.
2. Make sure you have write access to `lukketsvane/cells.garden` — there is an
   invite email to accept, or ask for one.
3. **File → Clone repository → GitHub.com**, pick `lukketsvane/cells.garden`,
   choose where it goes on disk, and **Clone**. That folder is now your copy.

That is enough to add art. If you also want to run the web app, install
[Node.js](https://nodejs.org) and, in the repository folder, `npm install` then
`npm run dev` — that one does need a terminal, and nothing else does.

## The two branches that are live

| branch | deploys to |
| --- | --- |
| `main` | cells.garden |
| `dev` | dev.cells.garden |

Both are published the moment something lands on them, so neither is a place to
try things out. Never commit straight to `main` or `dev` — make a branch, push
it, open a pull request. That is what keeps a half-finished change off the site.

## Every time you sit down to work

1. **Current Branch → `main`**, then **Fetch origin** and **Pull origin**. You
   now match the source of truth.
2. **Current Branch → New Branch**, name it for what you are about to do
   (`plant-9-art`, `fix-flower-sizes`), based on `main`. Branches are free —
   make one per change rather than one for everything.
3. Do the work: add files, change files, draw.
4. GitHub Desktop lists what changed on the left. Tick the files you mean to
   include, write a summary in the bottom-left box, and **Commit to
   &lt;branch&gt;**. A commit is a save point, not a publication.
5. **Push origin.** Now it exists on GitHub, still only on your branch.
6. **Preview Pull Request → Create Pull Request.** Set the base branch to `dev`
   to try it on dev.cells.garden first, or `main` to go straight to the site.

Steps 1 and 2 are the ones that prevent conflicts. Skipping them is how two
people end up editing a week-old copy of the same file.

## Where your things live in the repository

- **`obsidian/`** — your plugin exactly as you shipped it, including your
  `src/main.ts`. Nobody edits it; it is the reference the port is checked
  against.
- **`src/assets/pack/`** — the art pack. It is a copy of your vault's
  `Garden-Assets/` folder, filenames and all:
  `plant_1 … plant_8/stem/stem<n>.png`, `…/flowers/flower<n>.png`, and
  `roots/`, `minerals/`, `seeds/` shared between plants. Because the names
  match your vault, a garden exported from Obsidian resolves on the web and
  back again.
- **`src/core/`** — the ported plugin. `garden.ts` is your `main.ts`, kept with
  the same structure so changes can be followed across.
- **`docs/`** — the architecture diagrams, and this file.

## Adding art, which is the common case

1. Branch first (step 2 above).
2. Copy the PNGs out of your vault's `Garden-Assets/` into the folder of the
   same name under `src/assets/pack/`, keeping the filenames. A whole new
   `plant_9/` folder with `stem/` and `flowers/` inside becomes a ninth plant
   type on its own — the code reads the pack, so there is nothing to wire up.
3. Leave the working copies behind: anything named `… copy`, `… bkp`,
   `minerals old`, and the `.psd` files. A folder called `plant_6 copy` would
   turn into a real plant type, and every sprite is inlined into the download,
   so duplicates cost everyone who opens the site.
4. Commit, push, open a pull request.

Sprite sizes are per plant — the view reads each image's own size — so a folder
can hold whatever the drawing needs.

## What you can safely ignore

`node_modules/`, `dist/`, `.DS_Store` and `.env.local` are already ignored, so
they will never show up in your list of changes. If you do see one, say so
rather than committing it.

## If it says there is a conflict

GitHub Desktop will name the files it cannot merge on its own.

- **Art:** never try to merge two versions of a PNG. Keep both under different
  names, or decide which one wins and delete the other.
- **Code:** open the file and look for the `<<<<<<<` markers; everything
  between them is the two versions side by side. If both sides changed the same
  lines for different reasons, ask before picking — that is a real decision, not
  a mechanical one.
- **Anything you would rather undo:** with nothing committed yet, right-click
  the file → **Discard changes**. Nothing is lost that was pushed.

## The loop, in the words on the cards

Clone → Branch → Commit → Push → Pull Request → Review → Merge. Those are the
minerals under the Git / Collaboration plant, in the order you meet them.
