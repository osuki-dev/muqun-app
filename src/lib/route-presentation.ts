import type { NativeStackNavigationOptions } from 'expo-router';

import { appChrome } from '@/constants/appearance';

export type SheetPresentation = 'sheet' | 'fullscreen';

/**
 * How tall a sheet is allowed to be.
 *
 * Named rather than spelled as fractions at every call site: the route table
 * below is the only place a detent is chosen, so "make every picker taller" is
 * one edit here instead of a hunt through `_layout.tsx`. An explicit array is
 * still accepted for the one sheet whose window is neither of the two shapes.
 *
 * Android caps at three detents and ignores the rest, so none of these is
 * longer than two -- and takes only the first of those two anyway. See
 * `resolveDetents` for what a second detent costs a sheet's content there.
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
  sessions: 'sheet',
  artifacts: 'sheet',
  'git-diff': 'sheet',
  'settings-language': 'sheet',
  'web-service': 'sheet',
  'settings-theme': 'sheet',
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
  'agent-context': 'sheet',
  'agent-vcs-diff': 'sheet',
  'agent-tasks': 'sheet',
  'agent-shells': 'sheet',
  'opencode-guide': 'sheet',
};

/**
 * The detents a platform can actually honour, which on Android is one.
 *
 * react-native-screens lays an Android form sheet out at its **largest** detent
 * whatever detent it is sitting at, and reaches a smaller one by sliding the
 * whole view down the screen. Measured in 4.28.0:
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
 * So a `flex: 1` scroller inside a two-detent Android sheet is handed a
 * viewport `(last - current) * H` taller than the sheet the reader can see,
 * and that excess hangs below the screen edge. It cannot be scrolled to: a
 * scroller's travel is `content - viewport`, and it is the *viewport's* own
 * bottom that is off-screen. For `expandable` that is 18% of the screen
 * permanently unreachable; for `[0.6, 1]` it is 40%.
 *
 * The owner found it on the workspace switcher -- a list whose last rows were
 * cut off by the screen edge and would not come up -- but every multi-detent
 * sheet in the table above has it, and the ones that look fine are the ones
 * whose content never reaches the dead zone.
 *
 * There is no arrangement of children that fixes it, because Yoga is not told
 * which detent the sheet is at; react-native-screens' own escape hatch for
 * bottom-anchored content is `ScreenFooter`, which native code repositions by
 * hand for exactly this reason (`ScreenFooter.kt:182-191`). What does fix it
 * is a single detent: `useSingleDetent` (`BottomSheetBehaviorExt.kt:19-34`)
 * pins the sheet expanded, so the laid-out height and the visible height are
 * the same number and the overflow is nought.
 *
 * The **first** detent rather than the largest, so that nothing about how a
 * sheet opens changes: every route above chose its opening height on purpose
 * and said why. What the reader loses on Android is dragging a sheet taller --
 * which today is not a feature but the only way to reach content that should
 * never have been hidden. iOS resizes the presented view per detent and keeps
 * the whole array.
 */
export function resolveDetents(
  detents: SheetDetents,
  platform: string | undefined = process.env.EXPO_OS
): NativeStackNavigationOptions['sheetAllowedDetents'] {
  if (detents === 'fitToContents') return 'fitToContents';
  const heights = detents === 'full' ? [1] : detents === 'expandable' ? [0.82, 1] : [...detents];
  if (platform === 'android' && heights.length > 1) return [heights[0]!];
  return heights;
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
