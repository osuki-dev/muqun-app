# Custom themes and the agent authoring protocol

Status: architecture proposal and implementation in progress, September 9, 2026. This feature belongs in its own PR, separate from machine switching. This document describes intended behavior, not completed device validation.

## Product contract

Make Muqun feel personal without turning Settings into a configuration editor.

- Keep one entry: Settings > Appearance > Themes, with built-in themes, personal themes, import, and agent-assisted creation
- Every pack contains complete light and dark variants; applying a pack preserves the user's system/light/dark preference
- Themes contain data, optional artwork, and home identity, never executable plugins or navigation changes
- Built-in themes remain image-free; absent artwork preserves the existing color-only presentation
- Home name and logo independently support default, custom, or hidden; hidden elements and their spacing disappear
- Home identity affects the expanded and collapsed home titles only, not the installed app name, launcher icon, splash screen, notifications, or About
- Files, links, and agent output open a preview; nothing automatically activates a theme
- Keep the ordinary path short: choose, preview, apply; expose advanced settings one module at a time

Use personality on the shell and home screen while keeping content and actions legible. Preserve current fonts, spacing, and interaction semantics. Cute comic themes may use pastel paper, hand-drawn edges, and restrained halftones; more dramatic themes may use dark materials and luminous edge details. Neither may compromise terminal readability.

## Existing integration points

| Existing module                           | Responsibility                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/constants/theme-packs.ts`            | Preserve built-in registry and the existing 17 UI colors, terminal tokens, and light/dark contract |
| `src/hooks/use-theme-pack.ts`             | Feed built-in and imported colors through the same providers and terminal palette path             |
| `src/stores/app-settings.ts`              | Store theme selection, not large manifests or image bytes in SecureStore                           |
| `src/components/settings-theme-sheet.tsx` | Theme library and previews using representative components, not a live terminal per tile           |
| `src/lib/quick-commands.ts`               | Versioned built-in agent skill, compatible with existing commands and hide/restore behavior        |
| `src/app/commands.tsx`                    | Compose a skill draft with optional attachments rather than pasting immediately into a shell       |
| `src/app/(drawer)/index.tsx`              | One home identity configuration for expanded and collapsed headers                                 |
| `src/app/_layout.tsx`                     | Update theme providers atomically and audit navigation backgrounds for default-color leaks         |

Use `src/theme/` for schema, compilation, repository, assets, import/export, and agent instruction assembly. Components consume validated, stable resolved values; components do not parse manifests or fetch author URLs independently.

Import entry > bounded download/unpack > schema validation > local assets > compilation > isolated preview > confirmation > atomic activation.

## Component architecture

The data layer validates and resolves themes. Shared surface, button, navigation, card, and composer components apply semantic colors and optional decoration slots. Screens only compose these components and define their layout.

A theme change updates shared components consistently. Primary, destructive, disabled, selected, and focused states remain distinct. Artwork never replaces the meaning of an action. Missing artwork adds no empty wrappers.

Changing appearance must not recreate terminal sessions, connections, current navigation, scroll position, or unsent drafts.

## Theme library and preview

Show the current theme and color-mode preference above personal and built-in collections. Import and Create are library actions, not repeated controls on every tile.

Import offers a system file picker, an explicitly pasted public link, or pasted JSON. Do not read the clipboard automatically.

Preview Home, Terminal, and Settings with representative components and fictional data. Include light/dark switching and a master decorations toggle. Keep Apply theme visible, with Save to my themes secondary. Preview does not change global state or connect to user machines.

Applying stays on the current screen and offers Undo. Keep Restore built-in theme accessible through reliable built-in styling. Preserve the last valid installation; corrupted startup data falls back safely.

Editing defaults to Save as my version rather than overwriting an upstream or built-in pack. Support resetting a module or all customization.

## Phone and iPad

- Respond to available width, not a device-name check; narrow split views use the phone layout
- Wide windows use a roughly 280–320 pt library column with preview/editor beside it and a content maximum around 1200 pt; validate final breakpoints with large text
- Switch editing modules within the same surface instead of pushing nested pages; preserve unsent authoring drafts
- Render a shell background once per window; do not duplicate a full wallpaper for every terminal pane
- Rotation and resizing change cropping, not stored configuration, downloads, or drafts

## Decoration slots

| Slot                         | Customization                | Fallback                  | Constraint                                                |
| ---------------------------- | ---------------------------- | ------------------------- | --------------------------------------------------------- |
| `shell.background`           | App-wide paper or wallpaper  | Background color          | Behind app content, never system permission dialogs       |
| `home.background`            | Home-specific background     | Shell background          | Allow explicit inheritance removal                        |
| Home logo                    | Transparent identity artwork | Built-in logo             | Contain without cropping; independently hideable          |
| `home.decoration`            | Edge illustration or sticker | None                      | No hit testing or overlap with machine actions            |
| `navigation.background`      | Header/sidebar material      | Current surface color     | Preserve readable icons and titles                        |
| `tabs.background`            | Session tab container        | Current surface color     | Preserve selection, focus, and unread states              |
| `composer.background`        | Input area's outer shell     | Current surface color     | Keep text input on a controlled fill                      |
| `actions.background`         | Quick-action container       | Current surface color     | Preserve key order and hit targets                        |
| `buttons.primary.background` | Primary button texture       | Primary color             | Preserve text and interaction states                      |
| `cards.decoration`           | Small corner pattern         | None                      | Reuse bounded, small decoded resources                    |
| `emptyState.illustration`    | Empty-state artwork          | Existing empty state      | Preserve explanation and action                           |
| Terminal wallpaper, later    | Terminal interior            | Terminal background color | Separate renderer/performance gate; not in initial schema |

V1 does not replace semantic back, close, send, delete, connection, or permission glyphs. Icons follow colors; their surrounding surfaces may be decorated. Future noncritical icon sets must be explicitly bounded.

Native pickers, keyboards, permission prompts, and system glass are not arbitrary image surfaces. Verify existing blur/glass composition instead of making every layer transparent.

Slot controls are bounded: asset reference, cover/contain/tile, normalized focal point, opacity, and compact/regular overrides. Additional masks, anchors, or sizing controls require schema and renderer support together. No arbitrary coordinates, z-index, negative margins, scripts, HTML, CSS, or remote fonts.

Missing backgrounds fall back to colors. Missing custom logos fall back to the built-in mark unless explicitly hidden. Missing decorative images disappear without broken-image placeholders or layout gaps.

## Muqun Theme v1

Use one logical format with two transport forms:

- `.muqun-theme.json`: readable manifest for agents, copying, and public raw links
- `.muqun-theme`: ZIP with root `theme.json` and `assets/`, for self-contained offline sharing

Only declared static assets belong in a package. No executable installation content.

| Field                             | Meaning                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `format`                          | Literal `muqun-theme`                                                                    |
| `schemaVersion`                   | Integer 1; reject unsupported versions before preview                                    |
| `id`, `name`, `version`           | Author-provided metadata, not a trusted installation identity                            |
| `author`, `license`, `source`     | Optional attribution; never execute or automatically synchronize source                  |
| `variants.light`, `variants.dark` | Complete UI and terminal colors; no mutable upstream base-theme dependency               |
| `assets`                          | Bounded asset IDs mapping to package paths or public HTTPS URLs, optionally with SHA-256 |
| `decoration`                      | Shared optional slot configuration                                                       |
| `variantDecorations.light/dark`   | Mode-specific overrides; absent inherits, null removes                                   |
| `homeIdentity`                    | Independent default/custom/hidden name and logo                                          |

UI colors: background, surface, surfaceRaised, border, borderStrong, text, textMuted, textSubtle, textDisabled, primary, onPrimary, primarySubtle, danger, dangerSubtle, success, warning, info.

Terminal fields: background, foreground, cursor, link, selection, ansi. ANSI contains exactly 16 colors, normal 0–7 then bright 8–15.

External colors use `#RRGGBB` or explicitly permitted `#RRGGBBAA`. Main text and surfaces must be opaque. Only designated subtle/selection roles permit alpha. Compile into the existing internal color contract.

Home name example: `{ "mode": "custom", "text": "Mochi Lab" }`. Hidden logo example: `{ "mode": "hidden" }`. Names are bounded plain text. Hiding both removes the brand block, related spacing, and brand introduction, while retaining Settings and pairing actions. The collapsed home header follows the same rules. Do not add a branding area to an iPad workspace.

Precedence: color base > shared slot > mode override > width override > user decoration opt-out and readability protection. Undefined inherits; null explicitly removes an image.

Allocate a local installation ID and content hash. An untrusted manifest ID never overwrites another installation silently. Offer previewed update or Save a copy for duplicate author IDs.

## Remote assets and offline ownership

Support GitHub raw files, Release attachments, and other public HTTPS downloads. If a GitHub page returns HTML, explain that a raw/download link is required. Only normalize explicitly supported and tested URL forms.

Show source and resource domains before fetching images. Use an independent unauthenticated downloader, never Gateway authorization, cookies, SSH credentials, or terminal context.

V1 accepts only public HTTPS destinations. Reject URL credentials, localhost, private/link-local/reserved addresses, and other schemes; revalidate redirects. Constrain actual connection destinations, not merely URL strings, to address DNS rebinding. If Expo's JS transport cannot enforce this, implement the required native adapter rather than turning Gateway into an arbitrary URL proxy. This remains a release gate.

Download and validate enabled assets into app-owned persistent storage, named by content hash. Render local resources only. An author's later changes or deletion cannot change an installed theme, and app startup must not contact the author's server.

On download failure offer retry or explicit colors-only import as a separate stripped copy. Missing package files, hash mismatches, and malformed data reject the package rather than silently producing a partial success.

Initial limits: 256 KiB manifest, 32 assets, 8 MiB per asset, 25 MiB compressed package, 50 MiB expanded package, and 16 MP per image. Enforce streaming byte limits, cancellation, timeouts, and bounded concurrency. Refine decoded-memory budgets using low-memory Android and iPad multiwindow measurements.

V1 supports static PNG, JPEG, and WebP only. Verify actual type and dimensions. Reject animated images, SVG, video, remote fonts, path traversal, absolute paths, symlinks, duplicate normalized paths, nested archives, and undeclared files during extraction.

Default export is an offline package using installed validated bytes, without downloading again. Include only theme data and approved artwork, never machine lists, chat, reference-only images, local machine paths, or pairing data. Also offer color-only JSON export and removal of optional source links containing query parameters.

## Built-in English authoring skill

Agent shortcut delivery is configurable, not theme-specific. A shortcut may send
to the current agent or open Agent collaboration with an editable task draft.
Existing shortcuts default to current-agent delivery. Custom agent shortcuts can
choose collaboration at creation or change it later in the shortcut editor.
Bundled instruction builders are registered separately; the theme creator is one
registry entry. Custom text cannot impersonate a bundled instruction builder.
Route URLs carry only command identity, while instruction snapshots and separate
per-command/per-machine drafts stay in local memory. All delegated commands reuse
the existing compatibility checks, agent picker, submission, task history, and output.

The built-in command is `Create a Muqun theme`. Its versioned English instruction is bundled with the app, not downloaded from theme authors or translated into locale catalogs. Derive its format reference from the same schema as the parser and include a complete valid light/dark template.

Tapping opens the existing composer with a collapsible Theme creator instruction attachment, optional requirements, and optional pictures. Avoid a full-screen wall of English instructions.

Each image is marked Reference colors only by default, or Also use as artwork. Optional artwork roles are background, logo, or decoration. Show the target machine/agent and explain image disclosure before sending. Never attach unrelated photos or pairing information.

Settings can inspect, hide, and restore the command but cannot execute without a target. Ordinary shell mode has no executable entry. From Themes, ask the user to select an active agent.

Validate fresh server/session/pane/agent instance and supported transport both when composing and sending. If the agent exits, changes identity, is busy, or is awaiting trust/permission, preserve the draft rather than falling back to raw shell input. Never automatically retry ambiguous task delivery.

Image support depends on the actual agent/transport. A filesystem path alone is not evidence that the model saw an image. Text-only creation remains available.

The instruction requires:

1. Complete light/dark UI and terminal colors with readable text and meaningful status colors
2. Reference-only images stay out of the pack; approved artwork uses request-scoped IDs mapped only to authorized attachments, never arbitrary returned device paths
3. Without image capability, return a complete color theme and explain limitations; never invent asset URLs
4. Prefer writing `<slug>.muqun-theme.json` in an authorized workspace, validating it when tooling is available, and returning a clickable path; without file tools, return one complete `muqun-theme` fenced JSON block
5. Do not change app code, install dependencies, publish releases, push commits, or upload private images as a side effect of authoring

## Returned theme previews

Recognized theme files get an explicit theme preview action through the existing file-link parser. Preserve ordinary URL boundaries and Gateway workspace restrictions. For inaccessible files, offer pasted JSON or a public URL.

Complete fenced blocks in structured agent output can become candidate cards with the name, light/dark preview, image count, and Preview theme. Do not repeatedly scan the full moving ANSI screen with a large JSON regex. Prefer file links in raw terminals and explicit JSON paste when no reliable complete output is available.

Every candidate passes the same import checks. Recognition is not trust, and hashes are not author signatures. Display multiple candidates individually.

## Runtime safety and recovery

- Compile immutable resolved themes once per installed content hash; output updates must not reparse themes or decode images
- Use the same color-consumer contract for built-in and imported themes; isolate decorations in shared slot components
- Persist installed assets separately from disposable thumbnails; reference-count deletion across packs
- Stage imports separately; cancellation cleans only its own staging data, and activation happens only after durable installation
- Isolate preview providers from global state and preserve live app state on apply
- Decorative layers never intercept touch or accessibility focus; the app owns state feedback and dangerous-action semantics
- Keep text on controlled surfaces; a weak overlay does not guarantee readability over arbitrary images
- Audit critical text/button/terminal pairs and provide a repair preview; do not activate unreadable critical combinations
- Respect system reduced-motion and enhanced-contrast preferences; keep a reliably readable recovery control

## Gateway boundary

Theme format, public-link import, local application, and export do not need a dedicated Gateway service.

Agent authoring reuses task/attachment transport but requires atomic instance-bound submission. If the current backend only checks then sends, add the necessary Gateway capability to close the agent-exit race. Older Gateways still support theme import/application; never downgrade the skill into shell input.

Detect capabilities rather than guessing Herdr versions. Do not expand Files workspace access or add arbitrary path/URL proxying.

## Delivery order and verification

Use one independent feature branch/PR with testable commits:

1. Schema, complete examples, compatibility migration, pure compiler, and unchanged built-in snapshots
2. Local/remote import, limits, extraction defenses, persistence, isolated preview, apply/undo, offline export/reimport
3. Shared shell/home/navigation/composer slots and responsive library/editor
4. Built-in skill draft, image roles, instance-bound submission, returned-file/structured-output preview
5. Separate terminal-wallpaper performance and ANSI-background compatibility experiment; do not expose the slot unless it passes

Required coverage:

- Missing variants/tokens, invalid ANSI length, unsupported fields, oversize payloads, path traversal, redirects to private addresses, corrupt images, duplicate IDs, and hash mismatch
- Image-free baseline, all home name/logo visibility combinations, collapsed header, long names, and large text without phantom spacing
- Mode changes, rotation/split view, offline cold start, broken sources, cancellation/process exit, undo, and export/reimport fidelity
- Exited/replaced/busy agents, trust prompts, shells, old Gateways, and unsupported attachments never receive skill text as shell input
- Real isolated agent sees approved references, produces a valid file, and the app previews/applies/exports/reimports it
- Full agent-device E2E on Android/iOS and real iPad wide/narrow screenshots, never using user pairings, links, or private photos
- Measure apply latency, scrolling/output responsiveness, and peak decoded memory against the same-device color-only baseline

Before opening a PR, run repository gates in order: typecheck, lint, formatting, unit tests, full E2E. Distinguish real-device evidence from mocks. Ship protocol documentation, English skill, valid examples, and tests together.

## References

Expo SDK 57 [Image documentation](https://docs.expo.dev/versions/v57.0.0/sdk/image/) supports reusing expo-image cropping and caching, but installed theme assets need repository-owned persistent storage. Download destination enforcement and archive implementation still require verification; this plan does not claim existing APIs are sufficient.
