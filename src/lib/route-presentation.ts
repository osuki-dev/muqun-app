import type { NativeStackNavigationOptions } from 'expo-router';

export type SheetPresentation = 'sheet' | 'fullscreen';

/** One setting controls native presentation and the root safe-area frame. */
export const sheetRoutePresentations: Readonly<Record<string, SheetPresentation>> = {
  commands: 'sheet',
  panels: 'sheet',
  artifacts: 'sheet',
  'git-diff': 'sheet',
  'settings-theme': 'fullscreen',
  'new-task': 'sheet',
};

/** Route presentation is explicit: browsing is a page; short actions are sheets. */
export function sheetPresentationOptions(
  presentation: SheetPresentation,
  fitToContents = false,
  expandable = false
): NativeStackNavigationOptions {
  if (presentation === 'fullscreen')
    return {
      presentation: 'fullScreenModal',
      animation: 'fade',
      gestureEnabled: false,
    };
  return {
    presentation: 'formSheet',
    sheetAllowedDetents: fitToContents ? 'fitToContents' : expandable ? [0.82, 1] : [1],
    sheetGrabberVisible: true,
    contentStyle: { backgroundColor: 'transparent' },
  };
}
