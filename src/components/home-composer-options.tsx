import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { timing } from '@/lib/motion';
import type { ModeInfo } from '@/lib/agent-session';

/** The choices behind Home's single toolbar control; draft ownership stays in the composer. */
export function HomeComposerOptions({
  open,
  onVisibilityChange,
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
  open: boolean;
  onVisibilityChange: (visible: boolean) => void;
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
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const { height } = useWindowDimensions();
  const [showModes, setShowModes] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const visibleHeight = useSharedValue(0);
  const opacity = useSharedValue(0);
  useEffect(() => {
    // Keep the content mounted inside its own shrinking viewport. An exiting
    // child outlives its Yoga layout and can otherwise draw behind the field.
    if (open) onVisibilityChange(true);
    visibleHeight.set(
      withTiming(open ? contentHeight : 0, timing('dropdown'), (finished) => {
        // A cancelled close must not reveal artwork beneath a reopened list.
        if (finished && !open) scheduleOnRN(onVisibilityChange, false);
      })
    );
    opacity.set(withTiming(open ? 1 : 0, timing('micro')));
    if (!open) setShowModes(false);
  }, [open, contentHeight, visibleHeight, opacity, onVisibilityChange]);
  const revealStyle = useAnimatedStyle(() => ({
    height: visibleHeight.get(),
    opacity: opacity.get(),
  }));
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
    <Animated.View
      testID="home-composer-options"
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      style={[
        styles.viewport,
        {
          backgroundColor: background(theme.colors.surface),
          borderRadius: profile.chrome.popover,
        },
        revealStyle,
      ]}>
      <View
        style={styles.content}
        onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: Math.min(380, height * 0.45) }}>
          {rows.map((row) => (
            <View key={row.id}>
              <PressableScale
                testID={`home-composer-option-${row.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${row.label}: ${row.value}`}
                accessibilityState={{ disabled: !row.onPress }}
                disabled={!row.onPress}
                onPress={row.onPress}
                style={[styles.row, { borderBottomColor: theme.colors.border }]}>
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
                    <ChevronDown size={15} color={theme.colors.textMuted} />
                  ) : (
                    <ChevronRight size={15} color={theme.colors.textMuted} />
                  )
                ) : null}
              </PressableScale>
              {row.id === 'mode' && showModes
                ? modes.map((entry) => (
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
                  ))
                : null}
            </View>
          ))}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  viewport: { overflow: 'hidden' },
  content: { position: 'absolute', top: 0, left: 0, right: 0 },
  row: {
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { width: 74 },
  value: { flex: 1, minWidth: 0 },
  mode: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 20 },
});
