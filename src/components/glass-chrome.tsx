import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import { DURATION } from '@/lib/motion';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

type EnteringAnimation = ComponentProps<typeof Animated.View>['entering'];
type ExitingAnimation = ComponentProps<typeof Animated.View>['exiting'];

/**
 * Which kind of chrome this is, which is the whole of what varies between the
 * app's glass surfaces.
 *
 * `floating` is nav chrome laid over live content -- the server page's header
 * circles and title pill, the connection capsule, the composer dock. It has a
 * terminal moving underneath it, so it takes the thicker `regular` material and
 * a tint, and it falls back to a real blur.
 *
 * `sheet` is chrome sitting on a surface that is already opaque -- the refresh
 * and close buttons in the panels and Files sheets. `regular` over an opaque
 * background is just a grey disc, so it takes `clear`, which reads as a lens
 * over the sheet rather than as a second material on top of it, and it falls
 * back to the flat raised fill those buttons have always had.
 */
export type GlassFace = 'floating' | 'sheet';

/**
 * Whether this build draws real Liquid Glass.
 *
 * Both checks, in this order. `isLiquidGlassAvailable` is the OS question -- is
 * this app running under the Liquid Glass design at all -- and
 * `isGlassEffectAPIAvailable` is the narrower runtime one, added because some
 * iOS 26 betas ship the design without the API and crash when it is called.
 * Every other platform answers `false` from the non-iOS stubs, so the fallbacks
 * below are what Android and iOS 25 have always rendered.
 */
export function isGlassChromeLive(): boolean {
  return Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
}

type GlassChromeProps = {
  children: ReactNode;
  /** @default 'floating' */
  face?: GlassFace;
  /**
   * The face's own shape -- size, radius, padding, shadow. The material is this
   * component's business; where the surface is and how big it is stays with the
   * screen that places it, so no caller repeats a fill or a blur.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * How the surface arrives and leaves, for a face that is mounted and
   * unmounted rather than always there.
   *
   * These reach the fallback views unchanged, so Android and iOS 25 keep the
   * exact fade they had. Under Liquid Glass they are deliberately *not*
   * applied: a Reanimated fade animates opacity, and opacity 0 on a GlassView
   * or on anything above it switches the effect off outright -- the surface
   * comes back as a plain transparent rectangle. The material animates itself
   * instead, from `none` to the face's style, which is what
   * `glassEffectStyle.animate` is for.
   */
  entering?: EnteringAnimation;
  exiting?: ExitingAnimation;
};

/**
 * The app's one piece of glass.
 *
 * Every floating pill, circle and dock in Muqun is this component with a
 * different shape passed in: real Liquid Glass on iOS 26, a blur on iOS 25, and
 * a solid translucent fill on Android where neither is cheap. One
 * implementation so that nav chrome is one material everywhere, and so that the
 * fallback -- which is what most devices see -- cannot drift face by face.
 */
export function GlassChrome({
  children,
  face = 'floating',
  style,
  entering,
  exiting,
}: GlassChromeProps) {
  const { resolvedMode } = useThemeMode();
  const theme = useThemeTokens();
  const dark = resolvedMode === 'dark';

  // Second render, not first: the material has to have been laid down as `none`
  // before `animate` has two states to move between. A face with no entering
  // animation starts settled and never animates at all.
  const [settled, setSettled] = useState(entering === undefined);
  useEffect(() => {
    if (!settled) setSettled(true);
  }, [settled]);

  if (isGlassChromeLive()) {
    return (
      <GlassView
        colorScheme={dark ? 'dark' : 'light'}
        glassEffectStyle={{
          style: settled ? (face === 'sheet' ? 'clear' : 'regular') : 'none',
          animate: true,
          animationDuration: DURATION.micro / 1000,
        }}
        tintColor={
          face === 'sheet'
            ? withAlpha(theme.colors.surfaceRaised, appChrome.opacity.glassSheetTint)
            : withAlpha(
                dark ? theme.colors.background : theme.colors.surface,
                dark
                  ? appChrome.opacity.glassFloatingTintDark
                  : appChrome.opacity.glassFloatingTintLight
              )
        }
        style={style}>
        {children}
      </GlassView>
    );
  }

  // Sheet chrome sits on an opaque sheet on every platform, so its fallback is
  // the raised fill rather than a blur of the surface it is already on.
  if (face === 'sheet') {
    return (
      <Animated.View
        entering={entering}
        exiting={exiting}
        style={[style, { backgroundColor: theme.colors.surfaceRaised }]}>
        {children}
      </Animated.View>
    );
  }

  if (Platform.OS === 'android') {
    return (
      <Animated.View
        entering={entering}
        exiting={exiting}
        style={[
          style,
          // Android has no cheap live blur here, so a nearly opaque raised
          // surface stands in for it. Derive the material from the active pack
          // rather than from mode-only literals: the Settings header, terminal
          // dock and connection capsule now inherit Ayu, Dracula, Solarized,
          // and every other pack while retaining a trace of the live content.
          {
            backgroundColor: withAlpha(
              theme.colors.surfaceRaised,
              appChrome.opacity.glassAndroidFill
            ),
          },
        ]}>
        {children}
      </Animated.View>
    );
  }

  return (
    <AnimatedBlurView
      entering={entering}
      exiting={exiting}
      intensity={78}
      tint={dark ? 'systemMaterialDark' : 'systemMaterialLight'}
      style={[
        style,
        {
          // `BlurView` supplies the legacy material but its system tint is
          // neutral. This low-opacity overlay carries the selected pack's hue
          // into iOS 25 instead of falling back to generic grey.
          backgroundColor: withAlpha(
            theme.colors.surfaceRaised,
            appChrome.opacity.glassLegacyOverlay
          ),
        },
      ]}>
      {children}
    </AnimatedBlurView>
  );
}
