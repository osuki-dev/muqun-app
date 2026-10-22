import { useLocalSearchParams, useRouter } from 'expo-router';

import { ReskinSurface } from '@/components/reskin-transition';
import { goHomeAndWait } from '@/lib/home-arrival';
import { SettingsThemeSheet } from '@/components/settings-theme-sheet';
import type { ThemeTab } from '@/lib/theme-tab-preference';

const TABS: readonly ThemeTab[] = ['mine', 'builtin', 'gallery'];

/**
 * The themes sheet's route, and nothing else.
 *
 * The frame belongs to the sheet, for the same reason it does in `panels` and
 * `artifacts` -- a percentage-height wrapper collapses inside a native form
 * sheet, so the route adds no layout of its own.
 *
 * A route rather than a modal rendered inside the settings page: a form sheet
 * is a native presentation, and only the navigator can give it its detent, its
 * grabber and its dismissal gesture. It also means a pick can be applied and
 * the whole picker stack closed under the root reskin cover, landing on Home.
 *
 * `tab` opens a particular tab: the catalogue's old route forwards here with
 * `gallery`. Anything else is ignored rather than trusted.
 */
export default function SettingsThemeScreen() {
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const initialTab = TABS.find((value) => value === tab);
  return (
    <ReskinSurface id="settings-theme">
      <SettingsThemeSheet initialTab={initialTab} onClose={() => goHomeAndWait(router)} />
    </ReskinSurface>
  );
}
