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
 * longer than two.
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

function resolveDetents(
  detents: SheetDetents
): NativeStackNavigationOptions['sheetAllowedDetents'] {
  if (detents === 'fitToContents') return 'fitToContents';
  if (detents === 'full') return [1];
  if (detents === 'expandable') return [0.82, 1];
  return [...detents];
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
