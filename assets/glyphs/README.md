# Muqun icon sources

These SVG files are the editable source of Muqun's application icon font. They
are build inputs, never runtime SVG components. Do not edit the generated TTF,
glyph map, manifest, or `src/icons/*.generated.ts` / `src/icons/index.tsx`.

Run `bun run icons:generate` after editing sources or `src/icons/semantic-catalog.json`.
Run `bun run icons:check` before building or preparing an OTA update. The check
rejects changed sources and mismatched generated artifacts. Commit all generated
outputs with their sources. The generator uses Nano 1.0.1's stroke-to-outline
pipeline; no external font editor or network service is involved.

The semantic catalog maps app component names to SVG filenames: `ComputerIcon`
uses `computer.svg`, `SessionIcon` uses `session.svg`, and `MessageSendIcon` uses
`message-send.svg`. Consumers import components from `@/icons` or use the typed
`AppIcon` from `@/icons/app-icon`. There are no Lucide component aliases.
Stroke widths 1.5, 1.8, 2, 2.2, 2.4, 2.5, 2.6, and 3 are baked into the font;
other finite values choose the nearest weight, and non-finite values use 2.
Filled variants cover the square stop button and active keyboard shift arrow.
Custom provider marks and the spinner retain their authored stroke/fill shape.

## Provenance

All 123 interface glyphs have been drawn or redrawn for Muqun on a 24-unit
coordinate grid, with rounded endpoints and simplified interior detail. The
77 peripheral drawings previously retained from Lucide have been replaced.
The visual vocabulary deliberately keeps familiar conventions such as arrows,
clocks, page folds, and checks; their meanings are not claimed as unique designs.

`provenance.json` records each drawing's authorship and keeps the former
Lucide source in a `replaces` history entry for the 77 replacements. The historical
[LICENSE-lucide](./LICENSE-lucide) notice remains for that source history.
Brand marks are separate and are not claimed as Muqun interface artwork.
See [AUDIT.md](./AUDIT.md) for the visual review and its limits.

- OpenCode: the gallery reuses the existing `OpenCodeIcon` two-block component,
  including its secondary tone. It does not invent or regenerate brand artwork.
- `brand-codex.svg`: OpenAI mark from Simple Icons 14.15.0, CC0-1.0; provenance
  and trademark context remain in [the agent artwork notes](../agents/README.md).
- `brand-t3.svg`: T3 Code repository, `apps/mobile/assets/widget/T3Mark.svg`
  (also `assets/prod/logo.svg`), MIT, copyright 2026 T3 Tools Inc. The original
  viewBox is `7 29 111 74`. Its component keeps its proportional frame.
  See [LICENSE-t3](./LICENSE-t3).
- `brand-deepseek.svg`: Muqun's existing two-wave stand-in artwork, not the
  official DeepSeek whale mark.
- `brand-pi.svg`: Pi coding agent mark from Simple Icons, CC0-1.0, sourced
  from `pi.dev/favicon.svg`; not the unrelated Pi.ai service.
- `brand-fx.svg`: official `fx.sh` inline `logo-fx` glyph, without hover effects.
- `brand-qoder.svg`: official `qoder.com/favIcon.svg` mark, without its background
  plate and with a cropped square viewBox. The source paths are retained.
  Sources and artwork-license limits for these marks are recorded in
  [the agent artwork notes](../agents/README.md).
- `working-spinner.svg`: Muqun's existing working-state arc.

## Runtime and OTA

The generated font family contains the source hash. The generated JS module
requires the matching TTF as a Metro asset, so an OTA bundle carries its map and
font together; old updates retain their own content-addressed assets. Never
reuse a font family for changed artwork or ship only the glyph map.

`AppIconsReady` holds the application beneath its error boundary until the font
is registered, including cold launch and OTA launch. Registration failures and
timeouts reach the existing retry screen. Existing binaries without Nano use
its explicit-family Text fallback loaded by `expo-font`; the optimized native
view needs a fresh native build (and `pod install` on iOS). The glyph family,
weight, and font scaling are isolated from user typography. Device acceptance
is required before claiming either native or older-binary compatibility.

The local adapter intentionally calls upstream Nano directly. Kit 2.0.0-beta.3's
`createNanoIconSet` expects a different glyph-map shape and passes configuration
where Nano expects a font asset. Kit receives glyphs through `IconProvider` and
the small `src/icons/kit-resolver.tsx` boundary for Kit's own controls. A Bun
source patch removes its optional Lucide runtime lookup; purpose and removal
conditions are documented in `patches/README.md`. There is no Metro alias or
legacy app component API. Neither Lucide nor react-native-svg is a runtime
dependency of this app.

Nano 1.0.1 omits accessibility props from its memo comparator. The adapter keys
the native glyph on those semantics so changed labels are applied. Remove this
workaround after upstream compares those props. Its coalesced font-load promise
also absorbs errors; the startup gate performs an explicit idempotent load after
auto-registration settles so it can report failures. Remove the second load
once the upstream coalesced promise propagates registration failures.
