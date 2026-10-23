import { useLingui } from '@lingui/react/macro';
import { Button, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import * as Clipboard from 'expo-clipboard';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetScene, SheetSceneFooter, sheetSceneStyles } from '@/components/sheet-scene';
import {
  clearStageArtEvents,
  useStageArtEvents,
  useStageRenderInfo,
} from '@/lib/stage-art-diagnostics';
import { formatStageArtLog } from '@/lib/stage-art-log';

/**
 * A developer's view of the Stage's art log: what happened to each theme
 * picture on its way into the 3D Home, newest first, to copy into a bug
 * report, under what the Stage renders at now: its quality rung, pixel ratio
 * and texture sizes. Reached by long-pressing the version line in Settings;
 * not linked from anywhere else.
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
        <StageRenderSummary />
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

/** The rung, pixel ratio and texture sizes the Stage renders at, as measured now. */
function StageRenderSummary() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const info = useStageRenderInfo();
  if (!info) return null;
  const { quality } = info;
  const dpr = ratio(info.dpr);
  const device = ratio(info.deviceScale);
  const rows: [string, string][] = [
    [t`Quality rung`, info.trial ? t`${quality}, trying one rung up` : quality],
    [t`Pixel ratio`, t`${dpr} of the device's ${device}`],
    [
      t`Textures`,
      info.textures
        .map(({ slot, size, cap }) =>
          size
            ? t`${slot}: ${size}, capped at ${cap} px`
            : t`${slot}: not loaded, capped at ${cap} px`
        )
        .join('\n'),
    ],
  ];
  return (
    <View testID="stage-diagnostics-render" style={styles.summary}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text variant="caption" color={theme.colors.textMuted}>
            {label}
          </Text>
          <Text variant="caption" selectable color={theme.colors.text}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const ratio = (value: number) => String(Math.round(value * 100) / 100);

const styles = StyleSheet.create({
  summary: { gap: 4, paddingBottom: 8 },
  row: { gap: 2 },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  list: { gap: 8, paddingHorizontal: 16 },
});
