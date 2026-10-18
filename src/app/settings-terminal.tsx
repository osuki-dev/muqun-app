import { useLingui } from '@lingui/react/macro';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsTerminal } from '@/components/settings-terminal';
import { SheetScene, SheetSceneFooter, sheetSceneStyles } from '@/components/sheet-scene';

/** Terminal settings uses the same native sheet as the other settings panels. */
export default function SettingsTerminalScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();

  return (
    <SheetScene fitsContent testID="settings-terminal-sheet" title={t`Terminal`}>
      <ScrollView
        nestedScrollEnabled
        style={sheetSceneStyles.fitScroller}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <SettingsTerminal />
        <SheetSceneFooter bottomInset={insets.bottom} contentSized />
      </ScrollView>
    </SheetScene>
  );
}
