# Personal app icons

Design branch: `design/personal-app-icons`. This is an asset and configuration
review, not a release or an App Store approval claim.

## Five choices, one identity

| Choice  | Visual direction                                   | Intended affinity                                |
| ------- | -------------------------------------------------- | ------------------------------------------------ |
| Classic | Original flat coral mark                           | People who prefer the original, minimal identity |
| Mascot  | Clean coral 3D companion                           | A friendly, tactile everyday appearance          |
| Cyber   | Dark armour, cyan edge and magenta panels          | Cyberpunk and futuristic technology aesthetics   |
| Anime   | Cel shading, expressive square eyes and warm blush | Anime, chibi and cute illustration aesthetics    |
| Arcade  | Stepped pixel silhouette, violet and lime          | Retro gaming and playful digital culture         |

The three new designs evolve Classic's joined two-lobed body, single tuft, short
feet, rectangular eyes and triangular mouth. They offer recognisably different
visual languages, not just recolours. These are aesthetic choices available to
everyone, not demographic classifications or inferred user profiles. No analytics,
age question, gender question or automatic assignment is needed.

## Interaction

Settings > Appearance > App icon shows compact previews in a wrapping grid.
Existing `default` and `Classic` native identifiers remain stable. New identifiers
are `Cyber`, `Anime`, and `Arcade`. The selected radio tile is announced and the
existing native change operation disables choices while pending. Selection changes
only the launcher icon; it does not change the application name, package identity,
permissions or in-app theme. The existing Android restart explanation remains
visible. Do not hide operating-system confirmation UI.

The picker loads 192px previews, not 1024px native source files. Cyber uses the same
artwork for light and dark appearance. Anime and Arcade have dark background
exports; shared Classic tinted/monochrome artwork preserves recognition when the
OS applies a user-selected tint. The in-app mascot uses one shadow-free transparent
image on both surface modes, eliminating the old duplicated cutouts.

## Files and regeneration

- `assets/icons/catalog.json`: identifiers, directories and background colours.
- `assets/icons/<style>/mark.png`: optimised transparent source for the four rendered styles.
- `assets/icons/<style>/icon*.png`: opaque 1024px iOS/native build inputs.
- `assets/icons/<style>/android-foreground.png`: transparent 1024px adaptive foreground.
- `assets/icons/<style>/preview-*.png`: compact runtime picker assets.
- `assets/icons/mascot/brand-mark.png`: 512px transparent runtime mark.
- `assets/icons/monochrome.png`: shared Classic silhouette with facial cutouts.
- `assets/icons/favicon.png`: 64px web icon.
- `assets/icons/classic/`: original artwork and generated previews; preserves historical filenames.
- `assets/images/`: demo content only; launcher art no longer lives here.

Run `bun scripts/generate-brand-assets.ts` with ImageMagick 7 installed to regenerate
exports from checked-in masters. This is an authoring tool, not a runtime dependency.
Image generation is not part of builds. Generated PNGs strip metadata, use an
optimised palette without dithering and retain alpha on foregrounds. iOS exports
are flattened and have no transparency. Creative masters were produced with the
built-in imagegen tool; the discarded graphite/sage studies and large original
renders are not bundled. Prompt records are in `icon-generation-prompts.md`.

The new adaptive foregrounds fit inside a 440px square on a 1024px canvas: even
its diagonal fits inside Android's 66/108 safe circle. The full mascot stays
visible across launcher masks. Never embed an opaque miniature icon plate into
the foreground as the old generator did. Do not bake rounded corners into iOS
source images; the OS provides the mask.

Removed: superseded images-directory launcher/brand exports, the unused old
monochrome SVG and the unreferenced Expo template `.icon` package. Git history
retains previous artwork. Signing, package IDs and Expo project identity are unchanged.

## Size budget

The previous icon/brand/template assets occupied 3,287,498 bytes. The initial new
five-style package occupies approximately 1.25 MB including optimised masters,
exports and previews, a reduction of about 62%. The three new sets therefore do
not increase the source asset footprint. Exact APK/IPA download impact must be
measured from equivalent native builds; source PNG bytes are not an APK-size claim.

Keep the complete icon directory under 1.5 MB and the JS-loaded previews small.
Do not add full-resolution images to the picker or store duplicate identical dark
exports. Review any palette change on light, dark and saturated backgrounds and
at launcher size before accepting a smaller file.

## Store review and native acceptance

Apple's [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
require related app/alternate icon identity (2.3.8) and permit alternate icons with
user-initiated changes and a way to restore the original (4.6). Ship the choices in
the reviewed native binary and use the public alternate-icon mechanism. Keep the
original Muqun character, avoid franchise characters or third-party logos, and
explain the Settings path in review notes. These design choices support review;
they cannot guarantee approval.

[Android adaptive icon guidance](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)
specifies separate foreground/background layers, the 108dp canvas and 66dp safe
zone. Existing `expo-alternate-app-icons` 8.0.0 supports monochrome layers; its local
plugin was inspected before wiring the shared mask. No package patch is required.
The [Expo 57 configuration documentation](https://docs.expo.dev/versions/v57.0.0/config/app/)
was checked for icon configuration.

Before a PR is ready or a release is built:

1. Run the repository's five checks, including the full dedicated-device suite.
2. Build a fresh native binary; Metro or an OTA update cannot register new icons.
3. On the dedicated Android QA device, select every icon, reopen the app, confirm
   exactly one launcher entry, then restore Mascot and Classic. Inspect round,
   squircle and themed launcher appearances and verify pairing data survives.
4. On iPhone and iPad, test every alternate, light/dark/tinted appearance and restore
   default. iOS runtime testing requires the owner's Apple environment.
5. Review the icon grid with large text and screen readers; verify native failures
   do not misleadingly change the selected state or leave controls disabled.
6. Measure equivalent APK/IPA sizes and inspect compiled assets for alpha and masks.

Current work is design/asset preparation with source validation. Native launcher
switching, final device E2E and App Store review have not been completed for this branch.
