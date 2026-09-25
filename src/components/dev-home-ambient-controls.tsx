import { useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { Text } from '@/components/text';
import {
  THEME_AMBIENT_EFFECTS,
  THEME_EFFECT_CAPABILITIES,
  THEME_EFFECT_DIRECTIONS,
  THEME_EFFECT_PALETTE_ROLES,
  type ThemeAmbientEffect,
  type ThemeEffectColorRole,
  type ThemeEffectDirection,
} from '@/theme/schema';

export interface DevHomeAmbientControlsProps {
  value: ThemeAmbientEffect | 'theme';
  onChange: (value: ThemeAmbientEffect | 'theme') => void;
  intensity: number;
  onIntensityChange: (value: number) => void;
  speed: number;
  onSpeedChange: (value: number) => void;
  density: number;
  onDensityChange: (value: number) => void;
  size: number;
  onSizeChange: (value: number) => void;
  palette?: ThemeEffectColorRole[];
  onPaletteChange: (value: ThemeEffectColorRole[] | undefined) => void;
  direction?: ThemeEffectDirection;
  onDirectionChange: (value: ThemeEffectDirection | undefined) => void;
}

/** Local development inspector: intentionally does not persist theme preferences. */
export function DevHomeAmbientControls(props: DevHomeAmbientControlsProps) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const capabilities = THEME_EFFECT_CAPABILITIES[props.value === 'theme' ? 'none' : props.value];
  if (!__DEV__) return null;
  const buttonStyle = {
    borderRadius: profile.chrome.control,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  };
  const textStyle = { color: theme.colors.text };
  return (
    <View pointerEvents="box-none" style={[styles.overlay, { bottom: insets.bottom + 8 }]}>
      {expanded && (
        <ScrollView
          style={[styles.panel, buttonStyle, { maxHeight: height * 0.58 }]}
          contentContainerStyle={styles.panelContent}>
          <Text style={[styles.title, textStyle]}>{t`Home effects · development only`}</Text>
          <View style={styles.choices}>
            {(['theme', ...THEME_AMBIENT_EFFECTS] as const).map((effect) => (
              <Pressable
                key={effect}
                accessibilityRole="button"
                accessibilityState={{ selected: props.value === effect }}
                onPress={() => props.onChange(effect)}
                style={[
                  styles.button,
                  buttonStyle,
                  props.value === effect && { borderColor: theme.colors.primary, borderWidth: 2 },
                ]}>
                <Text style={textStyle}>{effect === 'theme' ? t`Theme default` : effect}</Text>
              </Pressable>
            ))}
          </View>
          {(
            [
              {
                shown: props.value !== 'none' && props.value !== 'theme',
                minimum: 0,
                label: t`Intensity`,
                value: props.intensity,
                maximum: 1,
                change: props.onIntensityChange,
              },
              {
                shown: capabilities.speed,
                minimum: 0,
                label: t`Speed`,
                value: props.speed,
                maximum: 2,
                change: props.onSpeedChange,
              },
              {
                shown: capabilities.density,
                minimum: 0,
                label: t`Density`,
                value: props.density,
                maximum: 1,
                change: props.onDensityChange,
              },
              {
                shown: capabilities.size,
                minimum: 0.5,
                label: t`Size`,
                value: props.size,
                maximum: 2,
                change: props.onSizeChange,
              },
            ] as const
          )
            .filter(({ shown }) => shown)
            .map(({ label, value, minimum, maximum, change }) => (
              <View key={label} style={styles.row}>
                <Text style={[styles.readout, textStyle]}>
                  {label}: {value.toFixed(1)}
                </Text>
                {([-1, 1] as const).map((direction) => (
                  <Pressable
                    key={direction}
                    accessibilityRole="button"
                    accessibilityLabel={direction < 0 ? t`Decrease ${label}` : t`Increase ${label}`}
                    onPress={() =>
                      change(
                        Math.max(
                          minimum,
                          Math.min(maximum, Math.round((value + direction * 0.1) * 10) / 10)
                        )
                      )
                    }
                    style={[styles.button, buttonStyle]}>
                    <Text style={textStyle}>{direction < 0 ? '−' : '+'}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          {capabilities.direction && (
            <View style={styles.choices}>
              <Text style={textStyle}>{t`Direction`}</Text>
              {([undefined, ...THEME_EFFECT_DIRECTIONS] as const).map((direction) => (
                <Pressable
                  key={direction ?? 'auto'}
                  accessibilityRole="button"
                  accessibilityState={{ selected: direction === props.direction }}
                  onPress={() => props.onDirectionChange(direction)}
                  style={[
                    styles.button,
                    buttonStyle,
                    direction === props.direction && { borderColor: theme.colors.primary },
                  ]}>
                  <Text style={textStyle}>{direction ?? t`Automatic`}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {capabilities.palette && (
            <View style={styles.choices}>
              <Text style={textStyle}>{t`Palette (up to 4)`}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => props.onPaletteChange(undefined)}
                style={[styles.button, buttonStyle]}>
                <Text style={textStyle}>{t`Automatic`}</Text>
              </Pressable>
              {THEME_EFFECT_PALETTE_ROLES.map((role) => (
                <Pressable
                  key={role}
                  accessibilityRole="button"
                  accessibilityState={{ selected: props.palette?.includes(role) ?? false }}
                  onPress={() => {
                    const selected = props.palette ?? [];
                    const next = selected.includes(role)
                      ? selected.filter((value) => value !== role)
                      : selected.length < 4
                        ? [...selected, role]
                        : selected;
                    props.onPaletteChange(next.length ? next : undefined);
                  }}
                  style={[
                    styles.button,
                    buttonStyle,
                    props.palette?.includes(role) && {
                      borderColor: theme.colors.primary,
                      borderWidth: 2,
                    },
                  ]}>
                  <Text style={{ color: theme.colors[role] }}>{role}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text
            style={textStyle}>{t`0 speed pauses motion. Theme default restores the theme.`}</Text>
        </ScrollView>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={[styles.toggle, buttonStyle]}>
        <Text style={textStyle}>{expanded ? t`Close effects` : t`Effects · ${props.value}`}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', right: 12, left: 12, zIndex: 1000, alignItems: 'flex-end' },
  panel: { width: '100%', maxWidth: 420, borderWidth: 1, marginBottom: 8 },
  panelContent: { padding: 12, gap: 10 },
  title: { fontWeight: '600' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  readout: { flex: 1 },
  button: {
    minHeight: 40,
    minWidth: 40,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1 },
});
