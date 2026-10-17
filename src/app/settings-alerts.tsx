import { useLingui } from '@lingui/react/macro';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsAlerts } from '@/components/settings-alerts';
import { SheetScene, SheetSceneFooter, sheetSceneStyles } from '@/components/sheet-scene';

/** Alerts settings uses the same native sheet as the other settings panels. */
export default function SettingsAlertsScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();

  return (
    <SheetScene fitsContent testID="settings-alerts-sheet" title={t`Alerts`}>
      <ScrollView
        nestedScrollEnabled
        style={sheetSceneStyles.fitScroller}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <SettingsAlerts />
        <SheetSceneFooter bottomInset={insets.bottom} contentSized />
      </ScrollView>
    </SheetScene>
  );
}
