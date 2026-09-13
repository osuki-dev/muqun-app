# Pocket Muqun brand assets

The approved September 9, 2026 Pocket Muqun artwork replaces the launcher
light/dark masters. These are brand assets, not user-customizable theme assets.
Custom theme home identity must not rename the installed application or change
its package identity.

## Asset mapping

| Asset                                  | Consumer                                 | Requirements              |
| -------------------------------------- | ---------------------------------------- | ------------------------- |
| `assets/images/icon.png`               | Expo fallback and iOS light icon         | 1024 × 1024 opaque PNG    |
| `assets/images/icon-dark.png`          | iOS dark icon                            | 1024 × 1024 opaque PNG    |
| `assets/images/favicon.png`            | Web favicon                              | 64 × 64 PNG               |
| `assets/images/brand-mark-3d.png`      | In-app mark on light surfaces (Settings) | 512 × 512 PNG, real alpha |
| `assets/images/brand-mark-3d-dark.png` | In-app mark on dark surfaces (Settings)  | 512 × 512 PNG, real alpha |

The two in-app marks are cut from the masters, not painted: the flat plate is
flood-filled to alpha 0 from the border, edge pixels have the plate colour
removed by un-blending against the nearest fully opaque neighbour, and the soft
grounding shadow becomes translucent black rather than a plate-tinted smear.
Verify with `sips -g hasAlpha` and by compositing on a saturated colour -- both
were checked on magenta and cyan. The dark cut keeps the dark rim the master was
lit with, so it is only ever drawn on a dark ground; the light cut is the one to
reach for anywhere the ground is not known.

The existing Expo configuration already references these paths. Preserve
`dev.osuki.muqun`, the Expo project, and signing credentials. Native launcher
changes require a new native build; a Metro reload does not validate them.

## Adaptation still pending

Android adaptive foreground, Android monochrome, splash, and in-app loading
marks still use the previous artwork. Do not mark the brand migration complete
until these are replaced and visually checked on devices. In particular:

- A painted checkerboard is not transparency. Inspect the actual alpha channel
  before accepting generated cutouts.
- Keep the entire mascot, including crest and feet, inside adaptive-icon safe
  bounds and inspect round and rounded-square launcher masks.
- Monochrome artwork needs a readable silhouette and facial negative space;
  do not use a full opaque rectangle as its mask.
- Check splash and loading marks against both light and dark surfaces.
- Check light/dark iOS launcher appearance and iPad sizes in a native build.

The imagegen transparent-cutout attempts were rejected because their output had
no alpha channel. Neither rejected image is included in the application.

Source masters remain in the Desktop `Muqun-Pocket-Logo-2026-09-09` handoff
folder. The repository copies above are self-contained build inputs and do not
depend on that Desktop path. Store compliance still requires normal release
review; asset dimensions alone do not guarantee approval.
