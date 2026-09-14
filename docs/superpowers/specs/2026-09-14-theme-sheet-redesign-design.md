# Theme sheet redesign: tabs, a browse sheet, and an install that keeps drawing

Date: 2026-09-14. Branch: `feat/theme-sheet-redesign`, from `main` at `b19ba4c`.
Status: design approved, not implemented. This document is the contract the
implementation is measured against; it describes intended behaviour, not
completed device validation.

## Goals

1. **Separate the two questions the theme sheet asks.** "Which of the 24 packs
   that ship with the app?" and "which of the themes I installed?" are different
   questions sharing one scroll. A segmented control in the settings house style
   makes each one a whole screen instead of half of one.
2. **Give the catalogue a surface.** Browsing themes published at muqun.dev is
   currently an inline panel inside an already-long sheet, capped at a 420pt
   `ScrollView`. It becomes its own native form sheet with a virtualized list,
   client-side paging, a cached index, and a preview image per row.
3. **Stop the install from freezing the app.** Between the end of the download
   and the first asset landing, the JS thread is held by a pure-JS inflate and a
   byte-wise CRC32; nothing repaints, so a tap on a catalogue row looks ignored.
   Make the work cooperative and report phases while it runs.
4. **Keep the offline E2E gate honest.** Every new surface gets assertions that
   a device with no network can actually make.
5. **Nothing in it snaps.** 注意交互动画 不要太硬了 — every state change this
   redesign introduces is a transition, not a swap: tabs cross-fade, rows arrive,
   the progress bar slides, the cover fades up out of its placeholder. All of it
   from the presets already in `src/lib/motion.ts`; no new timings. See _Motion_.

## Non-goals

- **Search, sort or filter in the browse sheet.** Not this round. The catalogue
  is small enough to scroll, and a search field in a form sheet drags the
  keyboard question in with it (see `_layout.tsx:296-303`, where `artifacts`
  takes a full detent precisely because of its search field).
- **Native byte-level download progress.** The transport resolves one `Uint8Array`
  (`modules/theme-transport/src/MuqunThemeTransport.types.ts`); there is no
  streaming callback. The download phase stays indeterminate.
- **Persisting the catalogue across app launches.** See _Data & caching_.
- **Changing the theme manifest schema.** `preview` already exists in the
  manifest as an asset id. The only schema change here is to the _index_
  document, which is not a pack.
- **Re-theming the built-in grid, the tile, or the palette strip.** They move
  under a tab; they do not change.
- **New motion tokens.** Every transition in _Motion_ is composed from
  `src/lib/motion.ts` as it stands. If something genuinely has no preset, that is
  a finding to report, not a literal to write.
- **Touching `skills/muqun-theme/SKILL.md`.** It is generated from
  `src/theme/authoring.ts`, and it currently fails `bun run format:check` on
  `main`. That failure is pre-existing and out of scope; do not "fix" it, and do
  not run `bun run format` repo-wide while it stands (it would rewrite that file
  and put an unrelated diff in this branch). Format only the files this work
  touches.

## Current state

Facts, with the lines they came from.

### The sheet

- `src/app/settings-theme.tsx` is the route; the frame belongs to the component
  (`settings-theme.tsx:8-16`). `_layout.tsx:324-332` presents it as a
  `formSheet` with `sheetAllowedDetents: [1]`, `sheetGrabberVisible: true` and a
  transparent content background.
- `SettingsThemeSheet` (`src/components/settings-theme-sheet.tsx:54-117`) renders
  `SettingsSheet` → `CustomThemeLibrary` → the built-in grid as `children`
  (`settings-theme-sheet.tsx:96-114`). The grid is `THEME_PACKS.map` over
  `ThemePackTile` (`settings-theme-sheet.tsx:104-112`), sized by
  `themePickerGridLayout` (`src/lib/theme-picker-layout.ts:17-30`): 1/2/3/4
  columns at 0/320/720/960pt of measured content width.
- `THEME_PACKS` holds **24** packs (`src/constants/theme-packs.ts:742-765`).
  Two comments still say thirty-two (`settings-theme-sheet.tsx:10` and
  `_layout.tsx:321`); they are stale and are not this change's problem.
- `ThemePackTile` composes its test identifier as
  `settings-selection:<on|off>:theme-<pack.id>` (`settings-theme-sheet.tsx:153`)
  and carries the pack's name as its `accessibilityLabel`.

### The library block

`src/components/custom-theme-library.tsx` renders, when `browsing` is true
(`custom-theme-library.tsx:132`, `:246`):

- the "Current theme" summary with `ThemePaletteStrip` — `testID="theme-current-summary"`
  (`:248-256`);
- the button row: `theme-browse`, `theme-import`, and a conditional `Undo`
  (`:257-282`);
- the Import panel (`theme-import-link`, `theme-import-file`) at `:283-318`;
- the inline `ThemeGallery` at `:319-329`, toggled by `galleryOpen`;
- `ThemeLinkImport` at `:330-341`;
- the **My themes** list at `:594-686` — a heading, then one row per installed
  theme with `ThemePaletteStrip`, name, `Check` or `ChevronRight`, and a `Trash2`
  button. The row's test identifier is `theme-row-<manifest.id>` (`:605`) and
  the remove button's is `theme-remove-<installed.id>` (`:643`);
- `children` last (`:687`), which is where the built-in grid lands.

`CustomThemeLibrary` has three other hosts, all of which pass `initialManifest`
or `initialCandidate` and therefore have `browsing === false`:
`src/app/custom-theme.tsx:67`, and `src/components/asset-viewer.tsx:404` and
`:416`. None of them see the tabs.

### The catalogue

- `src/theme/gallery.ts:26` — `THEME_GALLERY_BASE = 'https://muqun.dev/api/themes/'`.
- `gallery.ts:29` — `THEME_INDEX_MAX_BYTES = 512 * 1024`, the bound on the index.
- `gallery.ts:32-45` — `ThemeIndexEntry`: `id`, `name`, `version`, `author?`,
  `license?`, `description?`, `tags?`, `package`, `bytes`, `sha256?`, `assets?`.
- `gallery.ts:61-114` — `parseThemeIndex` drops a malformed row rather than the
  document, and carries an optional field only when it is the right type.
- `gallery.ts:126-130` — `themePackageUrl` resolves through `publicThemeUrl` and
  then requires the result to start with `THEME_GALLERY_BASE`, so an entry
  cannot name another host.
- `gallery.ts:133-145` — `loadThemeIndex` calls `transport.get` **directly**. It
  therefore has no redirect handling, no JS-side timeout and no `text/html`
  guard; those live in `download()` (`src/theme/remote-import.ts:67-114`), which
  this path does not use. The only timeout is the native client's: 30s call /
  15s connect / 15s read on Android
  (`modules/theme-transport/android/.../PublicThemeClient.kt:36-38`) and 30s on
  iOS (`modules/theme-transport/ios/ThemeTransportService.swift:20`).
- `src/components/theme-gallery.tsx` is the inline panel: index read on mount
  (`:72-91`), a plain `ScrollView` capped at `maxHeight: 420` (`:168`), rows
  keyed `theme-gallery-item:<id>` (`:175`), the pressed row dimmed and every row
  disabled while one is downloading (`:176`, `:183`), and `ThemeImportProgress`
  under the pressed row (`:203-211`). It exports `themeGalleryAvailable`
  (`:19`), which has **no callers**.
- The transport contract exposes `{ status, location?, contentType?, bytes }`
  and nothing else (`MuqunThemeTransport.types.ts`, enforced at
  `src/theme/transport-bridge.ts:41-52`). **There is no ETag, no
  `Last-Modified`, and no way to send `If-None-Match`.** Adding one is a
  `contractVersion` bump (`transport-bridge.ts:12`) plus two native
  implementations.

### The install path, and where it stops drawing

`ThemeGallery.open` (`theme-gallery.tsx:93-136`) does:

1. `inspectRemoteTheme(..., { format: 'package' })` — `download()` awaits the
   native transport (async, off the JS thread), then calls
   `unpackTheme(result.bytes, signal)` **synchronously** (`remote-import.ts:144`).
2. `unpackTheme` (`src/theme/package.ts:107-188`) is entirely synchronous. Per
   entry it pushes the compressed bytes through fflate's pure-JS `Inflate` in
   1 KiB slices (`package.ts:165-168`) and then runs `crc32(output)`
   (`package.ts:170`), which is the byte-at-a-time table loop at
   `package.ts:21-25`. `throwIfThemeAborted` is checked per slice, but nothing
   ever yields to the event loop.
3. `prepareThemeAssetStream` → `stageThemeAssetStream`
   (`src/theme/asset-stream.ts:32-94`) iterates the generator from
   `remote-import.ts:160-181`. Per asset it calls `inspectThemeImage`
   (`asset-stream.ts:65`), `port.hash` (`asset-stream.ts:66`) and
   `port.writeAndDecode` (`asset-stream.ts:74`).

Costs, separated by who pays them:

- `Inflate` and `package.ts`'s `crc32` are **pure JS**. A 25 MiB package's CRC
  alone is 25M iterations of an 8-bit loop.
- `inspectThemeImage` (`src/theme/image-inspection.ts:200-212`) is a container
  parser, not a pixel decoder. For JPEG and WebP it walks markers and chunks and
  is cheap. **For PNG it CRC32s every chunk's full payload**
  (`image-inspection.ts:45` calling `image-inspection.ts:22-29`), which for an
  8 MiB PNG is another 8M iterations of a bit-at-a-time loop — the inner loop
  here is per-bit, not table-driven, so it is ~8x the cost per byte of
  `package.ts`'s.
- `port.hash` is `QuickCrypto.createHash('sha256')` (`src/theme/assets.native.ts:20`)
  — native JSI, not a JS hot loop.
- `port.writeAndDecode` awaits `Image.loadAsync` (`assets.native.ts:162`), which
  **is** a real yield. So the asset phase already hands the frame back once per
  asset; what it does not do is hand it back before the PNG inspection.

Net: the reader sees a pressed row, then a frozen app for the whole unpack, then
progress that moves per asset with a PNG-sized stall in front of each one.

### The duplicated inspection

`remote-import.ts:176` calls `inspectThemeImage(bytes)` and **discards the
result**. `asset-stream.ts:65` calls it again on the same bytes and uses the
result (`info.format` at `asset-stream.ts:71`, and the dimensions at
`assets.native.ts:162-172`, which cross-checks them against the native decode). The generator at
`remote-import.ts:160-181` has exactly two production consumers —
`src/components/theme-link-import.tsx:123` and `src/components/theme-gallery.tsx:113`
— and both hand it straight to `prepareThemeAssetStream`, which is
`stageThemeAssetStream`. The one test consumer
(`src/theme/__tests__/asset-stream.test.ts:101`) does the same. So no byte
leaves that generator without passing `inspectThemeImage` inside staging.

`src/theme/git-import.ts:191` has the identical discarded call in its own
generator, for the same reason and with the same consumers.

### The preview cover

`main` added it two commits ago, on the authoring side only:

- `222fd8f` — the bundled skill now requires one preview image per pack, declared
  in `assets` and named in the manifest's `preview` field
  (`src/theme/authoring.ts`, skill 1.4.0).
- `b19ba4c` — its size is **1024x640** (8:5), chosen to sit inside the artwork
  limits the checks already accept: 0.66 MP against `THEME_LIMITS.imagePixels`
  of 16M (`src/theme/schema.ts:9`).
- The manifest's `preview` is an **asset id** (`identifier` shape in the schema),
  pointing into `assets`, i.e. the cover is a file **inside the pack**, at
  `assets/<name>.(png|jpg|jpeg|webp)`. It is optional for installs and required
  only by the themes repository's own checks.
- `docs/theme-contract.md:79-81` already lists `description`, `tags` and
  `preview` as gallery metadata added in v1 "because it could not be added
  later".

The consequence for this work: **a gallery cannot show the cover without
downloading the pack**, because the cover is inside the pack. That is exactly
the thing the browse list must not do — `gallery.ts`'s own docblock
(`gallery.ts:11-17`) says the whole point of the index is that nothing is
fetched until a reader asks for a particular theme.

### Motion, today

- `src/lib/motion.ts` is the app's single source of interaction motion
  (`motion.ts:1-16`): `DURATION` off the design system's tokens (`:45-50`),
  `PRESET` for the cases the system has already decided (`:60-66`), `PRESS.in`
  80ms / `PRESS.out` 120ms (`:80-85`), `STAGGER.card` 55 / `STAGGER.row` 32
  (`:100-105`), `EASE_OUT` (`:133-138`), `timing()` (`:182-193`), and the
  layout-animation builders `fadeIn`/`fadeOut`/`fadeInLeft`/`fadeInRight`/
  `fadeOutLeft`/`fadeOutRight`/`riseIn`/`listLayout` (`:270-333`).
- **Every builder and `timing()` already carries `ReduceMotion.System`**
  (`motion.ts:190`, `:271`, `:322`, `:332`). The check lands on the UI thread
  with the animation, so no component threads a boolean through its callbacks
  (`motion.ts:158-163`). `useReducedMotion()` is used in exactly three files —
  `status-dot.tsx:59`, `explore.tsx:1130`, `simfarm-stage.tsx:146` — and all
  three are _repeating_ animations, which `ReduceMotion.System` cannot stop.
- `src/lib/__tests__/motion-tokens.test.ts` enforces four rules, all of which
  bind this work. See _Motion_, rule list M9.
- `PressableScale` (`src/components/pressable-scale.tsx:15-49`) is the press
  primitive: `withTiming(0.985, timing(PRESS.in))` down, `timing(PRESS.out)` up,
  plus a `selection` haptic on press-in (`:33-38`).
- `SettingsSegmented`'s pill slides with `withTiming(next, timing(PRESET.segmented))`
  (`settings-segmented.tsx:83`) — **a timing, not a spring**; the design system's
  rule is "percussive, mechanical precision — no spring, no bounce"
  (`motion.ts:11-13`) and `motion-tokens.test.ts` fails any `withSpring` outside
  `lib/motion.ts`. The first placement after layout is a jump rather than a slide
  out of x=0, guarded by `placed` (`settings-segmented.tsx:73-84`).
- `ThemePackTile` cross-fades its selection wash on `timing('micro')`
  (`settings-theme-sheet.tsx:143`).
- **`custom-theme-library.tsx` and `theme-gallery.tsx` contain no entering,
  exiting or layout animations at all.** Every panel they toggle — the import
  panel, the inline gallery, the link import, the removal confirmation, the
  status message — appears and disappears on a frame. The dimming of unpressed
  gallery rows is a conditional in a plain style object
  (`theme-gallery.tsx:183`). This is the hardness the maintainer is asking about,
  and it is all in the code this redesign is replacing.
- `expo-image`'s own fade is spelled `transition={DURATION.micro}` at the two
  places it is used (`image-preview-modal.tsx:306`, `attachment-strip.tsx:104`).

### The offline E2E

- `e2e/agent-device/flows/custom-themes.ad` holds named sections; the manifest
  (`e2e/agent-device/suite.json`, `programs["flows/custom-themes"]`) supplies
  each section's `${TARGET}` and its mode. The `.ad` file never spells a target
  that the manifest drives.
- `custom-themes.ad:80-85`, section `browse-entry`: `is visible "id=theme-browse"`,
  with a comment saying it is deliberately not pressed.
- `src/theme/__tests__/e2e-fixture.test.ts:43-46` pins that: the flow must
  contain `is visible "id=theme-browse"` and must not contain
  `press "id=theme-browse"`.
- The manifest presses `settings-selection:(on|off):theme-osuki` after scrolling
  to it — which under this design requires the Built-in tab to be selected.
- The suite relaunches the app **without erasing user data**
  (`e2e/agent-device/README.md:87-88`), so anything this design persists in MMKV
  survives into the next flow.

## UI design

### A. The theme sheet (`/settings-theme`)

Unchanged above the fold: `SettingsSheet` title/caption/close, the "Current
theme" summary with its palette strip, and the Browse / Import / Undo row.

New, immediately under the button row and above everything else:

```
[ MY THEMES | BUILT-IN ]        <- SettingsSegmented, testID="theme-tab"
```

`SettingsSegmented` (`src/components/settings-segmented.tsx:44-130`) is used
as-is, with no new props. It is the same control as System/Light/Dark on the
settings page, which is the point: the reader has met it.

Ownership: **`CustomThemeLibrary` renders the control**, because it already owns
the summary, the button row, the import panel and the My-themes list, and the
built-in grid already arrives as its `children` (`custom-theme-library.tsx:687`).
It gains one prop:

```ts
/**
 * Split `children` and the personal library into two tabs.
 *
 * Only the picker sheet passes this. The detail route and the file viewer see
 * one theme at a time and have no second collection to switch to, so they get
 * today's single column and this prop never reaches them.
 */
tabs?: boolean;   // default false
```

When `tabs` is false, rendering is byte-for-byte today's. When `tabs` is true
_and_ `browsing` is true:

| Tab         | value     | Content                                                           |
| ----------- | --------- | ----------------------------------------------------------------- |
| `My themes` | `mine`    | Import panel (when open), link import (when open), installed list |
| `Built-in`  | `builtin` | `children` — the 24-pack grid                                     |

Rules:

- The Import and Import-link buttons stay in the always-visible button row.
  Pressing either **selects `mine` first, then opens the panel**. Otherwise the
  panel a reader just asked for would be on the tab they are not looking at.
  This also makes the existing E2E sequence `theme-import` → `theme-import-link`
  work whatever tab was persisted.
- `Undo` does not change the tab.
- Opening a candidate (a row press, a file, a link) sets `browsing` to false and
  the tabs disappear with the rest of the browsing block, exactly as the button
  row does today.
- `SettingsThemeSheet` drops its `Built-in themes` caption
  (`settings-theme-sheet.tsx:97`). The tab names the collection now; a heading
  under the tab that repeats it is the same word twice.

**States.**

- `builtin` — the grid, unchanged. `themePickerGridLayout` still measures the
  same container, so the column breakpoints are untouched. The switch into and
  out of it is M1.
- `mine` with themes — the heading at `custom-theme-library.tsx:596` is dropped
  (same argument as above) and the rows render as today.
- `mine` with none — today the whole block is skipped
  (`custom-theme-library.tsx:594`). Under a tab that would be a blank screen, so
  it gets one muted line and nothing else:

  > No personal themes yet. Import one, or browse the published themes.

  `testID="theme-mine-empty"`.

**testIDs.** `SettingsSegmented` composes them at `settings-segmented.tsx:122`,
so passing `testID="theme-tab"` with values `mine` and `builtin` yields exactly:

- `settings-selection:on:theme-tab-mine` / `settings-selection:off:theme-tab-mine`
- `settings-selection:on:theme-tab-builtin` / `settings-selection:off:theme-tab-builtin`

No new testID convention; this is the one the E2E already matches with
`settings-selection:(on|off):theme-osuki`.

### B. The browse sheet (`/settings-theme-browse`)

**Route.** `src/app/settings-theme-browse.tsx`, one component and a
`router.back()`, in the shape of `src/app/settings-theme.tsx`. Registered in
`src/app/_layout.tsx` next to `settings-theme` with the same options:

```tsx
<Stack.Screen
  name="settings-theme-browse"
  options={{
    presentation: 'formSheet',
    sheetAllowedDetents: [1],
    sheetGrabberVisible: true,
    contentStyle: { backgroundColor: 'transparent' },
  }}
/>
```

Full detent for the same reason `artifacts` and `git-diff` take one: this is a
list that is read by scrolling, and a partial detent halves it.

**Entry.** `theme-browse` in `custom-theme-library.tsx:258-265` stops toggling
`galleryOpen` and becomes `router.push('/settings-theme-browse')`. The
`galleryOpen` state, the inline `<ThemeGallery>` at `:319-329`, and
`src/components/theme-gallery.tsx` itself all go. `themeGalleryAvailable` goes
with it — it has no callers.

**Frame.** It cannot reuse `SettingsSheet`: that is a `ScrollScreen` root, and
react-native-screens warns "FormSheet with ScrollView expects at most 2
subviews" and then renders the sheet empty (`settings-sheet.tsx:15-19`). The
precedent to copy is `SessionArtifacts`, where the virtualized list **is** the
sheet's own root (`session-artifacts.tsx:606-680`), with `flexGrow` on the
content container so a short list still gives a full-height sheet
(`session-artifacts.tsx:634-643`).

So `src/components/theme-browse-sheet.tsx` renders exactly two subviews:

1. an absolutely-filled, `pointerEvents="none"` ground — `ThemeArtwork slot="shell.background"` plus
   a `surfaceBackground(colors.surface)` fill, copied from `settings-sheet.tsx:65-78`.
   `SessionArtifacts` paints only a flat surface; the browse sheet matches the
   theme sheet it was opened from instead, because the two are one place as far
   as the reader is concerned.
2. the `LegendList`.

Title, caption and close button go in `ListHeaderComponent`, styled like
`SettingsSheet`'s header so the two sheets announce themselves the same way,
including the Android-only grabber bar (`settings-sheet.tsx:83`).

**The list.** `LegendList` from `@legendapp/list/react-native`, already a
dependency and in use at `session-artifacts.tsx:3` and `pane-chat-view.tsx:3`
(`git-diff-view.tsx:2-3` uses the Reanimated variant).

```
keyExtractor      entry.id
recycleItems      false            // a row owns a preview image; recycling
                                   // would hand one theme's cover to another
getItemType       'preview' | 'plain'   // the two real heights
estimatedItemSize measured per type; see note
itemsAreEqual     previous === next     // entries are stable objects from the
                                        // parsed index, never rebuilt per render
onEndReached      not used              // see Paging
```

`estimatedItemSize` note: a row with a cover is the 8:5 box plus its text; a row
without is text only. Both are computed from the measured content width in the
same `onLayout` the sheet already needs, so the bucket sizes are real numbers
rather than a constant that is wrong on a Pad.

**The row.** `testID="theme-browse-item:<id>"`, `accessibilityRole="button"`,
`accessibilityLabel={entry.name}`.

**Revised on device.** The poster shape this section first described was built,
looked at on the emulator, and rejected: a full-width 8:5 cover per row fits
three themes on a phone screen, which is a gallery you scroll rather than a list
you compare. The row is a compact list row instead -- the cover as a left
thumbnail, three capped lines beside it, hairline separators -- and the numbers
below are the ones that shipped.

```
+----------------------------------------------------------+
| [cover  ]  Name                    Installed      3.8 MB  |
| [112x70 ]  Author, one line, tail-ellipsis                |
| [ 8:5   ]  Description, at most two lines, tail-ellipsis  |
+----------------------------------------------------------+
```

- Thumbnail 112x70 (8:5 kept), radius 12; the palette placeholder keeps the same
  box. Row `minHeight` 96, `paddingVertical: LADDER.snug`,
  `paddingHorizontal: LADDER.gutter`, `gap: LADDER.gap`.
- Separators are `SettingsSeparator`, through `ItemSeparatorComponent` -- the
  rows are a list on the sheet's own ground, not a stack of raised cards.
- The size sits right-aligned on the name's line, in `textMuted`, and is what
  the pressed row's spinner cross-fades in over.
- The `Installed` badge is `@osuki-dev/ui`'s `Tag`, after the name. Under a
  custom theme it drops its fill, per the one-layer rule.
- Wide layouts keep the same row at the sheet's max content width. No grid.
- Both height buckets are the same height now, so `estimatedItemSize` is the
  row's own metric rather than a number computed from the measured width;
  `getItemType` stays, for pooling.
- The header -- title, caption, close, and the status line -- is **pinned above
  the list**, not `ListHeaderComponent`. Two subviews still: the ground, and one
  `collapsable={false}` column holding the header and the list.

- **Preview** — `expo-image`'s `<Image>` with `cachePolicy="memory-disk"` (the
  policy `session-artifacts.tsx:824` already uses for thumbnails),
  `contentFit="cover"`, `recyclingKey={entry.id}`,
  `transition={DURATION.medium}`, in the 112x70 thumbnail box.
  `testID="theme-browse-preview:<id>"`.
  When `preview` is absent, fails screening, or fails to load (`onError`), the
  box falls back to a palette placeholder — the same two-swatch treatment
  `ThemePaletteStrip` gives a My-themes row — and the row's height bucket
  switches to `plain`. **Never a broken-image placeholder and never a gap**, per
  `docs/custom-theme-design.md:88`.
- **Size** — `formatAssetSize` from `src/lib/asset-display.ts`, replacing
  `theme-gallery.tsx:138`'s local `megabytes()`. One size formatter in the app.
- **Installed badge** — shown when `entry.id` equals the `manifest.id` of any
  installed theme. It is a **hint, not a guarantee**: installation identity is
  local and content-hashed and the manifest `id` is author-provided and
  untrusted (`docs/theme-contract.md:131-133`), so two different packs can claim
  one id. It therefore never disables the row; pressing still opens the preview,
  which is where the duplicate is resolved.
- **Description** — `numberOfLines={2}` with tail ellipsis. The one-line rule
  this section first carried was written for the poster row, where the cover
  carried the impression; beside a thumbnail the prose is what distinguishes two
  themes, and two lines is what the 96pt row already has room for.
- `tags` and `license` are parsed and not drawn. No room, no need.

**Paging.** Client-side only; the server has no cursor and the whole index is
already in memory, bounded to 512 KiB (`gallery.ts:29`).

```ts
const THEME_BROWSE_PAGE = 20;
const [shown, setShown] = useState(THEME_BROWSE_PAGE);
const rows = entries.slice(0, shown);
```

A footer row, not `onEndReached`. Deliberate: every newly shown row starts an
image request, and infinite scroll would fetch covers faster than anyone reads
them. The footer says what it will do:

> Load more — showing 20 of 63

`testID="theme-browse-more"`. Two strings, one footer: `Load more` is the
pressable's label and `Showing {shown} of {total}` is a caption under it, so the
count is not baked into the button's translation. It disappears when
`shown >= entries.length`.

**States.**

| State                        | testID                 | Content                                                                     |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| Reading the index            | `theme-browse-loading` | `Spinner` + `Loading themes…` (existing string)                             |
| Read, zero entries           | `theme-browse-none`    | `No themes are published yet` (existing string). No retry — nothing failed. |
| Read failed, or no transport | `theme-browse-empty`   | Heading, explanation, and a `Try again` button (`theme-browse-retry`)       |
| Rows                         | `theme-browse-list`    | The list                                                                    |
| A row pressed                | —                      | See _Tap feedback and the frozen frame_, and M3                             |

`theme-browse-empty` is the **failure** state and covers both "the request did
not succeed" and "`publicThemeTransport` is null on this build"
(`src/theme/public-transport.ts:4` — the web fallback). They read the same to a
reader and the recovery is the same button. `theme-browse-none` is the success
state with nothing in it, which is not a failure and gets no retry.

The empty state shows **translated copy, not the thrown message.** Errors raised
inside `src/theme/*` are plain English module strings (`gallery.ts:143`,
`remote-import.ts:45`) and are not in the catalogs; putting one in a full-width
empty state would show English to a Japanese reader. Copy:

> **Could not reach the theme catalogue**
> Check your connection and try again.
> [ Try again ]

`Try again` re-runs the index read, bypassing the cache.

**Tap feedback and the frozen frame.** On press the row enters its pressed state
on the same frame -- and, since the device review, is _guaranteed a frame to do
it in_. `open()` holds for `DURATION.short` after setting the pending state and
before the first network call, because everything after that call holds the JS
thread (the download resolves, then `unpackTheme` inflates the whole archive
synchronously) and React never got a commit to paint in. On a fast connection
the install finished before anything was drawn and the press looked ignored,
which is what the device review found. A matching floor after the work keeps the
acknowledgement up for at least `MINIMUM_PENDING_VISIBLE_MS`; the arithmetic is
`src/lib/minimum-visible.ts`, pure and unit-tested.

Legend List memoises a row on `[itemKey, data, extraData]`, so the pressed row
also needs the pending state in `extraData` -- with `itemsAreEqual` reporting
that a stable index entry never changes, nothing else would re-render it.

The status line lives in the **pinned header**, not under the pressed row: the
header cannot scroll away mid-download, and a growing progress block inside a
virtualized row is a layout animation fighting the list. The row's own
acknowledgement is its trailing slot, where the size cross-fades to a spinner:

- the row is a `PressableScale` (as every other pressable in this app is) rather
  than the bare `Pressable` at `theme-gallery.tsx:170`, so the press has the
  house scale response;
- an indeterminate `Spinner` (`@osuki-dev/ui`, as at `new-task-sheet.tsx:212`)
  appears in the row with the phase label beside it;
- every other row is `disabled` and dimmed to `0.5`. The target is today's
  (`theme-gallery.tsx:176`, `:183`); **how it gets there changes** — the cut
  becomes an eased opacity, see M3;
- `ThemeImportProgress` (`src/components/theme-import-progress.tsx`) renders
  under the pressed row and carries the counted phases.

The label is driven by the phase model in _Install pipeline changes_:
`Downloading…` → `Unpacking…` (with `n/m` entries) → `Preparing images` (with
`n/m` assets, the existing string and the existing bar).

**On success** the sheet hands the candidate to `useOpenThemeEditor`
(`src/hooks/use-open-theme-editor.ts:19-32`), exactly as the inline panel does
today via `onReady` → `onOpenCandidate`. `/custom-theme` is a `fullScreenModal`
(`_layout.tsx:333`) and applying from it unwinds the stack, so the browse sheet
and the theme sheet both go. That is today's behaviour from the inline panel and
is not changed here.

**Cancellation** is `ThemeGallery`'s, unchanged and for the unchanged reason
(`theme-gallery.tsx:32-40`): one owned `ThemeImportRequest` at a time, unmount
cancels it, `handoff` is the single ownership boundary, and `finally` disposes
whatever did not transfer. Moving the panel to a route makes unmount more
likely, not less — a swipe dismisses a form sheet — so this code must be carried
over intact rather than rewritten.

### Copy

New strings, all authored with `useLingui()`'s `t` rather than the global macro,
for the reason at `settings-theme-sheet.tsx:55-56`:

| String                                                                 | Where                                                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `My themes`                                                            | tab — **exists** (`custom-theme-library.tsx:596`)                                                                                        |
| `Built-in`                                                             | tab — new (short form; `Built-in themes` is being deleted)                                                                               |
| `No personal themes yet. Import one, or browse the published themes.`  | empty `mine` tab — new                                                                                                                   |
| `Browse themes`                                                        | sheet title — **exists** as the button's label (`custom-theme-library.tsx:265`); the sheet reuses it verbatim so the translation carries |
| `Themes published at muqun.dev. Nothing downloads until you open one.` | sheet caption — **exists** (`theme-gallery.tsx:145`)                                                                                     |
| `Close theme catalogue`                                                | close button label — new                                                                                                                 |
| `Loading themes…`                                                      | **exists** (`theme-gallery.tsx:160`)                                                                                                     |
| `No themes are published yet`                                          | **exists** (`theme-gallery.tsx:165`)                                                                                                     |
| `Could not reach the theme catalogue`                                  | empty state — new                                                                                                                        |
| `Check your connection and try again.`                                 | empty state — new                                                                                                                        |
| `Try again`                                                            | retry — new                                                                                                                              |
| `Installed`                                                            | badge — new                                                                                                                              |
| `Load more`                                                            | footer — new                                                                                                                             |
| `Showing {shown} of {total}`                                           | footer — new                                                                                                                             |
| `Downloading…`                                                         | phase — new (replaces `Downloading theme`, `theme-gallery.tsx:206`)                                                                      |
| `Unpacking…`                                                           | phase — new                                                                                                                              |
| `Preparing images`                                                     | phase — **exists** (`theme-gallery.tsx:206`)                                                                                             |

## Motion

The maintainer's note is the requirement: **不要太硬了** — no hard swaps. Every
state change below names its preset, its duration token and its easing, so the
implementer chooses nothing. All of it composes `src/lib/motion.ts`; none of it
adds a timing.

Reduce motion needs **no call-site handling anywhere in this section**. Every
builder in `motion.ts` and `timing()` itself carry
`.reduceMotion(ReduceMotion.System)` (`motion.ts:190`, `:271`, `:322`, `:332`),
which resolves on the UI thread: with the accessibility setting on, each
transition below lands instantly at its end state and the layout still settles
correctly. Do **not** add `useReducedMotion()` — the three files that use it do
so only because they run repeating animations, and nothing here repeats. Where a
fallback is worth stating explicitly it is stated per item.

### M1 — Tab switch, My themes ↔ Built-in

| Part             | Motion                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| The pill         | Already `withTiming(next, timing(PRESET.segmented))` (`settings-segmented.tsx:83`). Nothing added. |
| Outgoing panel   | `exiting={fadeOutLeft('short')}` moving right, `fadeOutRight('short')` moving left                 |
| Incoming panel   | `entering={fadeInRight('short')}` moving right, `fadeInLeft('short')` moving left                  |
| Container height | `layout={listLayout('short')}` on the wrapper that holds whichever panel is mounted                |

- Direction comes from the tab's index: `mine` is 0, `builtin` is 1. Moving to a
  higher index, the old content leaves to the left and the new arrives from the
  right; moving back, the mirror. This is what makes it read as one strip sliding
  rather than two independent fades.
- `'short'` (the token the four builders already default to, `motion.ts:287-303`)
  is "a control changing its mind" (`motion.ts:42-43`), which is exactly what a
  segmented control is. Not `'medium'` — that is one surface replacing another,
  and these two panels are the same surface.
- Travel distance is the builders' own; **do not** call `.withInitialValues` to
  override it. `riseIn` is the one place in this app that overrides a translation
  (`motion.ts:318-323`) and it has a reason written down.
- The two panels must be a **conditional render with `key={tab}`** on an
  `Animated.View`, so React unmounts one and mounts the other and Reanimated's
  `entering`/`exiting` actually fire. Rendering both and toggling `display` would
  produce no animation and would keep 24 tiles mounted behind a list.
- The height change is a content-height change, not a sheet-height change: the
  sheet is already at its single full detent (`_layout.tsx:328`) and
  `SettingsSheet`'s `ScrollScreen` grows inside it. Going from a 24-tile grid to
  a three-row list is a large delta, which is precisely why `listLayout` is on
  the wrapper — without it the scroll content jumps and the sheet's scroll
  position lands somewhere the reader did not put it.
- Reduce motion: the panel swaps instantly and the height snaps. Correct, and
  free.

### M2 — Browse sheet open and close, and the rows arriving

- **The sheet itself animates natively.** `presentation: 'formSheet'` is
  react-native-screens' own presentation; add no screen-level animation, no
  `entering` on the root, and no `animation:` option. `settings-theme` next to it
  specifies none either.
- **First page.** Row `index` gets
  `entering={riseIn(Math.min(index, THEME_BROWSE_STAGGER_CAP) * STAGGER.row)}`.
  `riseIn` is `FadeInDown` over `DURATION.medium` from `RISE_DISTANCE` 14pt
  (`motion.ts:318-323`). `STAGGER.row` (32ms) rather than `STAGGER.card` (55ms)
  because these are rows in one list, which is the distinction `motion.ts:96-99`
  draws.
- **`THEME_BROWSE_STAGGER_CAP = 8`.** Twenty rows at 32ms each would take 640ms
  to finish arriving, which is a list the reader waits for. Capping the _index_
  puts a ceiling of 256ms on the lead-in. It is an index, not a duration, so it
  is invisible to the literal-duration scan and needs no allowlist entry.
- **"Load more".** Appended rows stagger from their position **within the new
  page** — `Math.min(index - previousShown, THEME_BROWSE_STAGGER_CAP)` — so the
  second page starts its sequence at zero rather than continuing from 20 and
  arriving half a second late.
- **Rows must not re-animate on scroll.** LegendList mounts and unmounts rows as
  they cross the viewport even with `recycleItems={false}`, so a naive `entering`
  re-fires every time a row scrolls back. Keep a `useRef<Set<string>>` of ids
  already revealed; a row whose id is in the set renders `entering={undefined}`,
  and ids are added in the same render that computes the animation. This is the
  difference between a list that arrives and a list that flickers, and it is the
  one part of this section that is easy to get wrong.
- **Header.** The title, caption and close button do not animate. They are the
  sheet's chrome; they are there before the list is.

### M3 — Row press

| Part               | Motion                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scale + haptic     | `PressableScale` — `timing(PRESS.in)` down (80ms), `timing(PRESS.out)` up (120ms), `selection` haptic (`pressable-scale.tsx:33-43`). Free; just use it instead of `Pressable`. |
| Spinner + label in | `entering={fadeIn('micro')}` / `exiting={fadeOut('micro')}` on the wrapper                                                                                                     |
| Row height growing | `layout={listLayout('short')}` on the row                                                                                                                                      |
| Other rows dimming | `withTiming(target, timing('short'))` on a shared `opacity`, in `useAnimatedStyle`                                                                                             |

- `'micro'` (150ms) for the spinner is the token's own definition — "a state flip
  you should barely notice" (`motion.ts:42-43`). A spinner that fades in over
  300ms is a spinner you watch arrive.
- **The dimming is the specific hard edge being removed.** Today it is
  `opacity: pending !== null && pending !== entry.id ? 0.5 : 1` inside a plain
  style object (`theme-gallery.tsx:183`) — twenty rows change on one frame.
  Replace with a shared value driven to `1` or `0.5` through
  `timing('short')`. `'short'` rather than `'micro'` because twenty rows changing
  together should read as the list settling around the pressed one, not as a
  flash.
- **Verify the row's `layout` on device.** A Reanimated layout animation inside a
  virtualized list can fight the list's own positioning. If it jitters, the
  fallback is to stop animating the height and instead reserve the progress
  block's height in that row's `getItemType` bucket while it is pending — which
  trades a little dead space for a list that holds still, and is the better
  trade. This is a device check, not a judgement call.

### M4 — Progress phase changes, download → unpack → assets

All of this lands **inside `src/components/theme-import-progress.tsx`**, which is
shared with three other call sites (`custom-theme-library.tsx:345`, `:348`, and
the browse row), so every slow import in the app gets it.

- **Label.** Wrap the `<Text>` in an `Animated.View` with `key={label}`,
  `entering={fadeIn('micro')}`, `exiting={fadeOut('micro')}`. A changed string
  then cross-fades instead of swapping glyphs mid-sentence.
- **Bar container.** Same pair. `measured` (`theme-import-progress.tsx:27`) is
  false during `downloading` and true for `unpacking` and `assets`, so the bar
  appears and disappears at least twice per install; today both are cuts.
- **Bar fill.** Stop writing the percentage `width` string into a plain `View`
  (`theme-import-progress.tsx:55-61`). Drive a shared value with
  `withTiming(fraction, timing('short'))` and apply it in `useAnimatedStyle`, so
  `3/12 → 4/12` slides. This is the single most visible hard edge in the current
  install.
- **The one permitted jump.** Progress is monotonic within a phase but resets
  between `unpacking` (entries) and `assets` (assets). The bar must **not**
  animate backwards to zero — that reads as the install undoing itself. Reset it
  instantly while the bar container is between its `fadeOut('micro')` and its
  `fadeIn('micro')`, so the reader never sees the value change.
- **Digits.** Keep `fontVariant: ['tabular-nums']` (`theme-import-progress.tsx:40`)
  so the counter does not reflow while the bar moves.
- Accessibility is unaffected: `accessibilityLiveRegion="polite"` and
  `accessibilityRole="progressbar"` with `accessibilityValue` stay exactly where
  they are (`theme-import-progress.tsx:31`, `:46-48`).

### M5 — The Installed badge

**No animation, deliberately.** The badge's value is known when the row is first
drawn, so it arrives inside `riseIn` with the rest of the row; a second fade on
top of that is two animations for one arrival. The only way it could change while
on screen is an install completing — and applying unwinds the stack
(`use-open-theme-editor.ts`, `_layout.tsx:333`), so the browse sheet is gone
before it could. Written down so nobody adds one.

### M6 — Error and empty states

- `theme-browse-empty` and `theme-browse-none` enter with `fadeIn('short')`; the
  loading state they replace leaves with `fadeOut('micro')`. Asymmetric on
  purpose: the thing arriving is what the reader has to read, and the spinner it
  replaces has nothing left to say.
- The container carries `layout={listLayout('short')}`, so a list collapsing to
  an empty state is a settle rather than a cut.
- `Try again` returns to the loading state with `fadeIn('micro')` — the reader
  pressed it, so it answers immediately.
- **No attention animation and no `accessibilityRole="alert"`.** A screen the
  reader navigated to is not an interruption; see _Accessibility and i18n_.

### M7 — The preview cover loading

- `<Image transition={DURATION.micro} />` — the exact spelling
  `image-preview-modal.tsx:306` and `attachment-strip.tsx:104` use, and the only
  one `motion-tokens.test.ts`'s image test accepts.
- The palette placeholder is **always rendered underneath**, with the `Image`
  absolutely filling on top. The image's own fade is then a cross-fade onto a
  surface that is already the right colour — no flash of sheet background, and no
  extra code.
- `onError` removes the image; the wrapper carries `exiting={fadeOut('micro')}`
  so a cover that fails _after_ painting does not blink out.
- `recyclingKey={entry.id}` so a row that scrolled away cannot fade the wrong
  cover in.
- Reduce motion: `transition` is `expo-image`'s own and does not consult the
  system setting. `DURATION.micro` is 150ms of opacity with no movement, which is
  within what reduce-motion permits; no branch needed.

### M8 — What does not animate

Stated so the implementation stops here: the sheet headers, the segmented
control's labels, the built-in grid's tiles (`ThemePackTile` already cross-fades
its selection on `timing('micro')`, `settings-theme-sheet.tsx:143`), the palette
strips, the author and size text, and the `Showing n of m` counter.

### M9 — Rules the implementation may not break

From `src/lib/__tests__/motion-tokens.test.ts`, which runs in `bun test src`:

1. **No literal duration anywhere under `src/`** — neither `.duration(180)` nor
   `duration: 180`. The allowlist "should only ever get shorter"
   (`motion-tokens.test.ts:22-24`); nothing in this work goes on it.
2. **Every layout-animation builder comes from `@/lib/motion`.** Importing
   `FadeIn`, `FadeInDown`, `LinearTransition` and friends from
   `react-native-reanimated` directly fails the third test, because such a
   builder carries neither the system ease-out nor the reduce-motion check.
3. **`transition={DURATION.micro}`, never a number.**
4. **No `withSpring` and no `.springify()`** outside `lib/motion.ts`. Recorded
   because it was asked about: the segmented control's pill is a `withTiming` on
   `PRESET.segmented` (`settings-segmented.tsx:83`), not a spring. The design
   system forbids springs for transitions, and `SETTLE` is exempted only for
   dragged values carrying a finger's velocity (`motion.ts:205-237`) — none of
   which exist here.

## Data & caching

### Index schema: one optional field

```ts
export interface ThemeIndexEntry {
  // ... unchanged ...
  /**
   * The pack's cover, as an address a list can draw before downloading
   * anything. Optional, and a row without one is a row with a palette
   * placeholder -- never an error and never a gap.
   *
   * Relative to `THEME_GALLERY_BASE`, exactly as `package` is, and already
   * written by `muqun-theme build`: `dist/previews/<id>.webp` beside
   * `dist/<id>.muqun-theme`.
   *
   * This is NOT the manifest's `preview`. That one is an asset id naming a
   * file *inside* the pack (1024x640, light left / dark right, skill 1.4.0),
   * which a catalogue cannot reach without the 25 MiB the catalogue exists to
   * avoid. The build extracts that same image and publishes it beside the
   * package; this field addresses the copy. Same picture, same 1024x640, same
   * 8:5 -- one is in the pack for the installer, one is on the site for the
   * list.
   */
  preview?: string;
}
```

**Corrected after the design was written.** The field is not a change waiting
on the server: `muqun-theme build` (osuki-dev/muqun-cli) already emits it, and
it emits a _repository-relative path_ in the shape `package` uses, not an
absolute URL. Everything below stands with that substitution -- the screening
function is unchanged, because resolving against `THEME_GALLERY_BASE` is what
makes a relative path the ordinary case and an absolute one on the same base a
free extra.

Parsing, in `parseThemeIndex` (`gallery.ts:93-111`), follows every other
optional field: `preview: text_(entry.preview, 2048)`. **Not resolved to a URL
here**, for the reason `package` is not (`gallery.ts:56-59`) — a path that is
screened only where it is used cannot smuggle a host by sitting in a field
nobody re-checks.

Screening, next to `themePackageUrl` (`gallery.ts:126-130`) and identical to it:

```ts
export function themePreviewUrl(entry: Pick<ThemeIndexEntry, 'preview'>): string | null {
  if (!entry.preview) return null;
  try {
    const url = publicThemeUrl(entry.preview, THEME_GALLERY_BASE);
    return url.startsWith(THEME_GALLERY_BASE) ? url : null;
  } catch {
    return null;
  }
}
```

One difference from `themePackageUrl` and it is deliberate: it returns `null`
instead of throwing, because a cover that does not screen must cost the reader a
placeholder and not a row. Resolving against `THEME_GALLERY_BASE` then means
that the relative `dist/previews/x.webp` the build actually writes and an
absolute `https://muqun.dev/api/themes/dist/previews/x.webp` both pass, with no
extra code and no extra trust.

**The preview is the one new request that does not go through the native
transport.** `expo-image` fetches it with ordinary platform networking — no
pinned destination, no proxy/cookie suppression, no byte budget. Stated
explicitly rather than left implicit, with the argument for why it is
acceptable: the URL is constrained by construction to `THEME_GALLERY_BASE`,
which is our own origin and the same one the reader chose by opening this
screen; it is rendered, never written to the library, never hashed, never
installed; and it is not an author-supplied host, which is the threat
`PublicThemeTransport`'s docblock (`remote-import.ts:10-13`) exists for. A pack
asset is a different case and keeps the native path. If a reviewer disagrees the
fallback is cheap: draw only the palette placeholder and drop the field's
consumer, keeping the schema.

### Wording for `docs/theme-contract.md`

The contract document currently ends at **Remote assets**, which is the other
place it discusses addresses that live outside a pack. This section goes after
it, verbatim, in PR A — it is written out here so the implementation has nothing
to invent and the reviewer can argue with the sentences rather than a summary of
them:

> ## The published catalogue
>
> The index at `https://muqun.dev/api/themes/index.json` is not a pack and is
> not covered by `schemaVersion`. It is a document our own build writes and
> our own readers parse, so it may gain fields whenever it is useful — an app
> that does not know a field ignores it, which is the whole of its compatibility
> story.
>
> One field is worth writing down because it looks like a pack field and is not.
> **`preview` in an index entry is an address; `preview` in a manifest is an
> asset id.** The manifest's names an image inside the pack, which is where the
> cover belongs: it travels with the theme, it is covered by the package's own
> limits and hashes, and it is what an offline install has. The index's
> addresses a copy of that same image, published beside the package by
> `muqun-theme build`, so a list can show a theme before downloading 25 MiB of
> it. Same picture, same 1024x640, same 8:5, in whatever format the pack ships
> it.
>
> The index entry's `preview` is written relative to the catalogue's own base,
> exactly as `package` is — `dist/previews/<id>.webp` beside
> `dist/<id>.muqun-theme` — and it must resolve, against that base, to a URL on
> that base. That is the rule `package` already follows, and for the same
> reason: an entry naming another host would be the catalogue asking the app to
> fetch from a place the reader never chose. An absolute address on the base
> resolves to itself and passes; anything else does not, and the row draws its
> palette instead of an error. The field is optional in both places, and when it
> is absent it is absent — never an empty string, never a null. A pack without a
> cover still installs; a row without one draws its palette. Only the themes
> repository's own checks require it, because a gallery with nothing to show is
> not a gallery.

### Cache

**Time-based, in memory, one hour.** `src/theme/gallery-cache.ts`:

```ts
export const THEME_INDEX_MAX_AGE_MS = 60 * 60 * 1000;
let cached: { entries: ThemeIndexEntry[]; fetchedAt: number } | null = null;
export function cachedThemeIndex(now = Date.now()): ThemeIndexEntry[] | null;
export function putThemeIndex(entries: ThemeIndexEntry[], now = Date.now()): void;
export function clearThemeIndex(): void; // what Try again calls
```

Why time and not validators: **the transport cannot do conditional requests.**
`ThemeTransportResponse` is `{ status, location?, contentType?, bytes }` and the
bridge rejects anything else (`transport-bridge.ts:41-52`); `get(requestId, url,
maxBytes)` takes no headers. There is no ETag to read and no `If-None-Match` to
send without bumping `contractVersion` (`transport-bridge.ts:12`) and changing
both native modules. That is a larger change than this redesign and is listed as
a follow-up, not done here.

Why in memory and not MMKV: the value is up to 512 KiB, MMKV is memory-mapped
and sized for small values, and the catalogue is not useful offline anyway —
every row in it needs the network the moment it is pressed. A launch is also the
one moment where refetching is obviously right. The brief's requirement is that
_reopening the sheet_ does not refetch, and a module-level cache satisfies that
exactly.

`Try again` and nothing else bypasses the cache. There is no pull-to-refresh:
two ways to ask the same question, one of which is invisible, is one too many
for a list that changes when someone merges a PR.

### Limits, restated

| Bound                      | Value                    | Source                                        |
| -------------------------- | ------------------------ | --------------------------------------------- |
| Index document             | 512 KiB                  | `gallery.ts:29`                               |
| Package                    | 25 MiB                   | `schema.ts:7`                                 |
| Asset                      | 8 MiB                    | `schema.ts:6`                                 |
| Expanded package           | 50 MiB                   | `schema.ts:8`                                 |
| Assets per pack            | 32                       | `schema.ts:5`                                 |
| Image pixels               | 16M                      | `schema.ts:9`                                 |
| Rows per page              | 20                       | new, `THEME_BROWSE_PAGE`                      |
| Index cache max age        | 1 h                      | new, `THEME_INDEX_MAX_AGE_MS`                 |
| Preview cover, recommended | ≤ ~100 KB WebP, 1024x640 | server-side only; **not enforced by the app** |

The app does not enforce the preview size. It cannot: `expo-image` fetches it
and there is no byte budget on that path. It is a publishing guideline the index
generator applies, and the worst case if it is ignored is a slow thumbnail.

## Install pipeline changes

### Phases

One progress type, reported by the browse sheet's row:

```ts
export type ThemeInstallProgress =
  | { phase: 'downloading' }
  | { phase: 'unpacking'; completed: number; total: number } // ZIP entries
  | { phase: 'assets'; completed: number; total: number; receivedBytes: number };
```

`assets` is the existing `ThemeAssetProgress` (`asset-stream.ts:6-11`) renamed
at the boundary — `completedAssets` → `completed`, `totalAssets` → `total`,
`receivedBytes` carried through, `'ready'` folded into the phase ending. Its own
`'staging' | 'ready'` shape is **not** changed and `stageThemeAssetStream` keeps
reporting exactly what it reports today; the browse row does the mapping. The row renders it through the existing
`ThemeImportProgress`, which already draws a bar when it knows a total and a
bare label when it does not (`theme-import-progress.tsx:9-12`):

| Phase       | Label              | Bar                  |
| ----------- | ------------------ | -------------------- |
| downloading | `Downloading…`     | none — indeterminate |
| unpacking   | `Unpacking…`       | entries `n/m`        |
| assets      | `Preparing images` | assets `n/m` + bytes |

### Yield points and granularity

The primitive:

```ts
/** Hands the frame back. `setTimeout(0)`, not a resolved promise: a microtask
 *  drains before the event loop runs, so React never commits and nothing
 *  paints. Not `InteractionManager.runAfterInteractions` either -- that waits
 *  for animations and gestures to finish, and the sheet the progress is being
 *  drawn in is itself animating in. */
const yieldFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
```

`throwIfThemeAborted(signal)` is called immediately after every yield. The
existing per-slice abort checks (`package.ts:166`) stay.

**`package.ts`.** Add `unpackThemeAsync(bytes, options)` alongside the existing
synchronous `unpackTheme`, which stays and stays the export that
`asset-viewer.tsx:269`, `server-terminal-workspace.tsx:3603` and
`local-files.ts:145` use. Two implementations is the wrong answer; the shared
body becomes a generator that the two wrappers drive — the sync one to
completion, the async one with a yield between steps — so the ZIP parsing,
bounds and CRC checks exist once.

```
YIELD_BYTES = 256 * 1024
```

- **Between entries** — always, plus a progress report. An archive has at most
  34 entries (`THEME_LIMITS.assets + 2`, `package.ts:47`), so this is cheap and
  is what makes `n/m` move.
- **Inside inflate** — the loop already pushes 1 KiB slices
  (`package.ts:165-168`). Yield every 256 slices, i.e. every `YIELD_BYTES` of
  compressed input. A 25 MiB package is then ~100 yields, which is not enough to
  matter against the inflate itself.
- **Inside CRC32** — `crc32(output)` (`package.ts:170`) becomes a loop over
  `YIELD_BYTES` slices with a yield between, accumulating the register across
  slices. This is the single largest uninterrupted block in the current path and
  the one that must be broken up.

256 KiB is a starting point, not a measured optimum: the intent is that one
uninterrupted block lands on the order of a frame rather than a fraction of one,
which for the table-driven loop at `package.ts:21-25` is an assumption about JS
throughput on the target phones that **nobody here has measured**. It is a
named constant with that caveat in its comment, and the measurement required
below is what settles it. If a block is tens of milliseconds, halve it; if the
yields themselves show up in the total, double it.

**`remote-import.ts`.** `inspectRemoteTheme` becomes `await`-ing the async
unpack (`remote-import.ts:144`) and forwards an `onProgress` from its options
so the browse sheet sees the `unpacking` phase. `downloadAssets`
(`remote-import.ts:182-215`) is unchanged — it is the manifest-plus-URLs path
and does not unpack.

**Per asset.** One `yieldFrame()` immediately before `inspectThemeImage` in
`stageThemeAssetStream` (`asset-stream.ts:65`), so the `progress('staging')`
from the previous iteration (`asset-stream.ts:80`) actually reaches the screen
before the next PNG's CRC begins. `inspectThemeImage` itself stays synchronous
and is not split: it is a pure validator with six callers and a trust boundary,
and an async twin would fork that boundary for a saving that one yield per asset
already gets most of. It has five call sites today — `asset-stream.ts:65`,
`remote-import.ts:176` and `:205`, `assets.native.ts:282`, `git-import.ts:191` —
and four after the removal below. The remaining stall is one asset's inspection,
bounded by `THEME_LIMITS.assetBytes` at 8 MiB.

**This must be measured, not assumed.** The implementation reports, on the QA
Android device (`muqun_collaboration_qa`), the wall time of each phase and the
longest uninterrupted JS block for the largest published pack, before and after.
Nothing in this section is a measurement; it is a design with a hypothesis.

### The duplicated inspection

Remove `inspectThemeImage(bytes);` at `remote-import.ts:176`. The argument is in
_Current state_: both production consumers and the one test consumer feed that
generator to `stageThemeAssetStream`, which inspects at `asset-stream.ts:65`
before hashing, writing or decoding. Nothing reaches storage uninspected.

Two things go with the removal, so the guarantee is not merely true but stated:

1. The docblock on `RemoteThemeInspection.assets` (`remote-import.ts:120-123`)
   gains a sentence: the consumer is responsible for image inspection, and
   `stageThemeAssetStream` is the one that does it.
2. A test pins it — feed `inspectRemoteTheme(...).assets()` for a package
   containing a malformed image into a stage port and assert it still throws. It
   passes today and would keep passing for the wrong reason without the note, so
   it goes in with the removal, not instead of it.

`git-import.ts:191` has the same discarded call with the same consumers. It is
**not** removed here — it is a different import path, unexercised by this work,
and touching it would put an untested file in this diff. Raised in _Open
questions_.

`remote-import.ts:205` is **not** redundant: that one's result is used
(`info.format`, `remote-import.ts:208`).

## Persistence

One preference, one module, `src/lib/theme-tab-preference.ts`, in the shape of
`src/lib/shortcut-usage.ts` — including the fallback at
`shortcut-usage.ts:15-27`, which exists because MMKV is a native module and an
OTA update can reach a binary built before it was added.

```ts
type ThemeTab = 'mine' | 'builtin';
const STORE_ID = 'muqun.theme-ui';
const STORAGE_KEY = 'muqun.theme-tab.v1';

export function loadThemeTab(): ThemeTab | null; // null when unset or unrecognised
export function saveThemeTab(tab: ThemeTab): void; // swallows its own failure
```

- A stored value that is neither `mine` nor `builtin` is treated as unset, so a
  future third tab cannot strand a reader on a tab that no longer exists.
- Written on a tab change and on the implicit change the Import button makes.
  Never on mount.
- **Default when unset**: `mine` if `library.themes.length > 0`, else `builtin`.
  Computed at mount only, so the tab does not jump under a reader who removes
  their last theme while looking at it.
- A write failure is swallowed, as `shortcut-usage.ts:102-104` swallows its own:
  a remembered tab is not worth an error.

Nothing else is persisted. The browse sheet's scroll position, its `shown`
count, and the index cache are all process lifetime.

## Accessibility and i18n

- **Every new string goes through lingui**, using `useLingui()`'s `t`. Run
  `bun run i18n` (`package.json:40-42`) and commit all **11** catalogs: `de`,
  `en`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `vi`, `zh-CN`, `zh-TW`. A catalog
  with an empty `msgstr` is expected for a new string and is not a failure; a
  missing catalog entry is.
- The five strings marked **exists** in _Copy_ must keep their exact source text,
  or they lose every existing translation. In particular, moving
  `Themes published at muqun.dev. Nothing downloads until you open one.` from
  `theme-gallery.tsx:145` to the new file changes only the `#:` reference
  comment in the `.po` files.
- **Tabs** keep `@osuki-dev/ui`'s `Tabs.Trigger` semantics unchanged:
  `accessibilityRole="tab"` and a `selected` state, which is what the E2E reads
  (`settings-segmented.tsx:6-8`). Nothing is re-declared.
- **Rows** are `accessibilityRole="button"` with the theme's name as the label
  and nothing else — the cover, the size and the badge are detail, and a label
  that reads all of them makes a list unscannable by ear. The `Installed` badge
  is reachable as its own text node.
- **Preview images** get `accessible={false}`; they are decoration for a row that
  already names itself. Per `docs/custom-theme-design.md:187`, decorative layers
  never intercept touch or accessibility focus.
- **Progress** reuses `ThemeImportProgress`, which already carries
  `accessibilityLiveRegion="polite"` and `accessibilityRole="progressbar"` with
  `accessibilityValue` (`theme-import-progress.tsx:31`, `:46-48`). The phase
  label changing is what a screen reader announces.
- **The empty state** is a heading, a sentence and a button — not an
  `accessibilityRole="alert"`, because a screen the reader navigated to is not
  an interruption.
- **Text size.** Row text is `numberOfLines`-capped, so large text truncates
  rather than reflowing the 8:5 box. The footer's `Showing {shown} of {total}`
  wraps. Check the built-in grid's column breakpoints
  (`theme-picker-layout.ts:2-5`) still hold under a tab with large text — the
  measured width is unchanged, but the sheet is now one control taller.

## E2E plan

The suite drives offline demo mode with no gateway, no network and no pairing
(`AGENTS.md`, `e2e/agent-device/README.md`). Everything below is assertable
under that.

### `custom-themes.ad` — new and changed sections

`browse-entry` (`custom-themes.ad:80-85`) is **unchanged**: `is visible
"id=theme-browse"`, still never pressed by the `.ad` file itself.

New sections:

```
# section mine-tab
# The tab persists, and the suite relaunches without erasing data -- so a flow
# that relies on the default lands wherever the previous flow left it. Every
# assertion below names the tab it needs first.
wait stable 400 5000
is visible "id=theme-tab"
is visible "id=\"settings-selection:on:theme-tab-mine\""
is visible "id=theme-row-my-theme"

# section builtin-tab
wait stable 400 5000
is visible "id=\"settings-selection:on:theme-tab-builtin\""

# section browse-offline
# The one place this suite lets a network read happen, and it happens so the
# failure can be asserted: with no network the catalogue read fails and the
# sheet must say so and offer a way back, rather than spinning forever. The
# native client's own timeout is 30s, but an offline emulator fails DNS in
# well under a second; the wait is generous for the case where it does not.
wait "id=theme-browse-empty" 40000
is visible "id=theme-browse-retry"
screenshot dist/theme-browse-offline.png
press "label=\"Close theme catalogue\""
wait stable 400 5000
is visible "id=theme-browse"
```

### `suite.json` — new and changed steps

In `programs["flows/custom-themes"]`, in order:

1. After the existing `#link-import` and `#browse-entry` steps, open the browse
   sheet **through the manifest**, so the `.ad` file never spells the press:

   ```json
   { "target": { "id": "theme-browse" }, "mode": "press", "run": "flows/custom-themes.ad#press" },
   { "run": "flows/custom-themes.ad#browse-offline" }
   ```

2. Before `#reopen-applied`, select the personal tab and assert it:

   ```json
   { "target": { "id": "settings-selection:(on|off):theme-tab-mine" }, "mode": "press", "run": "flows/custom-themes.ad#press" },
   { "run": "flows/custom-themes.ad#mine-tab" }
   ```

3. Before the existing scroll to `settings-selection:(on|off):theme-osuki` in
   the tail of the flow, select the built-in tab. **This step is required, not
   optional**: at that point a custom theme is installed, so the default tab is
   `mine` and the built-in grid is not in the tree at all.

   ```json
   { "target": { "id": "settings-selection:(on|off):theme-tab-builtin" }, "mode": "press", "run": "flows/custom-themes.ad#press" },
   { "run": "flows/custom-themes.ad#builtin-tab" }
   ```

4. The existing `theme-import` press step is unaffected: Import forces the `mine`
   tab, so `theme-import-link` is on screen whatever was persisted.

The flow keeps its `full` tag. No new flow file — this is the same surface, and
a second flow would need its own install.

### `src/theme/__tests__/e2e-fixture.test.ts` — a premise that changes

The test at `:43-46` is named "the flow does not reach the network, which is the
suite's whole premise", and its comment says opening the gallery entry "would
read muqun.dev". **Under this design the flow does open it, and that read does
fail.** Pretending otherwise would be worse than saying so.

The property that actually matters is narrower and still true: the flow never
**downloads a theme package**. Rewrite the test to assert that, and to assert the
new offline evidence:

```ts
test('the flow reads no theme package, which is the suite’s whole premise', () => {
  // The catalogue sheet is opened on purpose: with no network its index read
  // fails, and the empty state is the thing under test. What must never happen
  // is a row press, which is the 25 MiB download.
  expect(flow).toContain('is visible "id=theme-browse"');
  expect(flow).toContain('wait "id=theme-browse-empty" 40000');
  expect(flow).not.toContain('theme-browse-item');
  // Still never spelled in the .ad: the manifest drives the press.
  expect(flow).not.toContain('press "id=theme-browse"');
});
```

The two other tests in that file (`:27`, `:36`) are unchanged.

### Unit tests to add

- `parseThemeIndex` carries `preview` when it is a string within bounds and drops
  it otherwise, and a bad `preview` does not drop the row.
- `themePreviewUrl` returns the resolved URL for a relative path and for an
  absolute one on the base, and `null` for another host, a non-`https` scheme,
  and an absent field. Never throws.
- `cachedThemeIndex` returns the entries inside the max age, `null` outside it,
  and `null` after `clearThemeIndex`.
- `loadThemeTab` round-trips, and returns `null` for an unrecognised stored
  value.
- `unpackThemeAsync` produces byte-identical output to `unpackTheme` for the
  fixture packages, rejects the same malformed archives, and honours an
  `AbortSignal` raised mid-inflate.
- The staging inspection test described in _Install pipeline changes_.

## Risks and open questions

**Risks.**

1. **A form sheet pushed over a form sheet.** `/settings-theme-browse` is
   presented on top of `/settings-theme`, and both are `formSheet`. iOS stacks
   sheets natively; Android's react-native-screens form sheet is a bottom sheet
   dialog and the stacking behaviour must be verified on device before this is
   called done. Mitigation if it misbehaves: present the browse route as
   `fullScreenModal` on Android only, branching on `process.env.EXPO_OS` as
   `settings-sheet.tsx:83` already does. This is a device check, not a judgement
   call, and it blocks the PR.
2. **The index read has no JS-side timeout.** `loadThemeIndex` (`gallery.ts:138`)
   bypasses `download()` and so inherits only the native client's 30s. On a
   device with a black-holing network rather than a failing DNS, the empty state
   is 30 seconds away. Out of scope to fix here, listed so nobody is surprised;
   the E2E's 40s wait is sized for it.
3. **The `.ad`/manifest split is easy to get wrong.** A press written into the
   `.ad` file instead of the manifest breaks `e2e-fixture.test.ts` and hides the
   intent. The sections above are written so the `.ad` never names
   `theme-browse`.
4. **`recycleItems: false` plus preview images is memory.** 20 rows of 1024x640
   decoded is real, and `expo-image`'s `memory-disk` policy holds them. The page
   size is the control; if a Pad at four-wide proves it too much, lower
   `THEME_BROWSE_PAGE` rather than turning recycling on, which would hand one
   theme's cover to another row.
5. **The tab preference outliving a flow.** The suite does not erase data, so a
   persisted tab crosses flows. Every new E2E assertion names its tab first,
   which is the mitigation; a future flow that forgets to will fail confusingly.
6. **Entering animations inside a virtualized list.** M2's stagger and M3's row
   `layout` both put Reanimated animations inside `LegendList`, which owns row
   positioning. Rows re-firing their entrance on scroll, and a row layout
   animation fighting the list, are two distinct failure modes with two distinct
   mitigations, both written out in M2 and M3. Neither is provable off-device.
7. **`unpackTheme` is a security boundary.** Restructuring it into a generator
   driven by two wrappers must not change a single bound or check. The existing
   package tests are the gate; if they do not cover a branch that moves, they get
   extended before the move.

**Open questions — not resolvable from the code.**

1. **Does the index generator exist, and who owns it?** ~~Open.~~ **Answered:**
   `muqun-theme build` in osuki-dev/muqun-cli already extracts the manifest's
   `preview` asset from each pack, publishes it beside the package, and emits
   its repository-relative path as the index's `preview`. Nothing server-side is
   waiting on this work. The app change would have been safe either way —
   `preview` is optional and every row falls back to a palette placeholder.
2. **Should the cover be re-encoded server-side?** The manifest cover is 1024x640
   PNG or WebP with no byte ceiling beyond `THEME_LIMITS.assetBytes` (8 MiB).
   The recommendation here is ≤ ~100 KB WebP for the index copy, which implies
   the generator re-encodes rather than copies. Not decided; it is the
   generator's call and it is not enforceable from the app.
3. **`git-import.ts:191`.** The argument for removing `remote-import.ts:176`
   applies to it word for word. Removing both is more consistent; removing only
   the one this work exercises is more honest about what has been tested.
   Recommendation: leave it, and remove it in whatever change next touches the
   git import path. Wants a maintainer's opinion.
4. **Conditional requests.** Caching by time is a workaround for a transport that
   cannot revalidate. Exposing `ETag`/`Last-Modified` on `ThemeTransportResponse`
   and accepting `If-None-Match` on `get` would make this a 304 and let the cache
   persist across launches honestly. That is `contractVersion: 2` plus Kotlin and
   Swift, and it is deliberately not in this design. Worth its own card.
5. **The browse sheet's ground.** This design paints `ThemeArtwork` +
   surface behind the list so it matches the theme sheet it was opened from; the
   nearest structural precedent, `SessionArtifacts`, paints a flat surface
   instead (`session-artifacts.tsx:633`). Two sheets, two answers. Going with the
   theme sheet's, because these two are one place to a reader, but a designer may
   want the Files sheet changed instead of this one matching it.
6. **Is 1 hour the right max age?** Picked because it is the round number between
   "a reader who reopens the sheet twice in a session should not pay twice" and
   "a theme merged this morning should show up today". No data behind it.

## Rollout

**Two pull requests, A then B.**

Estimated diff, counted against the files named above:

| Part                                                                           | Lines (est.) |
| ------------------------------------------------------------------------------ | ------------ |
| A — `gallery.ts` (`preview`, `themePreviewUrl`), `gallery-cache.ts`            | ~90          |
| A — `theme-browse-sheet.tsx` (new), route, `_layout.tsx`                       | ~300         |
| A — `custom-theme-library.tsx` (tabs in, inline gallery out)                   | ~70 net      |
| A — `settings-theme-sheet.tsx`, `theme-tab-preference.ts`                      | ~60          |
| A — motion: M1–M3, M6, M7 and `theme-import-progress.tsx` (M4's bar and label) | ~70          |
| A — `theme-gallery.tsx` deleted                                                | −217         |
| A — contract doc, E2E `.ad` + `suite.json`, unit tests                         | ~130         |
| **A total**                                                                    | **~620**     |
| B — `package.ts` cooperative unpack                                            | ~90          |
| B — `remote-import.ts`, `asset-stream.ts` yield + progress                     | ~50          |
| B — browse sheet phase plumbing, and M4's phase cross-fade                     | ~50          |
| B — unit tests                                                                 | ~80          |
| **B total**                                                                    | **~270**     |

That is ~890 together, past the ~800 threshold — so the split is required rather
than merely advisable. It would be the right call at half the size anyway,
because the two halves carry different risk and are closed by different evidence.
A is UI, motion and data, closed by unit tests, the E2E flow and looking at it. B
rewrites a security boundary, and its claim — "the app no longer freezes" — can
only be closed by timing measurements on a real Android device, which is a slower
review with a different reviewer. Bundling them means the measurement gates the
sheet.

**PR A — sheet tabs, browse sheet, caching and paging.**

- Segmented control in `CustomThemeLibrary` behind the `tabs` prop; empty-`mine`
  state; `settings-theme-sheet.tsx` passes `tabs` and drops its caption.
- `theme-tab-preference.ts` and its default rule.
- `/settings-theme-browse` route, `_layout.tsx` registration,
  `theme-browse-sheet.tsx` carrying `ThemeGallery`'s cancellation model intact.
- `theme-gallery.tsx` deleted; `theme-browse` becomes a `router.push`.
- Index `preview` field, `themePreviewUrl`, `gallery-cache.ts`, paging.
- `docs/theme-contract.md` gains the **Published catalogue** section, whose text
  is written out verbatim in _Data & caching_ → _Wording for
  `docs/theme-contract.md`_. Paste it after "Remote assets".
- Motion M1 (tab cross-fade and height), M2 (list stagger and the revealed-ids
  guard), M3 (press, spinner fade, eased dimming), M6 (empty states), M7 (cover
  fade), and M4's label cross-fade and animated bar fill inside
  `theme-import-progress.tsx`. `bun test src` covers the rules in M9; the feel is
  reviewed on device.
- `bun run i18n`, all 11 catalogs.
- E2E: `mine-tab`, `builtin-tab`, `browse-offline`, the manifest steps, and the
  rewritten `e2e-fixture.test.ts`.

**PR B — install pipeline responsiveness.**

- `unpackThemeAsync` and the shared generator body; `YIELD_BYTES`.
- The per-asset yield; the `remote-import.ts:176` removal with its docblock and
  its test.
- The phase model, the browse row's labels, and M4's phase-boundary rule — the
  bar container cross-fades and the value resets while it is invisible, never
  animating backwards.
- Before/after timings on `muqun_collaboration_qa`, quoted in the PR.

**Both PRs run the five checks in order** (`AGENTS.md`): `npx tsc --noEmit`,
`bun run lint`, `bun run format:check`, `bun test src`, `bash scripts/e2e.sh`,
with the E2E result quoted in the pull request. `bun run format:check` currently
fails on `skills/muqun-theme/SKILL.md` on `main`; that is pre-existing, it is not
this branch's to fix, and it must be reported as such rather than silently
absorbed by a repo-wide `bun run format`.
