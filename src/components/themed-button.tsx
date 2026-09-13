import { useMemo } from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  useWindowDimensions,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import {
  Button as BaseButton,
  useThemeTokens,
  useThemeMode,
  Text,
  useHaptics,
  Icon,
  Spinner,
  type ButtonProps,
} from '@osuki-dev/ui';
import { useThemeLibrary } from '@/stores/theme-library';
import { ThemeArtworkLayer } from '@/components/theme-artwork';
import { resolveThemeImage } from '@/theme/resolve';
import { safeArtworkOpacity } from '@/theme/artwork-contrast';
import { jointArtworkOpacity } from '@/theme/opacity-policy';
import { kitButtonPressMotion } from '@/lib/motion';
import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';

export type { ButtonProps, ButtonVariant } from '@osuki-dev/ui';

// Preserve @osuki-dev/ui 1.0.1's control behavior; only the in-control artwork
// plane is added. Unskinned controls delegate to the original Button unchanged.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    children,
    disabled = false,
    loading = false,
    loadingLabel,
    leftIcon,
    rightIcon,
    style,
    onPressIn,
    onPressOut,
    ...rest
  } = props;
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const backgroundOpacity = useSurfaceBackgroundOpacity();
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const active = useThemeLibrary((state) => state.active);
  const assets = useThemeLibrary(
    (state) =>
      state.library.themes.find((entry) => entry.id === state.active?.installationId)?.assets
  );
  const artwork =
    active && variant === 'primary'
      ? resolveThemeImage(
          active.manifest,
          'buttons.primary.background',
          resolvedMode,
          width >= 768 ? 'regular' : 'compact'
        )
      : null;
  const hasImage = Boolean(artwork && assets?.[artwork.asset]?.startsWith('file:///'));
  const haptics = useHaptics();
  const pressProgress = useSharedValue(0);
  const button = theme.components.Button;
  const variantTokens = button[variant];
  const isDisabled = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pressProgress.value }, { scale: 1 - pressProgress.value * 0.012 }],
  }));

  const buttonStyle = useMemo<ViewStyle>(() => {
    const backgroundToken = disabled ? 'surfaceRaised' : variantTokens.background;
    return {
      minHeight: button.height,
      paddingVertical: theme.spacing[button.paddingY],
      paddingHorizontal: theme.spacing[button.paddingX],
      borderRadius: theme.radius[button.radius],
      alignItems: 'center',
      justifyContent: 'center',
      opacity: loading ? 0.68 : 1,
      backgroundColor:
        backgroundToken === 'transparent' ? 'transparent' : theme.colors[backgroundToken],
      ...(!isDisabled && variantTokens.background !== 'transparent' && theme.mode === 'light'
        ? theme.shadow.pill
        : {}),
      ...(variantTokens.border && {
        borderWidth: 1,
        borderColor: theme.colors[variantTokens.border],
      }),
    };
  }, [
    button,
    disabled,
    isDisabled,
    loading,
    theme.colors,
    theme.mode,
    theme.radius,
    theme.shadow.pill,
    theme.spacing,
    variantTokens,
  ]);

  const textColor = disabled ? theme.colors.textDisabled : theme.colors[variantTokens.foreground];
  const iconColor = loading ? theme.colors.textDisabled : textColor;

  const actualBackground = style?.backgroundColor ?? buttonStyle.backgroundColor;
  const protectsTransparentLabel = Boolean(active && actualBackground === 'transparent');
  const baseColor = protectsTransparentLabel
    ? theme.colors.surfaceRaised
    : typeof actualBackground === 'string'
      ? actualBackground
      : '';
  const opacityLimit = useMemo(
    () =>
      disabled || loading
        ? 0
        : jointArtworkOpacity(
            safeArtworkOpacity(baseColor, [{ color: textColor, minimum: 4.5 }]),
            backgroundOpacity,
            artwork?.opacity ?? 1
          ),
    [disabled, loading, baseColor, textColor, artwork?.opacity, backgroundOpacity]
  );

  const handlePressIn: PressableProps['onPressIn'] = (event) => {
    if (!isDisabled) {
      haptics.feedback('light');
      pressProgress.value = kitButtonPressMotion(true);
    }
    onPressIn?.(event);
  };

  const handlePressOut: PressableProps['onPressOut'] = (event) => {
    pressProgress.value = kitButtonPressMotion(false);
    onPressOut?.(event);
  };

  if (!hasImage && backgroundOpacity === 1 && !protectsTransparentLabel)
    return <BaseButton {...props} />;
  return (
    <AnimatedPressable
      style={[
        buttonStyle,
        animatedStyle,
        style,
        typeof actualBackground === 'string' && { backgroundColor: background(baseColor) },
      ]}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}>
      {active && assets && opacityLimit > 0 ? (
        <View
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: style?.borderRadius ?? theme.radius[button.radius],
              borderCurve: style?.borderCurve,
              borderTopLeftRadius: style?.borderTopLeftRadius,
              borderTopRightRadius: style?.borderTopRightRadius,
              borderBottomLeftRadius: style?.borderBottomLeftRadius,
              borderBottomRightRadius: style?.borderBottomRightRadius,
              overflow: 'hidden',
            },
          ]}>
          <ThemeArtworkLayer
            manifest={active.manifest}
            assets={assets}
            slot="buttons.primary.background"
            mode={resolvedMode}
            opacityLimit={opacityLimit}
          />
        </View>
      ) : null}
      <View
        style={{
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
        }}>
        {loading ? (
          <Spinner
            size="sm"
            color={iconColor}
            testID={rest.testID ? `${rest.testID}-spinner` : undefined}
          />
        ) : leftIcon ? (
          <Icon name={leftIcon} size={17} color={iconColor} />
        ) : null}
        <Text
          variant="button"
          color={textColor}
          transform="uppercase"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          style={{ flexShrink: 1, minWidth: 0, textAlign: 'center' }}>
          {loading && loadingLabel ? loadingLabel : children}
        </Text>
        {!loading && rightIcon ? <Icon name={rightIcon} size={17} color={iconColor} /> : null}
      </View>
    </AnimatedPressable>
  );
}
