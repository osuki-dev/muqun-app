import { useLingui } from '@lingui/react/macro';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsServers } from '@/components/settings-servers';
import { SheetScene, SheetSceneFooter } from '@/components/sheet-scene';

/** Server management uses the same native sheet as the other settings panels. */
export default function SettingsServersScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();

  return (
    <SheetScene testID="settings-servers-sheet" title={t`Servers`}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <SettingsServers />
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}
