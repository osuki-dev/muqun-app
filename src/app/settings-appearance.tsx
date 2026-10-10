import { useLingui } from '@lingui/react/macro';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsAppearance } from '@/components/settings-appearance';
import { SheetScene, SheetSceneFooter, sheetSceneStyles } from '@/components/sheet-scene';

/** Appearance settings uses the same native sheet as the other settings panels. */
export default function SettingsAppearanceScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();

  return (
    <SheetScene fitsContent testID="settings-appearance-sheet" title={t`Appearance`}>
      <ScrollView
        nestedScrollEnabled
        style={sheetSceneStyles.fitScroller}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <SettingsAppearance />
        <SheetSceneFooter bottomInset={insets.bottom} contentSized />
      </ScrollView>
    </SheetScene>
  );
}
