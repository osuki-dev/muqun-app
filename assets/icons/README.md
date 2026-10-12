# Launcher artwork

The Neon design uses a cyan and coral ribbon M on a dark ink background.
The Mecha design uses a coral robot companion with cyan accents on a dark violet background.
Both opaque, full-bleed `mark.png` masters were created with the built-in imagegen tool.
Their existing Mint and Sakura native identifiers are retained so installed selections
remain valid; the picker displays Neon and Mecha respectively.

Regenerate the other styles with:

```sh
bun scripts/generate-brand-assets.ts
```

For Neon and Mecha, the iOS source and picker preview are direct copies of the
approved full-bleed masters. Both appearances use the same artwork. The native icon
plugin generates the required iOS sizes and Android density variants.
Android's background colors in `app.json` match the catalog's light backgrounds.
The checked-in `android-foreground.png` canvases were prepared with imagegen to
place the designs inside the adaptive-icon safe circle on continuous opaque
backgrounds. The script skips the two full-bleed entries and preserves their
prepared assets rather than reconstructing them from an alpha-mask template.
The shared Classic monochrome artwork remains the Android themed-icon identity.

Launcher artwork is compiled into native builds. Updating picker previews through
JavaScript alone does not replace the installed launcher resources; rebuild the
native app to deliver these replacements.
