import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EdgeFade } from '@/components/edge-fade';
import Animated from 'react-native-reanimated';
import { useNavigationArrival } from '@/hooks/use-navigation-arrival';
import {
  NAV_HEADER_CONTROL_SIZE,
  NavHeaderBackButton,
  NavHeaderCircle,
  NavHeaderSpacer,
  NavHeaderTitlePill,
  navHeaderBarStyle,
  navHeaderRowStyle,
} from '@/components/nav-header';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';

/** How far past the pills the fade reaches before it is fully transparent. */
const FADE_HEIGHT = 96;

/**
 * The nav header for pushed screens (Settings, etc.).
 *
 * The row and the pieces in it come from `nav-header`, which is the same module
 * the server page's detail header renders, so the two bars are one bar by
 * construction rather than by two files agreeing. This screen owns only where
 * the bar sits and how it separates from the scroll passing behind it.
 *
 * A new screen just renders `<ScreenHeader title="..." />`.
 */
export function ScreenHeader({
  title,
  titlePill,
  onBack,
  backTestID,
  right,
  rightPill,
}: {
  title?: string;
  titlePill?: ReactNode;
  /** Defaults to router back, falling back to Home when there's nothing to pop. */
  onBack?: () => void;
  backTestID?: string;
  right?: ReactNode;
  rightPill?: ReactNode;
}) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();

  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const arrivalStyle = useNavigationArrival();

  const handleBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));

  return (
    <View style={[navHeaderBarStyle, { paddingTop: insets.top + NAV_HEADER_TOP_GAP }]}>
      {/* Keep labels scrolling behind the controls from showing through their
          translucent material. The solid themed plane covers the status bar
          and control row; the soft edge begins below the controls. */}
      <View
        pointerEvents="none"
        style={[
          styles.backdrop,
          {
            top: -insets.top,
            height: insets.top * 2 + NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 8,
            backgroundColor: theme.colors.background,
          },
        ]}
      />
      <EdgeFade
        edge="top"
        color={theme.colors.background}
        style={[
          styles.fade,
          {
            top: insets.top + NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 8,
            height: FADE_HEIGHT,
          },
        ]}
      />
      <Animated.View style={[navHeaderRowStyle, arrivalStyle]}>
        <NavHeaderBackButton
          accessibilityLabel={t`Go back`}
          onPress={handleBack}
          testID={backTestID}
        />

        {titlePill ? titlePill : <NavHeaderTitlePill title={title ?? ''} />}

        {rightPill ? (
          rightPill
        ) : right ? (
          <NavHeaderCircle>{right}</NavHeaderCircle>
        ) : (
          <NavHeaderSpacer />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
