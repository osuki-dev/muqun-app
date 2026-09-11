# Comic Bloom garden artwork

Generated with the built-in imagegen tool. These are production theme assets,
not UI mockups. Existing paper backgrounds served as style references.

## Light banner

Use case: illustration-story. Production light-mode home decoration banner.
Two tiny rounded blossom sprites exchange a star envelope in a tulip garden,
with a small cloud and sparse hearts and stars. Fine plum manga ink, soft
strawberry pink and butter yellow watercolor, subtle screentone shading.
Wide 2:1 composition with generous breathing room and complete subjects away
from crop edges. Pale blush paper background. No text, UI, logos, borders,
checkerboard, or 3D rendering.

Output: `assets/garden-light.png`.

## Dark banner

Use case: lighting-weather. Edit the approved light banner, preserving its
characters, star envelope, expressions, garden layout, crop, and aspect ratio.
Change the palette to deep aubergine paper (#241E2C), rosy lavender and muted
blossom pink characters, dusty rose ink, butter yellow stars, and muted sage
foliage. Restful night palette, no neon or glow haze. Use the existing dark
paper only as a palette reference. No text, UI, logos, borders, transparency,
or side-by-side comparison.

Output: `assets/garden-dark.png`.

Both assets are opaque PNGs. Render as bounded decorative artwork with contain
fit; do not stretch into full-screen backgrounds or place text over the scene.
The application must keep primary controls and terminal content on readable
token-based surfaces. Native screenshots and package reimport remain the
acceptance criteria for integration.
