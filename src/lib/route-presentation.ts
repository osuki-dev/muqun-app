import type { NativeStackNavigationOptions } from 'expo-router';

export type SheetPresentation = 'sheet' | 'fullscreen';

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
