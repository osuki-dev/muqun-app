# Theme glyph: `chrome.attach`

Status: specification, not yet implemented. Written for whoever picks this up;
everything needed is in this document and the files it names.

## Why

A theme pack can replace exactly two chrome glyphs today: `chrome.back` (the
navigation header's back arrow) and `chrome.send` (the composer's send button).
The attachment control sits in the same composer row as send, at the same
visual weight, and is the third thing an illustrated pack wants to restyle. The
first published pack asked for it.

Icon names are the one part of a published theme that can never be corrected
later: once a pack in the wild uses a name, the app must keep drawing that glyph
through the theme for as long as the format lives. The set is therefore decided
deliberately, and now, before packs are public and authors build around what is
there. `chrome.attach` is the one addition that earns its place. Nothing else
(keyboard, escape, interrupt, settings) is in scope; each of those would have to
argue for itself separately.

## What changes

### 1. The name

`src/theme/schema.ts`:

```ts
export const THEME_ICONS = ['chrome.back', 'chrome.send', 'chrome.attach'] as const;
```

`iconsSchema` is already an open `z.record`, so no schema shape changes and no
`schemaVersion` bump. A pack naming `chrome.attach` already parses today; it is
simply not drawn. Older app builds keep ignoring it, which is the contract's
intended forward-compatibility behaviour.

### 2. Drawing it

The attachment control is the paperclip in `src/components/server-terminal-workspace.tsx`
(around line 3912):

```tsx
<Paperclip size={17} color={theme.colors.primary} />
```

becomes

```tsx
<ThemeIcon name="chrome.attach" fallback={Paperclip} size={17} color={theme.colors.primary} />
```

using the existing `ThemeIcon` from `src/components/theme-icon.tsx`, exactly as
`terminal-composer.tsx:178` does for `chrome.send`. Same size, same colour, same
place; `template` rendering tints the pack's image with the theme colour, and a
pack that supplies nothing gets the built-in `Paperclip` with no gap. If the
paperclip is drawn in more than one place (the gateway's and the composer's own
row share the size, per the comment at `terminal-composer.tsx:190`), every
occurrence goes through `ThemeIcon` with the same name.

### 3. The in-app preview

`src/components/custom-theme-preview.tsx` shows a pack before it is applied.
Wherever it draws the send glyph through the theme, draw the attach glyph the
same way, so an author sees all three replaced glyphs in the preview.

### 4. Authoring contract and skill

`src/theme/authoring.ts` (around line 50) lists the known icon names in the
prose the skill is generated from:

> icons replaces a chrome glyph. Known names are chrome.back and chrome.send; …

Add `chrome.attach`, with one clause on what it is (the composer's attachment
control, drawn at 17pt in the primary colour by default). Then bump
`THEME_SKILL_VERSION` and regenerate the skill:

```sh
bun scripts/export-theme-skill.ts
```

`docs/theme-contract.md` line 140 says "Icon names. 2 today"; make it 3.

### 5. Tests

`src/theme/__tests__/icons.test.ts` already covers parsing, `render` defaults
and unknown names. Add:

- `THEME_ICONS` contains `chrome.attach`.
- A component test (or the existing pattern for `chrome.send`, if there is one)
  showing the attach control renders the pack's asset when `icons['chrome.attach']`
  names an installed asset, and the built-in `Paperclip` otherwise.

## Acceptance

- A pack with `"icons": { "chrome.attach": { "asset": "clip" } }` and a matching
  asset shows that image, tinted with `colors.primary`, wherever the paperclip
  is drawn; without the entry the built-in paperclip is unchanged.
- `THEME_ICONS` lists three names; the regenerated skill names all three; the
  contract document says 3.
- No `schemaVersion` change; existing packs are unaffected.

## Downstream (not part of this change, listed so nothing is forgotten)

- **CLI** (`osuki-dev/muqun-theme-cli`): `src/schema.ts` is a byte-identical
  copy of the app's and `skills/muqun-theme/SKILL.md` is the regenerated skill;
  both are pinned by tests. Copy both over and release a minor.
- **Website** (`osuki-dev/muqun-website`): the device mock-ups draw the
  paperclip from the theme once the name exists (`src/components/themes/device-mock.tsx`).
