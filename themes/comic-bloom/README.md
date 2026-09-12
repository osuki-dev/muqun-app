# Comic Bloom

A real, optional cute comic-style theme in development for Muqun, with blush paper,
hand-inked hearts and stars, soft halftones, and a matching muted-plum night palette.
It does not replace or add images to existing built-in themes.

## Current status

The light/dark manifest and coordinated scene and surface images form an installable
offline package. Run `bun scripts/build-theme-pack.ts` from the repository root
to create `dist/themes/comic-bloom.muqun-theme`. The builder validates the schema,
contrast, image structure, SHA-256 hashes, and byte-exact archive round-trip.
In Settings > Theme, choose Import > Import file, select that package, inspect
both previews, and choose Apply theme. This remains an unreleased development
pack while the complete device and platform gates are in progress.

## Artwork

- `assets/scene-light.png` and `scene-dark.png`: full-height blossom garden scenes
- `assets/scene-wide-light.png` and `scene-wide-dark.png`: separately composed wide scenes for regular-width windows
- `assets/chrome-light.png` and `chrome-dark.png`: matching navigation and tab textures
- `assets/panel-light.png` and `panel-dark.png`: quieter card and action-sheet textures
- `assets/action-light.png` and `action-dark.png`: berry and blush primary-button textures
- `assets/empty-light.png` and `empty-dark.png`: pairing-state blossom messenger illustrations

The original PNGs remain production masters. Packaged surface textures and illustrations
use `-512.png` derivatives to control memory, repeat density, and download size. On macOS,
reproduce a derivative with `sips -Z 512 assets/chrome-light.png --out assets/chrome-light-512.png`
and the equivalent command for each chrome, panel, action, and empty light/dark master.
Update the manifest hash after regeneration; the package builder rejects stale hashes.
Scenes retain their full resolution. Resampling changes dimensions, not artwork content.

The flagship uses the shared shell rather than a separate Home banner. Navigation,
composer, command tabs, shared cards, and action surfaces have matching image slots.
The adjusted ANSI palette supports an 85% minimum terminal background opacity in
both modes while protecting normal text, links, the cursor, and all declared ANSI
foregrounds against the default background. The default remains opaque; explicit
ANSI background cells do not become transparent. Interactive surfaces share the
remaining contrast budget between their color fill and artwork to preserve
token contrast; selected, disabled, and loading controls retain their native states.
The optional banner remains available to other themes but is not used by this pack.
The earlier paper and garden assets are retained as source explorations, not packaged.

Generated with the built-in imagegen tool. The dark wallpaper edits the light
wallpaper to keep the composition consistent. Both leave the content area quiet.
Do not use the discarded Sea Glass concept in this pack.

## Publication gate

Complete both color variants and any approved optional decorations, validate the
manifest, then use the real App flow to import, preview, apply, export, and reimport.
Verify phone and iPad layouts and an offline cold start. Publish the same tested
bytes to GitHub with English installation instructions and checksums; do not
invent a public download URL before publication.

## Generation prompts

### Light wallpaper

Use case: illustration-story. Asset type: finished LIGHT MODE wallpaper for a cute comic-style custom theme in a phone and iPad productivity app, not a mockup. Create a square full-bleed illustrated pale blush paper background with charming hand-inked manga-style abstract starbursts, tiny heart doodles, scalloped cloud-like marks and sparse soft halftone screen-tone patches only around the outermost edges. Delicate dark plum linework, blush pink, butter yellow and pale lilac accents. The central 80 percent must remain essentially empty very pale pink paper, with only extremely subtle grain, to keep interface text and cards legible. The decoration must feel sweet, hand-drawn, polished and coherent, not childish clipart. Small sparse motifs, not a dense pattern. No characters, no existing intellectual property, no text, no lettering, no fake interface, no panels, no frames, no phone hardware, no watermark. Works cropped to portrait or landscape; edge decoration is intentionally nonessential. One finished background image only. +

### Dark wallpaper

Use case: lighting-weather. Asset type: DARK MODE partner of a production cute comic-style app wallpaper. Use the provided light wallpaper as edit target. Preserve the exact composition, empty central space, tiny hand-drawn hearts, starbursts, cloud-like edges, line weights, sparse halftone patches and charming manga stationery character. Change only the palette and illumination into a truly dark muted plum paper background (#211C2B approximately), with subdued dusty pink, muted lavender and soft butter-yellow linework at the extreme edges. The central 80 percent must stay uniformly dark plum with only almost invisible fine paper grain, keeping light terminal and interface text legible. No luminous center, no gradients glowing behind text, no neon bloom, no added objects, no text, no logos, no interface, no borders, no watermark. Keep the same square framing and restrained contrast. A finished background asset, not a comparison sheet.
