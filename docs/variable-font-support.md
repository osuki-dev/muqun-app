# Variable font support for reader fonts

What Settings › Font accepts (Paste a URL… and Import a file…, "A .ttf or .otf
up to 48 MB"), what the app does with a variable font, and what was observed on
a device. Code references are on `feat/ui-2.0` (branched from `feat/fleet-app`
at `b2cae3e1`).

## How a file is accepted

Both acquisition paths end in `acceptStagedFont` (`src/theme/user-fonts.ts`),
which runs these checks, cheapest first:

1. **Size.** `checkFontSize` (`src/theme/user-font-file.ts`): an empty file is
   refused, and anything over `USER_FONT_MAX_BYTES` (48 MiB) is refused.
2. **Signature.** `sniffFontFormat` reads the first 4 bytes. The extension is
   never trusted. Only `truetype` and `opentype` pass `isSupportedFontFormat`
   (`ACCEPTED_FORMATS`).
3. **Skia parse.** `probeFont` calls `Skia.Typeface.MakeFreeTypeFaceFromData`.
   A null face is refused as `unreadable`. The same call measures advances for
   the monospace check.
4. **Tables.** `readFontTables` reads `name` (family label) and `fvar` (axes)
   through a file handle. `fontAxesFromFvarTable` keeps up to 16 visible,
   well-ordered axes (hidden axes are dropped) and stores them on the slot as
   `axes`.
5. **Registration.** `Font.loadAsync` registers the file under the slot's fixed
   alias (`registerUserFonts` / `loadUserFont`).

The settings sheet turns each refusal into a sentence in `problemSentence`
(`src/components/settings-font-sheet.tsx`).

## Supported formats

| Container / flavour                            | Signature                            | Result                                                                                                                                    | Decided in                                                                                  |
| ---------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| TrueType-flavoured `.ttf` (static)             | `00 01 00 00` or `true`              | Accepted, stored as `.ttf`                                                                                                                | `sniffFontFormat`, `ACCEPTED_FORMATS`, `fontFileExtension` in `src/theme/user-font-file.ts` |
| CFF-flavoured `.otf` (static)                  | `OTTO`                               | Accepted, stored as `.otf`                                                                                                                | same                                                                                        |
| Variable TrueType (`glyf` + `gvar` + `fvar`)   | `00 01 00 00`                        | Accepted; axes read and shown                                                                                                             | the above, plus `fontAxesFromFvarTable`                                                     |
| Variable CFF2 `.otf` (`CFF2` + `fvar`)         | `OTTO`                               | Accepted. The sniff cannot tell CFF from CFF2; Skia's FreeType and Android open both. Verified on device below.                           | same                                                                                        |
| TrueType / OpenType collection `.ttc` / `.otc` | `ttcf`                               | Refused: "This is a font collection. Muqun needs a single font file." (refused because the terminal's Skia face cannot take a collection) | `sniffFontFormat` → `'collection'`; sentence in `problemSentence`                           |
| WOFF                                           | `wOFF`                               | Refused: "This is a web font. Muqun needs a .ttf or .otf file."                                                                           | `sniffFontFormat` → `'woff'`                                                                |
| WOFF2                                          | `wOF2`                               | Refused with the same sentence                                                                                                            | `sniffFontFormat` → `'woff2'`                                                               |
| HTML page (wrong link, 404 page)               | starts with `<!do`, `<htm` or `<?xm` | Refused: "That link opens a web page, not the font file…"                                                                                 | `looksLikeMarkup`                                                                           |
| Anything else                                  | other                                | Refused: "This file is not a TrueType or OpenType font."                                                                                  | `sniffFontFormat` → `'unknown'`                                                             |

### Variable axes

| Axes in the font                           | What the app does                                                                                                                                                                                                                                                                                                                 | Where                                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wght` only                                | Shown as `Variable · wght min–max`, with a five-stop `Aa` weight row. Every interface `Text` sets `fontVariationSettings: { wght }` from the requested weight (style `fontWeight`, else `weight`, else the variant's), clamped to the axis. This lifts the 600 cap that applies to static reader fonts, so `bold` renders at 700. | `slotWeightAxis`, `userFontRegistry` / `variableWeightStyle` (`src/theme/interface-font-registry.ts`), `useVariableWeight` (`src/components/text.tsx`), `resolveUserFontStyle` (`src/hooks/use-user-fonts.ts`) |
| `wght` + `opsz` / `wdth` / `slnt` / `ital` | All visible axes are parsed and listed in the caption (weight first). Only `wght` is ever set. The other axes stay at the font's default (for example Inter's `opsz` stays at 14 at every size). Italic text uses the platform's synthetic slant, not `slnt` / `ital`.                                                            | `fontAxesSummary`; `variableWeightStyle` writes `wght` only                                                                                                                                                    |
| No `wght` (for example `wdth` only)        | Treated as static for weight: the 600 cap applies. Axes are listed in the caption.                                                                                                                                                                                                                                                | `slotWeightAxis` returns `null`                                                                                                                                                                                |
| Monospace slot                             | Axes are recorded, but nothing applies them. The terminal draws the Skia typeface at its default instance; markdown code uses the alias without variation.                                                                                                                                                                        | `literalFontFamily`, `slotFontFamily`                                                                                                                                                                          |

## What Fontsource ships

`npm pack @fontsource-variable/inter@5.3.0` and
`@fontsource-variable/jetbrains-mono@5.3.0`:

- **Only `.woff2`.** No `.ttf`, `.otf` or `.woff`. Inter has 42 files and
  JetBrains Mono 12. They are split by unicode-range subset (`latin`,
  `latin-ext`, `cyrillic`, `cyrillic-ext`, `greek`, `greek-ext`, `vietnamese`),
  by style (`normal`, `italic`), and by axis set: `wght` (weight only), plus
  `standard` / `opsz` for Inter (`opsz` + `wght`). For example,
  `inter-latin-wght-normal.woff2` is 48,256 bytes.
- `metadata.json` names the upstream: `"source": "https://github.com/google/fonts"`,
  axes `ital 0–1`, `opsz 14–32`, `wght 100–900`.
- So no Fontsource variable package can be installed in Muqun today. Even with
  WOFF2 decoding, a single subset file would cover only part of a script.

For the device test, the real upstream file was used:
`ofl/inter/Inter[opsz,wght].ttf` from `google/fonts` (876,576 bytes; tables
`GDEF GPOS GSUB HVAR MVAR OS/2 STAT avar cmap fvar gasp glyf gvar head hhea hmtx
loca maxp name post prep`). A CFF2 variable font was also tested:
`VF/SourceSans3VF-Upright.otf` from `adobe-fonts/source-sans` (538,164 bytes;
tables include `CFF2` and `fvar`).

The app's own parser, run with bun over the three files, gives:

| File                            | Sniffed    | Accepted | Family        | Axes                        |
| ------------------------------- | ---------- | -------- | ------------- | --------------------------- |
| `inter-latin-wght-normal.woff2` | `woff2`    | no       | -             | -                           |
| `Inter[opsz,wght].ttf`          | `truetype` | yes      | Inter         | `wght 100–900 · opsz 14–32` |
| `SourceSans3VF-Upright.otf`     | `opentype` | yes      | SourceSans3VF | `wght 200–900`              |

## Device test

- **Device:** Android emulator `emulator-5554` (AVD `omarchy`, API 37), the
  installed dev build `dev.osuki.muqun` 4.0.0 (1).
- **Server:** the files were served from the host with `python3 -m http.server
  8765`, and each URL `http://10.0.2.2:8765/<file>` was pasted into
  Settings › Appearance › Font › Interface › Paste a URL… › Download.
- **Bundles:** steps 1 and 2 ran on the main checkout's Metro (`feat/fleet-app`).
  Steps 3 and 4 ran on a Metro started from this worktree with the fix below.
- **Screenshots:** all under
  `/home/ryu/.cache/tmp/claude-1000/-home-ryu-Work-muqun-app/c0ff722c-2810-41ce-8abd-bc97683d3c6e/scratchpad/app-ui2/shots/`.

| #   | File                                         | Result                                                                                                                                                                                                                                                            | Screenshots                                                                                                               |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | `inter-latin-wght-normal.woff2` (Fontsource) | **Rejected**, no crash. Inline error: "This is a web font. Muqun needs a .ttf or .otf file". The slot stays on System font.                                                                                                                                       | `06-woff2-result.png`                                                                                                     |
| 2   | `Inter-opsz-wght.ttf` (google/fonts)         | **Accepted.** The slot reads "Inter · 10.0.2.2:8765" and the caption "Variable · wght 100–900 · opsz 14–32". The app switched to Inter (Home, Settings). **Bug:** the weight row drew `Aa Aa A A A`: the 500, 700 and 900 stops lost their `a` (see "Bug found"). | `07-ttf-result.png`, `07-crop-weights.png`, `08-home-inter.png`, `compare-home-top.png` (system font on top, Inter below) |
| 3   | same, with the fix                           | Weight row `Aa Aa Aa Aa Aa`, each stop measured at its own width (56, 59, 62, 64, 67 px); 700 and 900 are clearly heavier.                                                                                                                                        | `15-font-sheet-fixed.png`, `compare-weight-row-before-after-fix.png` (top: before, bottom: after)                         |
| 4   | `SourceSans3VF-Upright.otf` (CFF2)           | **Accepted.** Caption "Variable · wght 200–900"; the weight row renders all five weights correctly; the app switched to Source Sans.                                                                                                                              | `16-cff2-result.png`                                                                                                      |

### Headings above 600

App `Text` with `weight="bold"` (700) goes through the same
`variableWeightStyle` path as the weight row, which renders 700 and 900
visibly heavier than 600 (`compare-weight-row-before-after-fix.png`). Most
`weight="bold"` call sites are on the agent surfaces (header, composer,
workbench). Those were not opened, to avoid interacting with the paired
workspace on that emulator. The headings reachable from Home and Settings are
`semibold` or lighter, and with Inter they render the same as the system
font's (`compare-home-top.png`, `compare-titles.png`). That is expected: below
700 nothing changes. Before this path existed, a reader font was capped at 600
for every weight.

### Cleanup

The interface slot was switched back to "Use system font". The app keeps one
file per slot and deletes it on that switch, so there is no list to clear:
`files/fonts` in the app sandbox is empty. The dev client's bundler host was
restored to `10.0.2.2:8081`, and the HTTP server and the extra Metro were
stopped.

## Bug found and fixed

**Variable weights were measured at the default instance on Android.** Commit
`fix: measure variable reader-font weights as they are drawn on Android`
(`src/components/text.tsx`).

React Native's Android text measurement first configures the paragraph paint
with the paragraph's `fontVariationSettings` (`TextLayoutManager.updateTextPaint`).
Then each run's `CustomStyleSpan.updateMeasureState` sets the plain typeface
again and calls `setFontVariationSettings` with the same string. Android's
`Paint.setFontVariationSettings` (legacy path, AOSP `Paint.java`) returns early
when the string equals the one it already holds, so the run keeps the
non-variable typeface. Measurement used `wght` 400 (Inter's default) while
drawing used the requested weight, so any text heavier than 400 drew wider than
its box and wrapped onto a line the box was too short to show. The sheet's weight
row made it obvious (every `Aa` box was 61 px wide; the 500, 700 and 900 stops
showed only `A`). The same mismatch affects every bold or semibold label under
a variable reader font wherever the box hugs its text.

The fix applies on Android only: the app's `Text` moves `fontVariationSettings`
off the paragraph style and onto a single inner native `Text` run. The
paragraph paint then has no settings, the span's settings differ from it, and
the run is measured as drawn. Checks run: `npx tsc --noEmit`, `bun run lint`,
`bun run format:check` and `bun test src` (2089 pass); device check as in step 3.
`bash scripts/e2e.sh` was not run.

Upstream: the real fix belongs in React Native: `CustomStyleSpan.apply` should
clear the paint's variation settings before `setTypeface`. That is worth
reporting, and it would let the inner run go.

## Gaps worth closing

| Gap                        | Why it matters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Effort                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **WOFF2 / WOFF**           | Fontsource and Google Fonts' CSS API serve only WOFF2, so the most common "variable font" link a reader finds today is refused. Decoding means Brotli plus the WOFF2 `glyf`/`loca` transform reconstruction (WOFF is just zlib per table). In JS that is a Brotli decoder (~100 KB) plus about 400 lines of transform code, and it must stream to stay inside 48 MB. A native decoder (Android has none built in; iOS can open WOFF2 through CoreText since iOS 10) would be platform-split. A single Fontsource subset would still cover only part of a script, so the sheet should say so. | M–L (3–5 days with tests)                           |
| **TTC / OTC collections**  | Common for CJK system-style fonts (Noto Sans CJK, Source Han `.ttc`). Option: extract one face to a standalone sfnt on import (read the `ttcf` header, copy the chosen face's tables, rewrite offsets), then reuse the existing path. A picker is needed when there are several faces.                                                                                                                                                                                                                                                                                                       | M (2–3 days)                                        |
| **CFF2 variable OTF**      | Already works on Android (verified). Untested on iOS (CoreText supports CFF2 on iOS 11+) and in the terminal's Skia drawing at non-default weights. Needs only an iOS device pass.                                                                                                                                                                                                                                                                                                                                                                                                           | S                                                   |
| **`opsz`**                 | Inter, Roboto Flex and others draw text at the default optical size (14) at every size, so headings look slightly loose and heavy. Set `opsz` to the font size (clamped) next to `wght` in `variableWeightStyle`.                                                                                                                                                                                                                                                                                                                                                                            | S (half a day + device check)                       |
| **`ital` / `slnt`**        | Italic in a variable face that has these axes is synthesized. Map `fontStyle: 'italic'` to `slnt` = min or `ital` = 1 when present. Note that Fontsource and Google ship italics as a separate file, which the one-file-per-slot model cannot hold.                                                                                                                                                                                                                                                                                                                                          | S for the axis; M for a second italic file per slot |
| **Monospace slot weights** | A variable mono face (for example JetBrains Mono) draws at its default instance in the terminal; bold terminal runs (`terminal-transcript.tsx` `fontWeight: '700'`) do not use the axis. Needs a Skia `Typeface` per weight via variation (`MakeFreeTypeFaceFromData` + variation design position) or a cached set.                                                                                                                                                                                                                                                                          | M                                                   |
| **Text inputs**            | `fonted-text-input.tsx` passes `fontVariationSettings` to `TextInput`. `ReactEditText` may hit the same `Paint` early return; untested.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | S to verify                                         |
| **React Native upstream**  | Fix the `CustomStyleSpan` / `Paint` interaction in React Native (or carry it as a `patches/` entry with a removal condition), then remove `splitVariation`.                                                                                                                                                                                                                                                                                                                                                                                                                                  | S (patch) + native rebuild                          |
