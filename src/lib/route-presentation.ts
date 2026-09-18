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

/** What a sheet holds, which is what decides its one Android height. */
export type SheetContent = 'list' | 'short';

/**
 * The sheets whose content is a list long enough to run past the sheet.
 *
 * This decides one thing, and only on Android: which single detent the sheet
 * gets (see `resolveDetents`). A list sheet opens at its **largest**, so the
 * most rows fit; everything else keeps the height it opens at today.
 *
 * Correctness does not depend on this table -- a single detent is reachable
 * whichever detent it is, because the laid-out height and the visible height
 * become the same number either way. It is a judgement about how tall a sheet
 * should arrive, and the cost of getting an entry wrong is a sheet that opens
 * taller or shorter than it wants, never a row nobody can reach.
 */
export const sheetRouteContent: Readonly<Record<string, SheetContent>> = {
  // The quick actions: tiles, then a grouped list that grows with the machine.
  commands: 'list',
  // Machines, backends, workspaces and panels in one column -- "what is
  // running", and the longest list in the app on a busy server. `sessions` is
  // the same screen under its old deep link, so it takes the same height.
  panels: 'list',
  sessions: 'list',
  // The files a session produced.
  artifacts: 'list',
  // A diff: one row per line, so it is a list by definition.
  'git-diff': 'list',
  'agent-vcs-diff': 'list',
  // Thirty-two packs, and a catalogue that is longer.
  'settings-theme': 'list',
  'settings-theme-browse': 'list',
  // The agent's long pickers. The model sheet is the one the owner reported:
  // 126 models, and the last of them has to be reachable.
  'agent-model': 'list',
  'agent-workspace': 'list',
  'agent-sessions': 'list',
  'agent-worktree': 'list',
  // What is still running after the agent moved on.
  'agent-shells': 'list',
  'agent-tasks': 'list',

  // Everything below is a handful of rows or a form, and opens where it always
  // has. A sheet that jumps to full height to ask for four options is louder
  // than the question.
  'agent-mode': 'short',
  'agent-context': 'short',
  'settings-font': 'short',
  'settings-language': 'short',
  'new-task': 'short',
  explore: 'short',
  'web-service': 'short',
  'opencode-guide': 'short',
};

/**
 * One detent on Android, and why the documentation leaves no alternative.
 *
 * react-native-screens lays an Android form sheet out at its **largest** detent
 * whatever detent it is resting at, and reaches a smaller one by sliding the
 * whole view down the screen. That is not an oversight to be worked around with
 * a better arrangement of children -- it is the design, stated in the library:
 *
 * > For Yoga we require the container height to be "stable" to avoid updating
 * > content size in flight. If left as MATCH_PARENT, BottomSheetDialog
 * > dynamically applies insets as padding when sheet overflows status bar or
 * > display cutout. This causes Yoga to recalculate the layout, resulting in UI
 * > flickering during the drag gesture.
 * >   -- `gamma/modals/formsheet/FormSheetDimensionsCoordinator.kt:75-81`
 *
 * The consequence is that a `flex: 1` scroller inside a multi-detent Android
 * sheet is handed a viewport `(largest - current) / largest` taller than the
 * sheet anyone can see, and that excess hangs below the screen edge where no
 * amount of scrolling reaches it -- a scroller's travel is `content - viewport`
 * and it is the *viewport's* own bottom that is off-screen. The owner found it
 * on the workspace switcher; for the model picker's `[0.6, 1]` it is 40%.
 *
 * Every documented escape was checked against 4.28.0, and this is why the
 * answer is one detent rather than a restructure:
 *
 * - **Nesting is not the problem.** No first-child or direct-child rule exists
 *   for a sheet's scroller. The package states such a rule only for
 *   `scrollEdgeEffects` (`types.tsx:245`, iOS), tab scroll-to-top
 *   (`TabsScreen.types.ts:72-74`), `HeaderConfig` (`ScreenStackItem.tsx:145`)
 *   and `ScreenFooter` (`ScreenFooter.kt:29`). Material's own
 *   `BottomSheetBehavior.findScrollingChild` is an unbounded recursive
 *   depth-first search, re-run on every layout pass, so the scroller is found
 *   at any depth. The heading and the ground above ours cost it nothing.
 * - **`sheetExpandsWhenScrolledToEdge` does not exist on Android.** It is
 *   `@platform ios` (`types.tsx:453-460`); the value is stored at
 *   `Screen.kt:96`, assigned at `ScreenViewManager.kt:378`, and read nowhere.
 *   The newer API says so outright: `// TODO: @t0maboro - implement later`
 *   (`FormSheetHostViewManager.kt:106-111`).
 * - **`sheetInitialDetentIndex` moves the sheet, not the layout.** It seeds the
 *   behaviour's state only (`SheetDelegate.kt:34-42`); `maxAllowedHeight` is
 *   still `heightAt(count - 1)` (`SheetDetents.kt:55`). Opening at `'last'`
 *   would put the dead zone back the moment the reader dragged down.
 * - **`sheetDefaultResizeAnimationEnabled` is unreachable** unless the sheet is
 *   `fitToContents` (`Screen.kt:157-176`), which a list sheet is not.
 * - **`unstable_sheetFooter` cannot size a viewport.** It is an overlay laid
 *   out by hand against the live sheet offset, and React is told nothing about
 *   it ("React has no clue about updates enforced in below method",
 *   `ScreenFooter.kt:239-266`).
 *
 * So: one detent. `useSingleDetent` (`BottomSheetBehaviorExt.kt:19-34`) pins the
 * sheet, the laid-out height and the visible height become the same number, and
 * the overflow is nought -- which is what makes every row reachable, and what
 * makes Expo's own promise for numeric detents true again: "your modal content
 * can use `flex: 1` to fill the available space within the sheet".
 *
 * Which detent is `sheetRouteContent`'s call. A **list** sheet takes its
 * largest, so it arrives tall and the most rows fit; everything else keeps the
 * height it opens at today. What Android still loses is dragging a sheet
 * taller. iOS keeps the whole array, because it resizes the presented view to
 * each detent and has none of this.
 */
export function resolveDetents(
  detents: SheetDetents,
  content: SheetContent = 'short',
  platform: string | undefined = process.env.EXPO_OS
): NativeStackNavigationOptions['sheetAllowedDetents'] {
  const heights = detentHeights(detents);
  if (heights === 'fitToContents') return 'fitToContents';
  if (platform !== 'android' || heights.length <= 1) return [...heights];
  // `Math.max` rather than the last entry, because that is how the native side
  // reads the array too (`SheetDetents.highest()`).
  return [content === 'list' ? Math.max(...heights) : heights[0]!];
}

/** Route presentation is explicit: browsing is a page; short actions are sheets. */
export function sheetPresentationOptions(
  presentation: SheetPresentation,
  detents: SheetDetents = 'full',
  content: SheetContent = 'short'
): NativeStackNavigationOptions {
  if (presentation === 'fullscreen')
    return {
      presentation: 'fullScreenModal',
      animation: 'slide_from_bottom',
      gestureEnabled: false,
    };
  return {
    presentation: 'formSheet',
    sheetAllowedDetents: resolveDetents(detents, content),
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
    sheetRouteDetents[route] ?? 'full',
    sheetRouteContent[route] ?? 'short'
  );
}
