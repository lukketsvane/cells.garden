# Figma source and migration status

The owner-confirmed master is:

https://www.figma.com/design/Q9lb9XG2ftZZHswUg5zYkS/cells.garden?node-id=27-1966

Use this existing file. Do not create another copy or send the designer to the
previous `WJgKfsKcxUpuNkDvxI9gEx` file.

## Current state

`exports.json` still records the legacy copy's export mapping. It is retained
so the repository can verify and build its existing artwork without inventing
replacement node IDs. It is **not an active connection to the confirmed master**.

Both the full and targeted sync commands now stop before token handling,
network access or image writes when the mapping targets any other file.
`scripts/figma-source.mjs` owns this source check. The GitHub Actions asset
contract job runs its regression tests, including no-network/no-write checks.
The deployed artwork and normal builds remain unchanged.

The last successful master inspection found the existing ASSETS page and source
components, but no EXPORTS section, Void Tile or CATEGORY ICONS frame. The next
Figma write was refused by the file team's call limit. The migration has not
been completed; nothing in this document claims otherwise.

## Resume in the same master

1. Restore editing/tool access to the linked master file. Keep its file key.
2. Inspect current nodes again; preserve the designer's existing edits.
3. Create the missing EXPORTS section and native-size wrappers with linked
   instances. Reuse existing source components only after checking their art,
   original image fills and dimensions. Bring over missing repo-backed assets
   without resizing their pixel grids or replacing existing master artwork.
4. Replace the legacy mapping in `exports.json` with the master's actual file,
   page, section, source and export IDs. Matching IDs between copies are not
   evidence of matching content. Do not change only `fileKey`.
5. Verify the entire mapping and native image dimensions before publishing.
   Handle the animated GIF explicitly; do not silently flatten it into PNG.
6. Run `node --test scripts/figma-source.test.mjs`,
   `npm run verify:figma-assets` and the usual repository checks. Then perform
   a targeted sync, inspect its diff and only then validate the complete sync.

Sync access and Figma editor access are separate. The GitHub workflow's
`FIGMA_TOKEN` must be permitted to read this master file. Do not paste tokens
into chat, Figma descriptions or committed files.
