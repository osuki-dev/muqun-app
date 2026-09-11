# Full-skin architecture and acceptance

Local-only working architecture. Do not stage or push this document.

## Product contract

A custom skin changes the visual identity of the application, not merely its
palette or a Home banner. Comic Bloom is the reference implementation, not a
special case in rendering code. Native text, controls, accessibility, terminal
semantics, safe areas, and navigation remain owned by the application.

The release claim is coverage of real surfaces and states. Successful archive
import alone does not establish a complete skin.

## Layers and ownership

1. A strict, versioned manifest owns colors, local asset references, surface
   slots, mode/width overrides, material preferences, and optional Home identity.
2. The importer validates bounded archive entries, static image contents,
   dimensions, hashes, and owned storage before activation. Remote references
   remain unavailable until a secure downloader can enforce their contract.
3. Pure resolution selects light/dark and compact/regular assets, explicit null
   suppression, material policy, and contrast-safe image opacity.
4. Shared artwork, surface, button, and chrome components render those resolved
   values. Route roots declare their surface roles rather than embedding theme
   names, raw file paths, or provider-specific visual overrides.
5. Feature content remains native and interactive. Theme switching must not
   recreate terminals, change tasks, navigate, or discard drafts.

## Artwork inventory

| Pair                  | Role                                           | Composition                                  |
| --------------------- | ---------------------------------------------- | -------------------------------------------- |
| scene-light/dark      | Phone shell and full Home background           | Portrait environment, not a banner           |
| scene-wide-light/dark | Tablet shell and full Home background          | Separately composed 4:3 landscape            |
| chrome-light/dark     | Navigation, tabs, composer and action surfaces | Fine all-over petal/ribbon material          |
| panel-light/dark      | Cards and grouped Settings surfaces            | Quiet embossed paper material                |
| action-light/dark     | Primary buttons                                | Berry with light text / blush with dark text |
| empty-light/dark      | Empty-state illustration                       | Compact welcoming sprite and mailbox         |

The imagegen PNG masters remain intact. Size-appropriate export derivatives
are separate assets; manifest hashes identify the bytes actually distributed.
Unused earlier paper/banner experiments are not automatically included in the
flagship pack. Package limits are not increased to accommodate redundant art.

## Component and state contract

- Route backgrounds cover the route viewport, including intentional safe-area
  composition. Opaque nested containers must not accidentally hide the shell.
- Cards, navigation chrome, buttons, and tabs consume their shared semantic
  slots. Decorative layers neither intercept input nor create accessibility
  targets. Missing artwork retains the existing token-based presentation.
- Default, selected, pressed, focused, disabled, loading, and destructive states
  keep their semantic distinctions. The skin must not turn every action into
  the same decoration or replace live labels with painted text.
- Primary-button image luminance is interpreted with the active onPrimary
  token. A dark-mode theme can correctly use a light primary button.
- auto/solid/glass controls material, not layout. A matching image defaults to a
  solid readable plane; unsupported glass falls back safely. Platform permission
  dialogs and share sheets are not custom skin surfaces.
- Contrast protection applies locally to content-bearing surfaces. Full-scene
  backgrounds should not be globally faded just to protect a small title.
- Explicit null means no artwork, including within a responsive override. It
  must not resurrect another background through fallback.
- Home logo/name customization is separate from installed App identity. Hidden
  identity contributes no placeholder layout; custom asset IDs never collide
  with an internal default-logo sentinel.

## Responsive rules

Select composition from actual available width, not an assumption that an iPad
is always wide. Use the portrait scene in compact widths and the separate wide
scene for regular widths. Narrow split views must remain operable. Focal points
and contain/cover choices are explicit; do not distort aspect ratios.

Keep hit targets and safe-area/keyboard insets independent from artwork. Verify
long localized labels and larger text rather than shrinking type to preserve
decoration. The existing app font hierarchy remains authoritative in this
version; arbitrary remote fonts and arbitrary layout code are not supported.

## Acceptance matrix

For each changed surface, capture actual light/dark screenshots and exercise
its controls: Home with and without servers, Settings/theme library/preview,
navigation, terminal composer, cards, tabs, primary and disabled buttons,
empty states, and inline file preview. Check portrait phone, landscape tablet,
and narrow split width. Android wide-layout tests do not prove iPad coverage.

All advertised schema slots require a real runtime consumer and a regression
guard. Record unimplemented surfaces explicitly; removing a slot from the
schema avoids a false API promise but does not fulfill the requested visual
coverage by itself.

Run the ordered source gates and full device suite against the exact installed
build. Verify offline export/reimport, relaunch persistence, invalid/corrupt
packs, storage failure rollback, quota enforcement, and removal. Keep real
paired Agent-authoring checks separate from offline demo interaction tests.

## Current limits

The 12 production image masters are generated. Shared-surface integration is
being built and visually reviewed. Do not claim whole-App visual completion,
iOS/iPad validation, arbitrary remote imports, or real Agent authoring until
their corresponding evidence exists.
