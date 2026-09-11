# Pocket Muqun brand assets

The approved September 9, 2026 Pocket Muqun artwork replaces the launcher
light/dark masters. These are brand assets, not user-customizable theme assets.
Custom theme home identity must not rename the installed application or change
its package identity.

## Asset mapping

| Asset                         | Consumer                         | Requirements           |
| ----------------------------- | -------------------------------- | ---------------------- |
| `assets/images/icon.png`      | Expo fallback and iOS light icon | 1024 × 1024 opaque PNG |
| `assets/images/icon-dark.png` | iOS dark icon                    | 1024 × 1024 opaque PNG |
| `assets/images/favicon.png`   | Web favicon                      | 64 × 64 PNG            |

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
