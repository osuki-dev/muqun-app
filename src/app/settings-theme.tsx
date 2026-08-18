import { useRouter } from 'expo-router';

import { SettingsThemeSheet } from '@/components/settings-theme-sheet';

/**
 * The theme sheet's route, and nothing else.
 *
 * The frame belongs to the picker, for the same reason it does in `panels` and
 * `artifacts` -- a percentage-height wrapper collapses inside a native form
 * sheet, so the route adds no layout of its own.
 *
 * A route rather than a modal rendered inside the settings page: a form sheet
 * is a native presentation, and only the navigator can give it its detent, its
 * grabber and its dismissal gesture. It also means the pick can be applied and
 * the sheet closed with `router.back()`, which is one thing, instead of a
 * boolean the page has to own.
 */
export default function SettingsThemeScreen() {
  const router = useRouter();
  return <SettingsThemeSheet onClose={() => router.back()} />;
}
