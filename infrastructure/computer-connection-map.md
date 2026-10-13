# Computer connection map

Computers → Connection map shows this app and paired computers. App reachability
uses the same freshness-aware resolver as Home and Computers. Peer arrows are
directed, last-known Gateway reports: they do not establish current connectivity,
reverse links, traffic, latency or geographical placement. Delegation preference
is shown independently of reachability. The screen never reconciles or writes
peer links. It reuses bounded read-only health probes, excluding SSH tunnels.

The scene contains at most 12 computers and 36 peer arrows; the accessible list
keeps every paired computer. Unpaired peers appear only in the selected
computer's report. Unidentified records cannot be placed. A failed latest peer
read is called out; every peer report is explicitly last-known because the
existing store has no reliable per-computer observation timestamp.

## Native dependency boundary

Exact additions: `@react-three/fiber` 9.8.1, `three` 0.186.1,
`react-native-webgpu` 0.13.1, and development typings `@types/three` 0.186.0.
Installed RNWebGPU and existing Skia 3.4.1 both resolve Dawn 154.3.0. React
19.3.0 and React Native 0.86.3 satisfy their declared peers. This is source and
package compatibility evidence, not a verified native runtime matrix.

RNWebGPU's Expo plugin and native autolinking require a new native binary. iOS
requires pod installation through the existing native build workflow. Preserve
the current Skia patch, signing identity, Android minimum API and architecture.
No Expo GL or React Native upgrade is involved. The existing fingerprint update
strategy includes native dependency/config changes. Do not deliver this as an
OTA-only feature to the existing binary.

The native host is lazy and gated on `WebGPUModule`. Older binaries, web,
reduced-motion mode, module import errors and renderer initialization errors use
the list. The React error boundary also covers scene errors in the separate
Fiber root. Native process crashes or loss of Skia's shared GPU device cannot
be recovered by a JavaScript boundary.

## Resource ownership

The host waits for nonzero layout and uses Fiber's async renderer factory before
mounting the scene. It imports Skia's device and never destroys that device.
Fiber owns and disposes the renderer and JSX-owned scene geometry/materials.
Canvas lifetimes are serialized by native context identity, including pending
initialization, StrictMode effect replay and resize. A cancelled initialization
finishes only to release its resources; it cannot render into a departed screen.

Demand rendering updates on data, theme, selection and camera input. There is no
automatic camera motion or particle/traffic loop. DPR is capped at 2. Blur,
background, list selection and reduced motion unmount the native host; the outer
screen retains camera and selection. Three still has internal scheduling until
disposal, so demand mode alone is not a zero-battery claim.

Native touches use a six-point tap threshold, bounded orbit and pinch distance.
Picking raycasts the actual R3F scene. Native text overlays show node labels;
the list provides full names, textual state and computer-details navigation.

## Verification boundary

Unit coverage verifies directed topology, absent/unknown/revoked evidence,
resource caps, stable ordering, cancellation and serialized disposal. The
`computer-map` full-tag native flow covers entry/list/close on unpaired QA.

Before releasing a native binary, verify Android and iOS first-frame rendering,
theme changes, orbit/pinch/picking, rotation/resize, background/foreground,
repeated entry/exit and leaving during initialization. Exercise unavailable GPU,
reduced motion and screen-reader navigation. Test alongside terminal/Skia
surfaces. Measure Release builds on the same dedicated QA device, at least two
runs per side, for memory after exit, idle work, interaction and entry time.
No native compilation, device rendering, platform coverage or performance
result is implied by a successful JS export or typecheck.

Primary integration references:
[RNWebGPU R3F](https://wcandillon.github.io/react-native-webgpu/docs/integrations/react-three-fiber),
[Skia shared device](https://wcandillon.github.io/react-native-webgpu/docs/integrations/react-native-skia),
[Fiber async WebGPU renderer](https://r3f.docs.pmnd.rs/api/canvas#webgpu),
[Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
