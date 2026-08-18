import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EdgeFade } from '@/components/edge-fade';
import {
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
  onBack,
  right,
}: {
  title: string;
  /** Defaults to router back, falling back to Home when there's nothing to pop. */
  onBack?: () => void;
  right?: ReactNode;
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

  const handleBack =
    onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));

  return (
    <View style={[navHeaderBarStyle, { paddingTop: insets.top + NAV_HEADER_TOP_GAP }]}>
      {/* The fade starts above the safe area, not below it: the pills sit
          under the status bar, and a fade that began at their top left a strip
          of live content showing over the clock. `insets.top` is added back as
          negative offset and height so the gradient covers the whole thing,
          which is what makes the glass read as glass rather than as a shape
          with content sliding past it. */}
      <EdgeFade
        edge="top"
        color={theme.colors.background}
        style={[styles.fade, { top: -insets.top, height: insets.top + FADE_HEIGHT }]}
      />
      <View style={navHeaderRowStyle}>
        <NavHeaderBackButton accessibilityLabel={t`Go back`} onPress={handleBack} />

        <NavHeaderTitlePill title={title} />

        {right ? <NavHeaderCircle>{right}</NavHeaderCircle> : <NavHeaderSpacer />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
