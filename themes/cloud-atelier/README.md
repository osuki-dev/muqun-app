# Cloud Atelier

A complete optional Muqun skin built around an illustrated cloud observatory:
periwinkle daylight, warm ivory paper, slate-blue night, brass instruments, and
a small sleeping cat. This is a separate theme, not a recoloring of Comic Bloom.

## Build and install

From the repository root:

```sh
bun test themes/cloud-atelier/theme.test.ts
bun scripts/build-theme-pack.ts themes/cloud-atelier
```

The output is `dist/themes/cloud-atelier.muqun-theme`. The existing builder checks
the manifest, text contrast, image headers, SHA-256 hashes, and byte-exact archive
round-trip. Import that archive through Settings > Theme > Import > Import file,
review both modes, then apply it. No network access is required by the theme.

This is an unreleased production-intended pack. Package validation is complete;
real App import, export/reimport, cold start, and phone/iPad visual acceptance
must still be recorded before publishing these exact bytes to GitHub.

## Complete skin

Each mode includes a full-height scene and a separately composed wide scene.
Regular-width windows select the wide scene; compact windows select the portrait
scene. Navigation, tabs, composer, actions, cards, primary buttons, and the empty
state receive coordinated artwork. Textures use `cover`, never repeated tiles.
The night primary button uses pale periwinkle artwork with dark label ink.

The home name and logo remain Muqun. No separate home banner is installed.
Terminal backgrounds remain opaque by default; the App's transparent-terminal
control is an explicit user preference. Artwork on controls is contrast-limited
over an opaque color base, while scene images remain full-strength. Disabled,
selected, and loading controls preserve their normal interaction states.

## Artwork sources and runtime assets

The twelve original PNGs in `assets/` are imagegen-created production masters.
Do not overwrite them. Four scene masters are packaged at their original size.
The chrome, panel, action, and empty-state pairs use eight `-512.png` runtime
derivatives, bounded to 512 pixels on the longest edge to limit texture memory.

To regenerate a derivative on macOS:

```sh
sips -Z 512 themes/cloud-atelier/assets/chrome-light.png --out themes/cloud-atelier/assets/chrome-light-512.png
```

Repeat for each chrome, panel, action, and empty light/dark master, then update
the corresponding manifest SHA-256. Resizing preserves the artwork composition;
no new images or material are generated during packaging. The builder rejects
stale hashes. Comic Bloom's files and earlier artwork remain independent.
