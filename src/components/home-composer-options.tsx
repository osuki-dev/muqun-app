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
  replyTitle,
  onNewConversation,
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
  /** The conversation the next message replies to; no row without one. */
  replyTitle?: string;
  /** Lets the conversation go, as the drawer's header does, and closes the menu. */
  onNewConversation?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [showModes, setShowModes] = useState(false);
  // One label column, as wide as the widest label on one line, so values
  // start in one column in every language; past the cap a label ellipsizes.
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const [menuWidth, setMenuWidth] = useState(0);
  const widestLabel = Math.max(0, ...Object.values(labelWidths));
  const labelWidth =
    widestLabel > 0
      ? Math.min(
          Math.ceil(widestLabel) + LABEL_SLACK,
          menuWidth > 0 ? menuWidth * LABEL_MAX_SHARE : Infinity
        )
      : undefined;
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
  const replyLabel = t`Reply to`;
  const labels = replyTitle !== undefined ? [{ id: 'reply', label: replyLabel }, ...rows] : rows;
  return (
    <View
      testID="home-composer-options"
      onLayout={(event) => setMenuWidth(event.nativeEvent.layout.width)}>
      {/* Each label at its natural one-line width, measured out of sight. */}
      <View
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.measure}>
        {labels.map((row) => (
          <Text
            key={row.id}
            variant="bodySmall"
            weight="regular"
            numberOfLines={1}
            onLayout={(event) => {
              const { width } = event.nativeEvent.layout;
              setLabelWidths((prev) =>
                prev[row.id] === width ? prev : { ...prev, [row.id]: width }
              );
            }}>
            {row.label}
          </Text>
        ))}
      </View>
      {replyTitle !== undefined ? (
        <View>
          <View
            testID="home-composer-option-reply"
            accessible
            accessibilityLabel={t`Replying to ${replyTitle}`}
            style={styles.row}>
            <Text
              variant="bodySmall"
              weight="regular"
              numberOfLines={1}
              ellipsizeMode="tail"
              color={theme.colors.textMuted}
              style={[styles.label, labelWidth !== undefined && { width: labelWidth }]}>
              {replyLabel}
            </Text>
            <Text
              variant="bodySmall"
              weight="regular"
              numberOfLines={2}
              ellipsizeMode="tail"
              color={theme.colors.text}
              style={styles.value}>
              {replyTitle}
            </Text>
          </View>
          {onNewConversation ? (
            <PressableScale
              testID="home-composer-option-new-conversation"
              accessibilityRole="button"
              accessibilityLabel={t`New conversation`}
              style={[styles.row, styles.newConversation]}
              onPress={onNewConversation}>
              <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                {t`New conversation`}
              </Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
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
              numberOfLines={1}
              ellipsizeMode="tail"
              color={theme.colors.textMuted}
              style={[styles.label, labelWidth !== undefined && { width: labelWidth }]}>
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

/** Rounding room, so a label measured at its exact width never ellipsizes. */
const LABEL_SLACK = 1;

/** The most of the menu's width the label column may take. */
const LABEL_MAX_SHARE = 0.45;

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: { flexShrink: 0 },
  measure: { position: 'absolute', top: 0, left: 0, opacity: 0, alignItems: 'flex-start' },
  value: { flex: 1, minWidth: 0 },
  newConversation: { justifyContent: 'flex-end' },
  mode: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 26 },
});
