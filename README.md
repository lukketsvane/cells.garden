# cells.garden

**Give your projects a place to grow.**

Turn a task board into a pixel-art garden inside Obsidian. Each project is a plant, each task is a cell, and every step forward changes the scene. Keep the board open to work through the details, or tuck it away and see your progress in the garden.

Start with one idea. Add what it needs. Watch it take shape.

## A garden that works like a board

The seed holds your project's name or goal. Around it, four layers give your work a home:

- **Minerals** hold the raw material: ideas, notes and things to explore.
- **Roots** hold the groundwork: plans, prerequisites and next steps.
- **Stem** holds the work in progress.
- **Flowers** hold what you have finished.

Drag cells between layers as your project moves forward. The plant changes with them. Use the layers your own way, from a small personal checklist to a shared project with many moving parts.

Choose a plant shape, change its colours and make the garden your own. Click a piece of the plant to find the task behind it. Pan and zoom to explore, then return to the board when you want to write.

## Start in Obsidian

1. Open **Settings → Community plugins → Browse**, search for **cells.garden**, then install and enable it.
2. Select the sprout in the ribbon, or run **cells.garden: Open garden** from the command palette.
3. Add a plant, name its seed and use **+** in a layer to add your first cell.
4. Move a cell into Flowers when it is done.

Works on Obsidian desktop and mobile. An account is optional: you can begin immediately and keep your garden on your device.

## The same garden, wherever you work

Open [cells.garden](https://cells.garden) in your browser, add it to your phone's Home Screen, or use the Chrome extension on a new tab, in the side panel or from its toolbar popup. Sign in with the same account to sync your garden across these places and Obsidian.

Share a whole garden or an individual plant. Assign a cell to someone who shares it; their tiny avatar stays beside the task, and the assignment appears in their notification inbox. Right-click a cell, or press and hold on touch, to find **Assign**.

Optional phone notifications can alert you when someone assigns you a cell. On iPhone and iPad, use iOS 16.4 or later, add the website to the Home Screen and open it from there. In the web app, open **Settings → Notifications → Turn on**. Tapping a notification takes you to the cell. Obsidian and the extension have the in-app inbox; phone alerts are enabled separately in the web app.

## Your work stays yours

Use **Export or import** in the garden menu to download a backup or bring a garden back. Markdown export gives you one file per plant.

Already using Max's original **Garden Cells** plugin? The command **Import this vault's garden** brings plants from its `Garden-Cells/` folder into cells.garden. Turn the original plugin off before enabling this one, as their styles can conflict.

## Privacy and account information

- **Local by default.** Without signing in, your garden stays on your device. In Obsidian, the garden, preferences and account session use the plugin's data file in your vault.
- **Optional online features.** Signing in connects to the cells.garden service, hosted on Supabase, for account access, sync, sharing and the notification inbox. Shared garden and plant members can see and edit what you share.
- **Optional push.** Turning on phone or browser notifications stores a push subscription with the service. Assignment text may appear on your lock screen. Turn notifications off in settings or sign out to stop them on that device.
- **Your notes are left alone.** The plugin reads `Garden-Cells/` only when you run the import command. It does not scan or edit the rest of your notes. Garden changes are saved in plugin data rather than written into your Markdown notes automatically.
- **Free and open source.** No paid features, ads, analytics or telemetry. Read the [privacy policy](https://cells.garden/privacy.html).

## Help and credits

Found a problem or have an idea? [Open an issue](https://github.com/lukketsvane/cells.garden/issues).

Based on Max's **Garden Cells**, whose garden design, pixel art and original plugin made this project possible. The original is preserved on the [`original` branch](https://github.com/lukketsvane/cells.garden/tree/original). Licensed under [Apache-2.0](LICENSE).

For development, see [Contributing](CONTRIBUTING.md) and the [architecture notes](docs/architecture.md).
