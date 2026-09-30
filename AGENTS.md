# Working agreements for cells.garden

These apply to every automated or assisted session in this repository.

- **Language.** English for everything: code, comments, docs, commit messages, PR text, diagrams, replies. Never Norwegian.
- **No assistant mentions.** Do not name AI assistants or their vendors anywhere: files, commit messages, PR titles and bodies, branch names, contributor identity. No `Co-Authored-By`, `Generated with` or session-link trailers.
- **Commit as the repository owner.** Use `git -c user.name=tastefinger -c user.email=41840333+lukketsvane@users.noreply.github.com commit …` (or set that identity for the session). Branch names are short and descriptive, without tool prefixes (e.g. `feat/extension`).
- **Max's plugin.** The original Obsidian plugin lives untouched on the `original` branch, out of `main` and `dev` so Obsidian's review scans only what ships. It is not edited.
- **Max's visual design.** Max (`scubcoral`) owns the artwork and scene design. Fetch and compare his published asset and styling changes before merging or promoting branches. Preserve his original image bytes, colours, and layer ordering; adapt the renderer when compatibility needs fixing. Flag visual conflicts rather than silently replacing his work with an older branch.
- **Figma artwork editing.** Author graphic changes in the master Figma file and transfer its linked native exports through `npm run dev:design`. Do not redraw, recolour or restyle graphics in code. Keep the existing frontend layout and styling unless a change is explicitly requested. Local editing uses the normal application with login and sync; do not add an artwork review screen or decorative canvas wrappers.
- **Checks before pushing.** `npm run typecheck`, `npm run lint`, `npm run build` (web, extension and Obsidian plugin), `npm run test:web`; also `npm run test:ext` when touching `ext/`.
- **Public values only.** `.env` carries the Supabase URL and publishable key on purpose. The secret key never enters the repo or a build.
