# Launcher artwork

Mint uses the Relay design: a jade M-shaped companion with one coral signal fin.
Sakura uses the Fold design: two rose-coral workspace panes joined by a lilac fold.
Both transparent `mark.png` masters were created with the built-in imagegen tool.
The existing Mint and Sakura native identifiers and picker labels are retained.

Regenerate only these exports with:

```sh
bun scripts/generate-brand-assets.ts Mint Sakura
```

The script creates opaque 1024px iOS light/dark icons, transparent 1024px Android
foregrounds and 192px picker previews using the backgrounds in `catalog.json`.
Android's background colors in `app.json` match the catalog's light backgrounds.
The centered 440px foreground box fits within the adaptive-icon safe circle.
The shared Classic tinted and monochrome artwork remains the themed-icon identity.

Launcher artwork is compiled into native builds. Updating picker previews through
JavaScript alone does not replace the installed launcher resources; rebuild the
native app to deliver these replacements.
