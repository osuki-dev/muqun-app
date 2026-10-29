import { useLingui } from '@lingui/react/macro';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsAppearance } from '@/components/settings-appearance';
import { ReskinSurface } from '@/components/reskin-transition';
import { SheetScene, SheetSceneFooter, SheetSceneScrollView } from '@/components/sheet-scene';

/** Appearance settings uses the same native sheet as the other settings panels. */
export default function SettingsAppearanceScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();

  return (
    // The app icons run under a side status bar (iPhone Duo) to the sheet's edge.
    <ReskinSurface id="settings-appearance">
      <SheetScene testID="settings-appearance-sheet" title={t`Appearance`} sideInContent>
        <SheetSceneScrollView
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <SettingsAppearance />
          <SheetSceneFooter bottomInset={insets.bottom} />
        </SheetSceneScrollView>
      </SheetScene>
    </ReskinSurface>
  );
}
