# Personal workspace interactions

## Navigation and loading

Root pages share a native cross-fade with a short Reanimated depth reveal
(16-point horizontal travel, scale 0.985 to 1). Native navigation retains route
identity and back-stack ownership; terminal canvases are never snapshotted or
duplicated for animation. Terminal routes disable the navigation swipe so it
cannot compete with terminal panning. Reanimated timings respect reduced motion.

`sheetPresentationOptions('sheet' | 'fullscreen')` makes presentation explicit.
Browse themes is full screen, with safe-area padding and an always-visible close
control; no grabber or sheet dismissal gesture competes with its list. New task
uses a full-height sheet and keyboard-aware scrolling. Short pickers remain sheets.

Startup resolves the active theme's locally installed `launch.artwork` first,
then `home.artwork`, then identity or bundled branding. A layout renders at most
one Home foreground image. Its first decoded frame is prepared before the startup
overlay leaves, using the same theme background to avoid a blank or mismatched
frame. Missing or broken imagery falls back to branding. Compact authentication
indicators remain compact; loading follows real work and adds no artificial wait.
Transitions respect reduced motion, keep route identity and use existing assets.

## Theme and input surfaces

App logos and available agents use horizontal rails. Theme browsing reveals the
next 20 cached index entries near the bottom, with a guard against duplicate
pagination callbacks. Packages still download only after selecting a theme.

`SheetHeading` shares the title/caption treatment across appearance and task
surfaces. Labels and input helper text use the same 18-point continuous corners.
Text plates stay opaque over custom wallpaper, independently of translucent
content cards, to preserve the palette's text contrast.

New task reuses `TerminalComposer`, `AttachmentMenu`, `AttachmentStrip`, image
preview, compression and `useAttachmentUploads`. Picking a file starts upload;
send waits for uploads and passes returned Gateway paths in the initial prompt,
matching the terminal pipeline. Failed uploads remain available for explicit
retry/removal. A synchronous send guard prevents double taps. Connection identity
and mounted state are rechecked before spawning after upload; stale picker results
are discarded by the existing ownership mechanism. No Gateway or Herdr patch is
required. A delivery failure is displayed without an automatic retry.

## Notification pages

Terminal status notices form one deck. Only the front page exposes text and
actions; up to two decorative page edges indicate more content. The count and
next control let readers cycle without dismissing a standing condition. Empty
or removed notices cannot leave an empty front page. Hidden pages retain their
state but expose neither touch targets nor accessibility elements. Notification
surfaces are opaque so terminal output cannot blend into their text.

Foreground push notifications use the same layered visual treatment while
retaining the existing FIFO queue and dismiss/open behavior. Agent approval
questions remain separate in the composer dock; notification navigation never
answers a permission request.

## Verification and remaining gate

The Android debug APK was rebuilt with all five launcher aliases. TypeScript,
lint, formatting and 3,763 unit tests passed (two existing skips). Native flow
syntax validation covers 27 enabled flows, including the new shared-composer
interaction flow.

The dedicated Android `personal-workspace` flow passed: agent rail, shared
composer, attachment choices, draft preservation and close/back behavior.
An initial regression attempt used a stale CI-mode Metro bundle and is not
evidence for this change. After restarting Metro with a fresh watched bundle,
the full run still failed to locate `theme-appearance-reset` and
`assignment-toggle`. The remaining run was stopped after those failures, in
accordance with the request to prioritize feature implementation. This is not a
passing full-suite result; those failures remain a merge blocker.
iOS runtime checks and a real paired attachment-to-agent round trip remain
required; offline demo checks alone do not prove delivery.
No release, signing change, Herdr fork or skill-file modification is included.
