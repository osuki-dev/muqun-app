/**
 * The theme picker, on the surface it always wanted.
 *
 * A theme pack is a *pair* --
 * Latte and Mocha, Dawn and Main, Day and Moon -- and the mode control two rows
 * above it decides which one the app is wearing. Both halves stay visible in
 * every card, so a reader picking in the dark can still see the morning half.
 *
 * Thirty-two choices would turn comparison into scrolling. The sheet therefore uses
 * a measured grid: two columns on a normal phone, three on a compact Pad sheet,
 * four when the Pad canvas is wide enough, and one only in a narrow split view.
 * Each card keeps its two variants on one row, so a full Pad grid remains
 * compact enough to compare without turning the sheet into a long scroll.
 *
 * Each variant is reduced to its canvas and three colour dots -- accent, link,
 * warning -- so narrow grid cells never turn variant names into ellipses. The
 * hues are far enough apart to tell two packs apart at a glance, and they come from
 * `themeSwatch` so a preview can never drift from the theme it advertises.
 *
 * The tile surface groups each name with its pair instead of leaving labels and
 * swatches floating on the sheet. Selection is a borderless primary-subtle
 * wash, cross-faded on `micro`; it keeps the grid calm and makes the chosen
 * pack clear without adding a heavy outline around four independent corners.
 */
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { LADDER } from '@/components/settings-chrome';
import { SettingsSheet } from '@/components/settings-sheet';
import { appChrome } from '@/constants/appearance';
import {
  THEME_PACKS,
  themeSwatch,
  type ThemePack,
  type ThemePackId,
} from '@/constants/theme-packs';
import { timing } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import {
  THEME_PICKER_GRID_GAP,
  THEME_PICKER_MAX_CONTENT_WIDTH,
  themePickerGridLayout,
} from '@/lib/theme-picker-layout';
import { useAppSettings } from '@/stores/app-settings';

export function SettingsThemeSheet({ onClose }: { onClose: () => void }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- see the
  // note at the top of the settings screen for why.
  const { t } = useLingui();
  useRenderTally('SettingsThemeSheet');
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const fallbackWidth = Math.min(
    THEME_PICKER_MAX_CONTENT_WIDTH - LADDER.gutter * 2,
    Math.max(0, windowWidth - LADDER.gutter * 2)
  );
  const gridLayout = themePickerGridLayout(measuredWidth || fallbackWidth);

  const themePack = useAppSettings((state) => state.themePack);
  const update = useAppSettings((state) => state.update);

  /**
   * Apply, then leave.
   *
   * The write goes in before the dismissal rather than after it, so the ring
   * has somewhere to travel to while the sheet is on its way out and the app
   * behind it is already repainted when it lands. Tapping the pack that is
   * already chosen writes nothing and still closes: in a sheet that is a
   * confirmation, not a no-op.
   */
  function choose(id: ThemePackId) {
    if (id !== themePack) void update({ themePack: id });
    onClose();
  }

  return (
    <SettingsSheet
      title={t`Theme`}
      caption={t`Terminal colours follow the theme.`}
      closeLabel={t`Close theme picker`}
      onClose={onClose}
      contentMaxWidth={THEME_PICKER_MAX_CONTENT_WIDTH}>
      <View
        accessibilityRole="radiogroup"
        testID="theme-picker-grid"
        onLayout={(event: LayoutChangeEvent) => setMeasuredWidth(event.nativeEvent.layout.width)}
        style={styles.list}>
        {THEME_PACKS.map((pack) => (
          <ThemePackTile
            key={pack.id}
            pack={pack}
            selected={pack.id === themePack}
            width={gridLayout.itemWidth}
            onSelect={() => choose(pack.id)}
          />
        ))}
      </View>
    </SettingsSheet>
  );
}

/**
 * One pack: its name, and both halves of it.
 *
 * `accessibilityLabel` is the pack's own name and nothing else. That label is
 * what the e2e flow taps and what its `selected` assertion reads, and it is also
 * the only thing a screen reader needs: the two swatches are decoration.
 */
function ThemePackTile({
  pack,
  selected,
  width,
  onSelect,
}: {
  pack: ThemePack;
  selected: boolean;
  width: number;
  onSelect: () => void;
}) {
  const theme = useThemeTokens();
  useRenderTally('ThemePackTile');
  const on = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, timing('micro'));
  }, [on, selected]);

  const selectedStyle = useAnimatedStyle(() => ({ opacity: on.value }));

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={pack.label}
      testID={`theme-${pack.id}`}
      onPress={onSelect}
      style={[styles.tile, { width, backgroundColor: theme.colors.surfaceRaised }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.selectedFill,
          { backgroundColor: theme.colors.primarySubtle },
          selectedStyle,
        ]}
      />
      <Text
        variant="bodySmall"
        color={selected ? theme.colors.primary : theme.colors.text}
        numberOfLines={1}
        style={styles.tileLabel}>
        {pack.label}
      </Text>
      <View style={styles.previews}>
        <ThemePreview pack={pack} mode="light" />
        <ThemePreview pack={pack} mode="dark" />
      </View>
    </PressableScale>
  );
}

/**
 * Half a pack, drawn in itself.
 *
 * Each preview is a fill-only window onto its theme. The selected pack gets the
 * one semantic outline in this grid; the preview surfaces themselves stay
 * borderless like the rest of the app.
 */
function ThemePreview({ pack, mode }: { pack: ThemePack; mode: 'light' | 'dark' }) {
  const swatch = themeSwatch(pack, mode);
  return (
    <View style={[styles.preview, { backgroundColor: swatch[0] }]}>
      <View style={styles.previewDots}>
        {swatch.slice(1).map((color, index) => (
          <View key={`${mode}-${index}`} style={[styles.previewDot, { backgroundColor: color }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: THEME_PICKER_GRID_GAP,
    rowGap: THEME_PICKER_GRID_GAP,
  },
  tile: {
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: LADDER.gap,
    gap: LADDER.gap,
  },
  selectedFill: {
    ...StyleSheet.absoluteFill,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  tileLabel: { lineHeight: 18, includeFontPadding: false },
  previews: { flexDirection: 'row', gap: LADDER.tight },
  preview: {
    flex: 1,
    minWidth: 0,
    height: 28,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: LADDER.gap,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewDots: { flexDirection: 'row', gap: LADDER.tight },
  previewDot: { width: 8, height: 8, borderRadius: 4 },
});
