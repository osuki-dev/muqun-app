import { useThemeTokens } from '@osuki-dev/ui';
import { type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeFade } from '@/components/edge-fade';
import {
  NAV_HEADER_CONTROL_SIZE,
  navHeaderBarStyle,
  navHeaderRowStyle,
} from '@/components/nav-header';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import { sheetFrostAlpha } from '@/theme/surface-background';

/**
 * How far below the safe-area inset the floating header ends: the gap, the
 * control row and the bar's bottom padding. Content that scrolls under the
 * header starts its first row at `insets.top + DETAIL_HEADER_HEIGHT`.
 */
export const DETAIL_HEADER_HEIGHT =
  NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + navHeaderBarStyle.paddingBottom;

/**
 * The floating header over a detail screen -- the terminal's, and the agent
 * session's. A row of glass pills laid over content that scrolls underneath,
 * separated from it by the fade (iOS) or the sheets' frosted ground plus a
 * short ramp (Android), which also covers the status bar.
 *
 * One component so the two screens cannot drift: the agent session used to
 * draw a pushed-screen `ScreenHeader` with a solid backdrop, a second fade and
 * a deeper inset, and read as a different bar with a dead band under it.
 * The screen owns only what sits in the row.
 */
export function DetailHeader({
  fadeColor,
  children,
}: {
  /** What the content under the header fades into; the theme background by default. */
  fadeColor?: string;
  children: ReactNode;
}) {
  const theme = useThemeTokens();
  const surfaceOpacity = useSurfaceBackgroundOpacity();
  const color = fadeColor ?? theme.colors.background;
  return (
    <SafeAreaView
      edges={['top']}
      pointerEvents="box-none"
      style={[styles.overlay, navHeaderBarStyle]}>
      {/*
        Android navigation chrome draws no fill of its own (no live blur, and a
        filled pill read as a grey slab), so the fade was the only thing between
        the title and the transcript scrolling under it -- still ~30% clear
        across the pill row, which left the text beneath legible between and
        through the pills. There the bar gets the sheets' frosted ground -- the
        reader's opacity, never thinner than the legibility floor -- and the
        ramp starts below it.
      */}
      {Platform.OS === 'android' ? (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.ground,
              {
                backgroundColor: withAlpha(color, sheetFrostAlpha(surfaceOpacity)),
              },
            ]}
          />
          <EdgeFade edge="top" color={color} style={styles.groundFade} />
        </>
      ) : (
        <EdgeFade edge="top" color={color} style={styles.fade} />
      )}
      {/*
        Separate pills rather than one bar: the title is the only part that
        needs the full width, and a single bar makes the buttons read as part
        of the label rather than as controls.
      */}
      <View style={navHeaderRowStyle}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    zIndex: 20,
    elevation: 20,
    top: 0,
    left: 0,
    right: 0,
  },
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: -30,
  },
  ground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  groundFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -24,
    height: 24,
  },
});
