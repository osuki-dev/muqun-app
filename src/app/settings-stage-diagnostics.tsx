import { useLingui } from '@lingui/react/macro';
import { Button, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import * as Clipboard from 'expo-clipboard';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetScene, SheetSceneFooter, sheetSceneStyles } from '@/components/sheet-scene';
import { clearStageArtEvents, useStageArtEvents } from '@/lib/stage-art-diagnostics';
import { formatStageArtLog } from '@/lib/stage-art-log';

/**
 * A developer's view of the Stage's art log: what happened to each theme
 * picture on its way into the 3D Home, newest first, to copy into a bug
 * report. Reached by long-pressing the version line in Settings; not linked
 * from anywhere else.
 */
export default function SettingsStageDiagnosticsScreen() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const events = useStageArtEvents();
  const text = formatStageArtLog(events);
  const lines = text ? text.split('\n') : [];

  return (
    <SheetScene
      fitsContent
      testID="settings-stage-diagnostics-sheet"
      title={t`Stage diagnostics`}
      caption={t`${events.length} events, newest first`}
      header={
        <View style={styles.actions}>
          <Button
            testID="stage-diagnostics-copy"
            disabled={lines.length === 0}
            onPress={() => {
              void Clipboard.setStringAsync(text).then(() =>
                showToast({ variant: 'info', title: t`Copied`, message: t`Stage log copied` })
              );
            }}>
            {t`Copy`}
          </Button>
          <Button
            variant="secondary"
            disabled={lines.length === 0}
            onPress={() => clearStageArtEvents()}>
            {t`Clear`}
          </Button>
        </View>
      }>
      <ScrollView
        nestedScrollEnabled
        style={sheetSceneStyles.fitScroller}
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="never">
        {lines.length === 0 ? (
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            {t`No Stage art events recorded yet.`}
          </Text>
        ) : (
          lines.map((line) => (
            <Text
              // A line starts with its millisecond timestamp, and a repeat
              // folds into the line before it: lines are unique.
              key={line}
              variant="caption"
              selectable
              color={
                line.includes(' failed') || line.includes(' gave-up')
                  ? theme.colors.danger
                  : theme.colors.text
              }>
              {line}
            </Text>
          ))
        )}
        <SheetSceneFooter bottomInset={insets.bottom} contentSized />
      </ScrollView>
    </SheetScene>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  list: { gap: 8, paddingHorizontal: 16 },
});
