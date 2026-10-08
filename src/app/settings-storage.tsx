import { useLingui } from '@lingui/react/macro';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsStorage } from '@/components/settings-storage';
import { SheetScene, SheetSceneFooter } from '@/components/sheet-scene';

/** Storage settings uses the same native sheet as the other settings panels. */
export default function SettingsStorageScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();

  return (
    <SheetScene testID="settings-storage-sheet" title={t`Storage`}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <SettingsStorage />
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}
