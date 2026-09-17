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

/** One setting controls native presentation and the root safe-area frame. */
export const sheetRoutePresentations: Readonly<Record<string, SheetPresentation>> = {
  commands: 'sheet',
  panels: 'sheet',
  sessions: 'sheet',
  artifacts: 'sheet',
  'git-diff': 'sheet',
  'settings-language': 'sheet',
  'web-service': 'sheet',
  'settings-theme': 'fullscreen',
  'settings-theme-browse': 'fullscreen',
  explore: 'fullscreen',
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
