import type { NativeStackNavigationOptions } from 'expo-router';

export type SheetPresentation = 'sheet' | 'fullscreen';

/** One setting controls native presentation and the root safe-area frame. */
export const sheetRoutePresentations: Readonly<Record<string, SheetPresentation>> = {
  commands: 'fullscreen',
  panels: 'fullscreen',
  artifacts: 'fullscreen',
  'git-diff': 'fullscreen',
  'settings-theme': 'fullscreen',
  'new-task': 'fullscreen',
};

/** Route presentation is explicit: browsing is a page; short actions are sheets. */
export function sheetPresentationOptions(
  presentation: SheetPresentation,
  fitToContents = false
): NativeStackNavigationOptions {
  if (presentation === 'fullscreen')
    return {
      presentation: 'fullScreenModal',
      animation: 'fade',
      gestureEnabled: false,
    };
  return {
    presentation: 'formSheet',
    sheetAllowedDetents: fitToContents ? 'fitToContents' : [1],
    sheetGrabberVisible: true,
    contentStyle: { backgroundColor: 'transparent' },
  };
}
