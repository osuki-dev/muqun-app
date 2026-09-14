import { Input } from '@/components/themed-input';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Check, FolderOpen } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { PressableScale } from '@/components/pressable-scale';
import { LADDER } from '@/components/settings-chrome';
import { listLayout, riseIn, STAGGER } from '@/lib/motion';
import type { ComponentProps } from 'react';

/** The same recent directories and manual fallback in both task entry modes. */
export function ProjectDirectoryPicker({
  recentDirectories,
  value,
  onChange,
  disabled,
  ...inputProps
}: {
  recentDirectories: readonly string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
} & Omit<ComponentProps<typeof Input>, 'value' | 'onChangeText' | 'onChange'>) {
  return (
    <View style={{ gap: LADDER.gap }}>
      {recentDirectories.length ? (
        <View style={styles.recentList}>
          {recentDirectories.slice(0, 5).map((path, index) => (
            <Animated.View
              key={path}
              entering={riseIn(index * STAGGER.row)}
              layout={listLayout('short')}>
              <RecentCwdRow
                path={path}
                selected={path === value.trim()}
                onSelect={() => onChange(path)}
                disabled={disabled}
              />
            </Animated.View>
          ))}
        </View>
      ) : null}
      <Input
        autoCapitalize="none"
        autoCorrect={false}
        {...inputProps}
        value={value}
        onChangeText={onChange}
        editable={!disabled && inputProps.editable !== false}
      />
    </View>
  );
}

/** One directory this session has worked in lately. */
function RecentCwdRow({
  path,
  selected,
  onSelect,
  disabled,
}: {
  path: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={path}
      onPress={onSelect}
      disabled={disabled}
      style={[
        styles.recentRow,
        { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
      ]}>
      <FolderOpen
        size={16}
        color={selected ? theme.colors.primary : theme.colors.textMuted}
        strokeWidth={2}
      />
      {/* The head is what gets dropped, so the end of the path always survives.
          Two checkouts under the same parent differ in their last segment, and
          `~/code/mu…` distinguishes nothing at all. */}
      <Text
        variant="bodySmall"
        numberOfLines={1}
        ellipsizeMode="head"
        style={styles.recentPath}
        color={selected ? theme.colors.primary : theme.colors.text}>
        {path}
      </Text>
      {selected ? <Check size={16} color={theme.colors.primary} strokeWidth={2.5} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  recentList: { gap: 6 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.gap,
    minHeight: 48,
    paddingHorizontal: LADDER.snug,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  recentPath: { flex: 1, minWidth: 0, includeFontPadding: false },
});
