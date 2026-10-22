# Dependency patch notes

## @osuki-dev/ui 2.0.0-beta.5

The source-only icon patch removes the optional Lucide runtime loader and its
fallback lookup. Muqun supplies semantic Nano glyphs through `IconProvider`;
Kit's built-in controls are translated at `src/icons/kit-resolver.tsx`.
This keeps Metro from resolving an unused SVG peer. No generated library
output is patched. Remove the patch when Kit supports disabling its optional
Lucide lookup or ships a resolver-only icon implementation.

## react-native-skia 3.7.1

The presentation patch adds `CanvasRef.whenPresented()` and
`CanvasRef.makePresentedImageSnapshot()` without synchronous snapshot/readback
probes. It waits for the latest React commit's native recorder, then acknowledges
only a successfully accepted recording presented to the current window. Content
replacement and surface recreation keep waiting for current content; unmount
resolves `false`. Notifications cross from the presentation thread to JavaScript
and revalidate content and surface generations before resolving. This confirms
window submission, not a GPU completion fence or physical display scanout.

The snapshot API waits for presentation, retains the actual presented recording
and replays it on Skia's native render pool into a GPU image. It returns `null` if
the view/content/surface changes during capture or the GPU capture fails; it does
not retry, read pixels to the CPU, or replay the React scene on the JS thread.
Web confirms a successful renderer draw into the DOM canvas; CanvasKit capture
stays on its owning browser thread and performs no CPU raster readback.

The patch also removes the duplicate redraw after React's `resetAfterCommit`
(which already hands off the recorder synchronously), and propagates Graphite's
actual accepted recording so rejected/partially recorded frames cannot falsely
acknowledge readiness. A source-owned declaration entry extends the upstream
Canvas types; generated library output is not patched.

Remove this patch when upstream provides equivalent generation-safe presentation
and asynchronous native presented-frame capture APIs, and no longer redraws each
React commit twice. Revalidate replacements, unmounts, surface recreation and GPU
rejection before removal. Focused JS lifecycle checks can be run with
`bun test ./node_modules/react-native-skia/src/sksg/presentation.test.ts`.
