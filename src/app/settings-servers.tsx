import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsServers } from '@/components/settings-servers';
import { SheetScene, SheetSceneFooter } from '@/components/sheet-scene';

/** Server management uses the same native sheet as the other settings panels. */
export default function SettingsServersScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  // `?serverId=` opens that computer's row: Home's card footer comes here.
  const { serverId } = useLocalSearchParams<{ serverId?: string }>();

  return (
    <SheetScene testID="settings-servers-sheet" title={t`Computers`}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <SettingsServers initialOpenId={typeof serverId === 'string' ? serverId : undefined} />
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}
