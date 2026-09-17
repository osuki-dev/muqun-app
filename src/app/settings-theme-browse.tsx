import { ThemeBrowseSheet } from '@/components/theme-browse-sheet';
import { useOpenThemeEditor } from '@/hooks/use-open-theme-editor';

/**
 * The theme catalogue's route, and nothing else.
 *
 * The frame belongs to the sheet, exactly as it does for `settings-theme`: a
 * percentage-height wrapper collapses inside a native form sheet, so the route
 * adds no layout of its own.
 *
 * A route rather than a panel inside the theme sheet, which is what this was.
 * A catalogue is read by scrolling and a panel capped at 420pt inside an
 * already-long sheet is not a way to read one -- and only the navigator can
 * give a sheet its detent, its grabber and its dismissal gesture.
 *
 * No `onClose` either: it is a form sheet now, so the way out is the grabber
 * and the swipe rather than a button this route had to hand the sheet.
 */
export default function SettingsThemeBrowseScreen() {
  const openEditor = useOpenThemeEditor();
  return <ThemeBrowseSheet onReady={openEditor} />;
}
