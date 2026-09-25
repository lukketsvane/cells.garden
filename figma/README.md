# Figma asset master

Canonical master: https://www.figma.com/design/0cPckxpkUOpFeL1Dx7VHCg/cells.garden-MASTER?node-id=0-1

This Education-plan file contains all 291 PNG sources at native size under SOURCES and one linked native-size export frame per PNG under EXPORTS. The animated `stars_pattern.gif` remains Git-owned. `figma/exports.json` is the exact node contract; older Starter-team copies are not publishing sources.

Designer publishing does not use a Figma REST token. The private **cells.garden — Dev ready** plugin sends explicitly selected native PNG fills to the staging queue. GitHub polls every five minutes, validates them, commits them to `dev`, builds, and verifies `dev.cells.garden`. Production is a separate manual approval. See [PUBLISHING.md](PUBLISHING.md).
