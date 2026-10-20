import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale, Text } from '@osuki-dev/ui';
import { DisclosureDownIcon, NextIcon } from '@/icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { ModeInfo } from '@/lib/agent-session';
import { fadeIn, fadeOut } from '@/lib/motion';

/**
 * The choices behind Home's single toolbar control; draft ownership stays in
 * the composer. Only the rows: the composer's floating menu is their card,
 * the same one the attachment button opens, and it mounts them while open.
 */
export function HomeComposerOptions({
  computer,
  agent,
  folder,
  model,
  mode,
  modes,
  offline,
  onComputer,
  onAgent,
  onFolder,
  onModel,
  onMode,
}: {
  computer: string;
  agent: string;
  folder: string;
  model: string;
  mode: string;
  modes: ModeInfo[];
  offline: boolean;
  onComputer: () => void;
  onAgent?: () => void;
  onFolder?: () => void;
  onModel?: () => void;
  onMode?: (id: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [showModes, setShowModes] = useState(false);
  const rows = [
    {
      id: 'target',
      label: t`Computer`,
      value: offline ? `${computer} · ${t`Offline`}` : computer,
      onPress: onComputer,
    },
    { id: 'agent', label: t`Agent`, value: agent, onPress: onAgent },
    { id: 'folder', label: t`Folder`, value: folder, onPress: onFolder },
    {
      id: 'mode',
      label: t`Mode`,
      value: modes.find((entry) => entry.id === mode)?.name || mode,
      onPress: onMode ? () => setShowModes((open) => !open) : undefined,
    },
    { id: 'model', label: t`Model`, value: model, onPress: onModel },
  ];
  return (
    <View testID="home-composer-options">
      {rows.map((row) => (
        <View key={row.id}>
          <PressableScale
            testID={`home-composer-option-${row.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}: ${row.value}`}
            accessibilityState={{ disabled: !row.onPress }}
            disabled={!row.onPress}
            onPress={row.onPress}
            style={styles.row}>
            <Text
              variant="bodySmall"
              weight="regular"
              color={theme.colors.textMuted}
              style={styles.label}>
              {row.label}
            </Text>
            <Text
              variant="bodySmall"
              weight="regular"
              numberOfLines={2}
              ellipsizeMode="middle"
              color={theme.colors.text}
              style={styles.value}>
              {row.value || '—'}
            </Text>
            {row.onPress ? (
              row.id === 'mode' && showModes ? (
                <DisclosureDownIcon size={15} color={theme.colors.textMuted} />
              ) : (
                <NextIcon size={15} color={theme.colors.textMuted} />
              )
            ) : null}
          </PressableScale>
          {row.id === 'mode' && showModes ? (
            <Animated.View entering={fadeIn('micro')} exiting={fadeOut('micro')}>
              {modes.map((entry) => (
                <PressableScale
                  key={entry.id}
                  testID={`home-composer-mode-${entry.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: entry.id === mode }}
                  onPress={() => {
                    onMode?.(entry.id);
                    setShowModes(false);
                  }}
                  style={styles.mode}>
                  <Text
                    variant="bodySmall"
                    weight="regular"
                    color={entry.id === mode ? theme.colors.primary : theme.colors.text}>
                    {entry.name || entry.id}
                  </Text>
                </PressableScale>
              ))}
            </Animated.View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: { width: 74 },
  value: { flex: 1, minWidth: 0 },
  mode: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 26 },
});
