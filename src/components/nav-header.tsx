import { Text, useThemeTokens } from '@osuki-dev/ui';
import { ChevronLeft } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';

/**
 * The size of every control in a nav header, and the width an empty right slot
 * reserves so a header without an action still centres its title.
 *
 * Exported because the Settings page has to take the header's height out of the
 * top of its scroll, and a literal there would be another copy of this number.
 */
export const NAV_HEADER_CONTROL_SIZE = 46;

/**
 * The app's one nav bar: a glass back circle, a glass title pill, and whatever
 * the screen puts on the right.
 *
 * This module exists because the two headers that render it -- `ScreenHeader`
 * for pushed screens and the detail header inside `AppDrawer` for the server
 * page -- were two copies of the same numbers, and a copy is a thing that
 * drifts. It did: the pushed-screen copy grew `shadow.popover` on its circle
 * and on its pill, and under a pill that is nearly the width of the screen a
 * 30-blur shadow offset 10 down does not read as depth. It reads as a second
 * rounded surface behind the bar -- stopping where the pill stops rather than
 * at the screen edge, with its bottom edge showing below the pill. That is what
 * card #834 was filed about.
 *
 * There is no shadow here now. Both headers float over content that scrolls
 * underneath them, and both already carry an `EdgeFade`; the fade is what
 * separates the bar from what is passing behind it, and a drop shadow over the
 * top of it is the same statement made twice. `shadow.popover` stays where it
 * belongs, on the two menus that really do sit above the page.
 *
 * What is shared is the row and the pieces in it, not the placement: one header
 * is absolutely positioned over a scroll, the other is a `SafeAreaView` over the
 * terminal, and they fade different colours. Anything a screen genuinely has to
 * decide -- how wide the title may grow, what sits on the right -- is composed
 * on top of these styles rather than being an option inside them.
 */
const styles = StyleSheet.create({
  /** The frame around the row: the gutter, and the gap below the safe area. */
  bar: {
    paddingHorizontal: 12,
    // Added to the safe-area inset, never instead of it: the inset says where
    // drawing may start, and the controls sit below that rather than on it.
    paddingTop: NAV_HEADER_TOP_GAP,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Inert while the title pill is free to fill the row, and load-bearing for
    // a screen that caps its measure: the controls stay a group in the middle
    // rather than the title's spare width piling up on one side.
    justifyContent: 'center',
    gap: 8,
    // Above the fade, which is painted first and fills the whole frame.
    zIndex: 1,
  },
  circle: {
    width: NAV_HEADER_CONTROL_SIZE,
    height: NAV_HEADER_CONTROL_SIZE,
    borderRadius: appChrome.radius.navigationPill,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleButton: {
    width: NAV_HEADER_CONTROL_SIZE,
    height: NAV_HEADER_CONTROL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titlePill: {
    flex: 1,
    minWidth: 0,
    minHeight: NAV_HEADER_CONTROL_SIZE,
    borderRadius: appChrome.radius.navigationPill,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  titleText: {
    width: '100%',
    textAlign: 'center',
    fontWeight: '600',
  },
});

export const navHeaderBarStyle = styles.bar;
export const navHeaderRowStyle = styles.row;
export const navHeaderButtonStyle = styles.circleButton;
export const navHeaderTitlePillStyle = styles.titlePill;
export const navHeaderTitleTextStyle = styles.titleText;

/** A glass circle sized to the row. The screen owns what goes inside it. */
export function NavHeaderCircle({ children }: { children: ReactNode }) {
  return <GlassChrome style={styles.circle}>{children}</GlassChrome>;
}

/**
 * The width a control takes, held open with nothing in it.
 *
 * A header with no right-hand action reserves the slot rather than dropping it.
 * The title pill fills what is left between whatever sits on either side of it,
 * so removing the slot widens the pill by the control and the gap and slides
 * its centred text 27pt to the right -- off the axis the server page's title
 * sits on, which is the one thing this bar is supposed to share.
 */
export function NavHeaderSpacer() {
  return <View style={styles.circle} />;
}

export function NavHeaderBackButton({
  accessibilityLabel,
  onPress,
}: {
  /**
   * Named per screen: it is what a screen reader announces and, for Settings,
   * what `maestro/flows/settings.yaml` taps.
   */
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const theme = useThemeTokens();
  return (
    <NavHeaderCircle>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={styles.circleButton}>
        <ChevronLeft size={21} color={theme.colors.text} strokeWidth={2} />
      </PressableScale>
    </NavHeaderCircle>
  );
}

/**
 * The glass pill carrying the screen's name.
 *
 * `style` is the screen's chance to constrain the measure; the shape, the
 * material and the type stay here.
 */
export function NavHeaderTitlePill({
  title,
  style,
}: {
  title: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useThemeTokens();
  return (
    <GlassChrome style={[styles.titlePill, style]}>
      <Text
        variant="bodySmall"
        numberOfLines={1}
        color={theme.colors.text}
        style={styles.titleText}>
        {title}
      </Text>
    </GlassChrome>
  );
}
