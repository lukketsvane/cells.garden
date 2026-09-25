# Dev ready plugin

This is a local/private Figma plugin with functional setup, selection, approval and publishing-status controls. Build it with `npm run build:figma-publisher`, or download `/figma-publisher.zip` from the deployed web app. It has no external network permission and contains no credentials.

**Connect artwork** uses the existing native-image linker in the exact confirmed master. **Dev ready** retains independent image-fill copies and saves a named version containing the approved paths and image hashes. The backend publishes only that immutable version, never a newer draft. Source image fills may be edited again while the approval waits in the queue.

The retained copies live in **PUBLISHER / immutable image checkpoints**, outside EXPORTS and the editable source components. They are locked frames with independent image fills, not component instances. Do not delete them while an approval is pending: they keep Figma's original-image download references available. They are not an access-control mechanism; normal Figma permissions still apply.

The button's saved-version acknowledgement is **queued**, not **live**. Publishing status opens the real GitHub run. The runtime must verify the exact receipt on `dev.cells.garden`; production requires a separate explicit promotion. A failed or denied version save produces an error, not an approval.

Native PNG image fills are supported. Overlay vectors, effects, new file paths and changed pixel dimensions require a reviewed workflow change. See [PUBLISHING.md](../PUBLISHING.md) for administrator setup and production approval.
