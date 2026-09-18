import type { NativeStackNavigationOptions } from 'expo-router';

import { appChrome } from '@/constants/appearance';

export type SheetPresentation = 'sheet' | 'fullscreen';

/**
 * How tall a sheet is allowed to be.
 *
 * Named rather than spelled as fractions at every call site: `sheetRouteDetents`
 * below is the only place a detent is chosen, so "make every picker taller" is
 * one edit here instead of a hunt through `_layout.tsx`. An explicit array is
 * still accepted for the sheets whose window is neither of the two shapes.
 *
 * Both platforms cap at three detents and ignore the rest, so none of these is
 * longer than two. See `resolveDetents` for what the second detent costs a
 * sheet's content on Android, and `sheetDetentOvershoot` for what pays it back.
 */
export type SheetDetents = 'full' | 'expandable' | 'fitToContents' | readonly number[];

/**
 * One setting controls native presentation and the root safe-area frame.
 *
 * Every sheet-shaped route in this app is a native form sheet. The three that
 * were not -- the theme picker, the theme catalogue and pairing -- were
 * `fullScreenModal` frames wearing a hand-drawn X circle, and the owner found
 * the first of them with no way out at all: the X had gone when the sheets were
 * unified, and a full-screen route has no grabber to inherit instead. They are
 * sheets now, so the grabber and the swipe are the close for all of them.
 *
 * The two entries left on `fullscreen` are not sheets and never were. Each one
 * says why here, because this table is the allowlist
 * `sheet-scene-contract.test.ts` holds the app to.
 */
export const sheetRoutePresentations: Readonly<Record<string, SheetPresentation>> = {
  commands: 'sheet',
  panels: 'sheet',
  // The machines sheet's old address. It renders the same screen as `panels`
  // now -- machines, backends, workspaces and panels are one column -- and
  // stays only so the deep link keeps landing on the sheet it always meant.
  sessions: 'sheet',
  artifacts: 'sheet',
  'git-diff': 'sheet',
  'settings-language': 'sheet',
  'web-service': 'sheet',
  'settings-theme': 'sheet',
  'settings-font': 'sheet',
  'settings-theme-browse': 'sheet',
  explore: 'sheet',
  // A whole app screen wearing the theme being judged -- its floor, its
  // wallpaper, its header glass -- which is the one thing a sheet cannot be,
  // because a sheet is a panel over the theme the reader is leaving. Its
  // sliders and its long editor column also pan vertically, which is the
  // gesture a form sheet reads as dismiss.
  'custom-theme': 'fullscreen',
  // The Skia farm: a canvas that takes every touch on it, edge to edge.
  simfarm: 'fullscreen',
  'new-task': 'sheet',
  // The agent's pickers. Every one of them is a destination -- pick a model,
  // pick a workspace, read a diff -- so every one is a route rather than a
  // `<Modal>` the workbench keeps mounted whether it is open or not.
  'agent-sessions': 'sheet',
  'agent-model': 'sheet',
  'agent-mode': 'sheet',
  'agent-workspace': 'sheet',
  'agent-worktree': 'sheet',
  'agent-context': 'sheet',
  'agent-vcs-diff': 'sheet',
  'agent-tasks': 'sheet',
  'agent-shells': 'sheet',
  'opencode-guide': 'sheet',
};

/**
 * How tall each sheet opens, and how much taller it drags.
 *
 * This lived as a literal second argument at every `<Stack.Screen>` in
 * `_layout.tsx`, which made the table above tell half the truth: presentation
 * was chosen in one place and height in another. Both are here now, because a
 * third reader has appeared that needs the heights at runtime and cannot see
 * `_layout.tsx` at all -- `SheetScene`, which asks `sheetDetentOvershoot` how
 * much of an Android sheet is hanging below the screen. A screen cannot read
 * its own navigation options, so the route name is the key both ends share.
 *
 * A route missing from this table gets `'full'`, the same default
 * `sheetPresentationOptions` has always had.
 */
export const sheetRouteDetents: Readonly<Record<string, SheetDetents>> = {
  commands: 'expandable',
  panels: 'expandable',
  // The machines sheet's old deep link renders the same screen as `panels`, so
  // it takes the same window rather than the pair of detents it chose when it
  // was a list of its own.
  sessions: 'expandable',
  artifacts: 'expandable',
  'git-diff': 'expandable',
  // Both are lists the reader scrolls -- thirty-two packs, or a catalogue -- so
  // both take the expandable window every other list sheet has rather than the
  // whole screen.
  'settings-theme': 'expandable',
  'settings-theme-browse': 'expandable',
  // Two groups of four rows, with a URL field that opens inside one of them and
  // a keyboard over it. Expandable, so the field has somewhere to come up to.
  'settings-font': 'expandable',
  // One short list of languages: as tall as it is, and no taller.
  'settings-language': 'fitToContents',
  // Full height leaves room for the composer and keyboard.
  'new-task': 'expandable',
  // Open a web service (card #829). One field with a row of shortcuts over it:
  // a full-height sheet for a port number would be the app implying the task is
  // bigger than typing four digits.
  'web-service': 'fitToContents',
  // Pairing: a viewfinder, two fields and a way in.
  explore: 'expandable',
  'agent-sessions': 'expandable',
  // A model list is usually browsed and sometimes filtered to two rows. At the
  // expandable detent those two rows sat at the top of a sheet that was 82% of
  // the screen, and the rest was ground. It opens at just over half and drags to
  // full, which is the same two shapes with far less void under a short list.
  'agent-model': [0.6, 1],
  'agent-mode': 'expandable',
  'agent-workspace': 'expandable',
  // The project's checkouts: a short list, a create form under it, and a
  // keyboard over both while the name is being typed. Expandable, so the fields
  // have somewhere to come up to.
  'agent-worktree': 'expandable',
  'agent-context': 'expandable',
  'agent-vcs-diff': 'expandable',
  // A short list with its own scroll root, so it takes a bounded viewport rather
  // than circular fit-to-content sizing.
  'agent-tasks': [0.65, 0.9],
  // What is still running after the agent moved on: a short list with one
  // expandable output box, so it takes a bounded viewport for the same reason.
  'agent-shells': [0.65, 0.9],
  // One banner, one command and one button: content-sized, for the reason
  // `web-service` is.
  'opencode-guide': 'fitToContents',
};

/** The named windows, spelled out. Ascending, which `highest` relies on. */
const NAMED_DETENTS: Readonly<Record<'full' | 'expandable', readonly number[]>> = {
  full: [1],
  expandable: [0.82, 1],
};

/**
 * The fractions a sheet may sit at, or `'fitToContents'`, which is not a height
 * at all but an instruction to measure the content.
 */
function detentHeights(detents: SheetDetents): readonly number[] | 'fitToContents' {
  if (detents === 'fitToContents') return 'fitToContents';
  if (detents === 'full' || detents === 'expandable') return NAMED_DETENTS[detents];
  return detents;
}

/**
 * Every detent the route asked for, on both platforms.
 *
 * This function used to drop all but the first detent on Android, and the
 * reason it did is still true of the native layout -- what changed is that
 * `sheetDetentOvershoot` now pays for it in JS, so the sheet can be dragged
 * again. The measurement, from react-native-screens 4.28.0:
 *
 * - `SheetDelegate.kt:216-225` gives `BottomSheetBehavior` `peekHeight =
 *   detents[0] * H` and `maxHeight = detents[last] * H`.
 * - Material's `BottomSheetBehavior.getChildMeasureSpec` then measures the
 *   child at `min(parentHeight, maxHeight)` -- the *largest* detent -- and
 *   `onLayoutChild` reaches the smaller one with `offsetTopAndBottom`.
 * - `Screen.kt:247-263` pushes that same largest-detent height into Yoga as
 *   `frameHeight`, and `RNSScreenComponentDescriptor.h:102-103` makes it the
 *   shadow node's size. Nothing shrinks it when the detent changes:
 *   `Screen.kt:563-566` sends the same `height` with only a new
 *   `contentOffsetY`, and `getContentOriginOffset` is documented at
 *   `LayoutableShadowNode.h:121-129` as applying to `getRelativeLayoutMetrics`
 *   and `findNodeAtPoint` alone -- measure and hit-testing, never a mounted
 *   view's position.
 *
 * So an Android sheet is always laid out at its largest detent, and at any
 * smaller one the bottom `(largest - current) / largest` of that layout is
 * below the screen edge. A `flex: 1` scroller is handed a viewport whose own
 * bottom is off-screen, and a scroller's travel is `content - viewport`, so the
 * last rows sit in a dead zone scrolling cannot enter. That is what the owner
 * found on the workspace switcher, and what dropping the second detent fixed --
 * at the price of the drag, which the owner then asked for back.
 *
 * Yoga is never told which detent the sheet is at, so the fix is to tell it:
 * `SheetScene` subscribes to the `sheetDetentChange` navigation event, turns
 * the reported index into a fraction with `sheetDetentOvershoot`, and gives the
 * scroller's content that much extra bottom padding. The content then ends
 * where the *visible* sheet ends at every detent, and dragging up reveals more
 * rows rather than dead space. iOS needs none of it -- it resizes the presented
 * view per detent -- and `sheetDetentOvershoot` answers 0 there.
 */
export function resolveDetents(
  detents: SheetDetents
): NativeStackNavigationOptions['sheetAllowedDetents'] {
  const heights = detentHeights(detents);
  return heights === 'fitToContents' ? 'fitToContents' : [...heights];
}

/**
 * The fraction of an Android sheet's laid-out height that is below the screen.
 *
 * `index` is the detent the sheet is resting at, as `sheetDetentChange` reports
 * it -- an index into the very array `resolveDetents` handed the native side.
 * The sheet is laid out at `largest * H` and its visible height is
 * `current * H`, so the part hanging off the bottom is
 *
 *     laidOutHeight * (1 - current / largest)
 *
 * which is why this answers a *fraction* rather than pixels: multiplied by the
 * scene's own measured height it needs no window height, no status-bar inset
 * and no display metrics, and so cannot disagree with the native side about any
 * of them. The scene root is a `flex: 1` child of the screen's content view
 * with no chrome between them, so its measured height *is* `largest * H`.
 *
 * Zero on iOS, where the presented view is resized to each detent and nothing
 * hangs anywhere; zero for `fitToContents`, which has no detent array to be at
 * an index of; and zero for a single-detent sheet, where largest is current.
 *
 * The platform is read from `process.env.EXPO_OS`, inlined per bundle, so the
 * branch costs nothing at runtime -- the same mechanism `sheet-route-frame.tsx`
 * uses for the grabber.
 */
export function sheetDetentOvershoot(
  detents: SheetDetents,
  index: number,
  platform: string | undefined = process.env.EXPO_OS
): number {
  if (platform !== 'android') return 0;
  const heights = detentHeights(detents);
  if (heights === 'fitToContents' || heights.length === 0) return 0;

  // `highest` rather than `at(-1)`: the native side reads the array the same way
  // (`sheetDetents.highest()`), so a table entry written out of order would put
  // the two of them at odds rather than merely look odd.
  const largest = Math.max(...heights);
  const resting = heights[Math.min(Math.max(Math.trunc(index), 0), heights.length - 1)];
  if (!Number.isFinite(largest) || largest <= 0 || resting === undefined) return 0;

  // Clamped, because a detent taller than the largest is not a negative amount
  // of padding -- it is a table that needs fixing, and meanwhile the sheet
  // behaves exactly as it does today.
  return Math.min(Math.max(1 - resting / largest, 0), 1);
}

/** Route presentation is explicit: browsing is a page; short actions are sheets. */
export function sheetPresentationOptions(
  presentation: SheetPresentation,
  detents: SheetDetents = 'full'
): NativeStackNavigationOptions {
  if (presentation === 'fullscreen')
    return {
      presentation: 'fullScreenModal',
      animation: 'slide_from_bottom',
      gestureEnabled: false,
    };
  return {
    presentation: 'formSheet',
    sheetAllowedDetents: resolveDetents(detents),
    sheetGrabberVisible: true,
    // One radius for every sheet, on both platforms. Left unset the prop
    // defaults to -1, which iOS reads as "system default" (~10pt) and Android
    // clamps to 0 -- square top corners. See `appChrome.radius.sheet`.
    sheetCornerRadius: appChrome.radius.sheet,
    contentStyle: { backgroundColor: 'transparent' },
  };
}

/**
 * The options for a sheet route, both halves read from the tables above.
 *
 * The two `fullscreen` routes keep their explicit
 * `sheetPresentationOptions(sheetRoutePresentations[...])` call in
 * `_layout.tsx`, because each of them also overrides the animation duration --
 * and because the contract test greps for exactly that spelling.
 */
export function sheetRouteOptions(route: string): NativeStackNavigationOptions {
  return sheetPresentationOptions(
    sheetRoutePresentations[route] ?? 'sheet',
    sheetRouteDetents[route] ?? 'full'
  );
}
