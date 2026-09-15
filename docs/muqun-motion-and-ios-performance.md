# Muqun motion: focus, reveal, return

The motion system supports reading terminal output and switching tools repeatedly. It should acknowledge an action, preserve text geometry, and then stop. Theme colors and artwork supply identity; perpetual motion is not required to keep a workspace feeling alive.

## Interaction language

| Interaction                       | Treatment                                                                        | Reason                                                      |
| --------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Enter a page                      | Native 180 ms fade; header moves 4 points into place over 160 ms                 | One page transition owner, with a small Muqun title arrival |
| Return or dismiss                 | Reveal the existing page without replaying its mount animation                   | Preserve reading context                                    |
| Open a compact tool               | Native interactive sheet                                                         | Retain cancellation and drag behavior                       |
| Browse themes / full-screen tools | Page transition with a locally measured modal safe area                          | Keep close controls below the status bar                    |
| Change terminal panes             | Keep the canvas mounted and stationary; show the existing switch acknowledgement | Text does not slide or zoom while the reader tracks output  |
| List arrival                      | Short, 6-point movement and reduced staggering                                   | Avoid a long procession of cards                            |
| New connection state              | Two status-ring cycles, then still                                               | A stable online state must not keep requesting frames       |
| Loading                           | Three initial breaths, then a static loading mark and label                      | Long waits should not keep animating artwork indefinitely   |

System Reduce Motion is respected by the native page duration and shared animation helpers. Modal content and terminal geometry are not transformed as an entire screen. Full-screen settings use a fixed header outside a clipped scroll viewport; compact native sheets retain their required scroll root.

## Theme image identity

Home resolves the active theme, appearance mode and image URI before mounting a keyed hero renderer. A different combination owns a different Skia image hook and measurement state. The outgoing hero has no exit animation, so the old decoded image is not retained under the new theme while its replacement loads. Existing feathering and layout behavior remain.

## Terminal notice consistency

SSH, SSH-tunnel and Gateway connection notices share `TerminalNotice`: centered intrinsic width, a maximum available width, common padding, radius, text weight, wrapping and action treatment. The notice deck measures each page and sizes its decorative back pages to the front. Different text may require different widths; no transport forces a full-width strip just to show a short message. Transport-specific status and retry behavior are unchanged.

## Performance findings and limits

Code review confirmed unbounded status and loading animation loops, whole-page scale compositing, and gesture frame callbacks that were gated by gesture state but not both app activity and screen focus. These paths are now bounded or paused. The theme download sweep stops in the background and respects Reduce Motion. Connection notices no longer each need a separate live glass effect.

These are code-level findings, not measurements of the user's thermal problem. No iOS CPU, GPU, frame-time, temperature or battery delta has been measured locally. Network and terminal backends may also contribute during active output. iOS runtime validation remains required; Android behavior does not establish iOS performance.

## Validation handoff

Use the same iPhone, release configuration, brightness, theme and server workload before and after. Compare five minutes idle on Home, five minutes idle in Terminal, active output scrolling, and repeated Settings/theme navigation. Capture Instruments Time Profiler/Core Animation/Energy evidence and thermal state. Check that idle display-frame work stops after the initial acknowledgement.

Verify theme switching across light/dark modes, full-screen sheet opening and reopening after rotation, long translated connection notices, multiple notice pages, interrupted gestures, background/foreground return, and Reduce Motion. Confirm that no old hero remains and that close/retry actions remain reachable. This change does not modify or run device E2E files; device testing is delegated as requested.
