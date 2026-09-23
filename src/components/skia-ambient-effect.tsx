import { useThemeTokens } from '@osuki-dev/ui';
import { Canvas, Circle, Line, Oval, vec } from '@shopify/react-native-skia';
import { NavigationContext } from 'expo-router/react-navigation';
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { AmbientCircuitLines } from '@/components/ambient-circuit-lines';
import { useAppActive } from '@/hooks/use-app-active';
import {
  THEME_EFFECT_CAPABILITIES,
  type ThemeEffectPaletteRole,
  type ThemeEffectDirection,
  type ThemeAmbientEffect,
} from '@/theme/schema';
import { withAlpha } from '@/lib/color';
import {
  AMBIENT_MOTES,
  ambientMoteFrame,
  directionalAmbientFrame,
  ambientDirectionVector,
  ambientParticleCount,
} from '@/lib/ambient-motion';

export interface SkiaAmbientEffectProps {
  effect?: ThemeAmbientEffect;
  intensity?: number;
  speed?: number;
  density?: number;
  size?: number;
  palette?: ThemeEffectPaletteRole[];
  direction?: ThemeEffectDirection;
  mode: 'light' | 'dark';
  colors?: {
    primary: string;
    text: string;
    textMuted: string;
    warning: string;
    info: string;
    success: string;
  };
}

const RAIN_SEEDS = Array.from({ length: 32 }, (_, index) => ({
  ...AMBIENT_MOTES[index % 16]!,
  x: ((index * 137.5) % 100) / 100,
  offset: ((index * 73.1) % 100) / 100,
}));

export function SkiaAmbientEffect({
  effect = 'none',
  intensity = 0.5,
  speed = 1,
  mode,
  colors,
  density = 1,
  size = 1,
  palette: paletteRoles,
  direction,
}: SkiaAmbientEffectProps) {
  const theme = useThemeTokens();
  const palette = colors ?? theme.colors;
  const effectColor =
    effect === 'rain' || effect === 'dust'
      ? palette.textMuted
      : effect === 'particles' || effect === 'bloom'
        ? palette.primary
        : effect === 'embers'
          ? palette.warning
          : palette.text;
  const colorList = paletteRoles?.length
    ? paletteRoles.map((role) => palette[role])
    : [effectColor];
  const hidden = intensity <= 0 || (THEME_EFFECT_CAPABILITIES[effect].density && density <= 0);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const appActive = useAppActive();
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback(
    (notify: () => void) => {
      const focus = navigation?.addListener('focus', notify);
      const blur = navigation?.addListener('blur', notify);
      return () => {
        focus?.();
        blur?.();
      };
    },
    [navigation]
  );
  const getFocused = useCallback(() => navigation?.isFocused() ?? true, [navigation]);
  const focused = useSyncExternalStore(subscribe, getFocused, getFocused);
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (
      effect === 'none' ||
      effect === 'scanlines' ||
      reducedMotion ||
      !appActive ||
      !focused ||
      hidden ||
      speed <= 0 ||
      width <= 0 ||
      height <= 0
    ) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    const period =
      effect === 'dust'
        ? 18000
        : effect === 'embers'
          ? 12000
          : effect === 'snow'
            ? 16000
            : effect === 'stars'
              ? 8000
              : 6000;
    const duration = period / speed;
    progress.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(progress);
    };
  }, [effect, speed, hidden, reducedMotion, appActive, focused, width, height, progress]);

  if (effect === 'none' || hidden) return null;

  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onLayout={({ nativeEvent: { layout } }) =>
        setSize((previous) =>
          previous.width === layout.width && previous.height === layout.height
            ? previous
            : { width: layout.width, height: layout.height }
        )
      }
      style={StyleSheet.absoluteFill}>
      {width <= 0 || height <= 0 ? null : effect === 'scanlines' ? (
        <AmbientCircuitLines
          width={width}
          height={height}
          intensity={intensity}
          colors={palette}
          density={density}
          size={size}
          palette={paletteRoles}
        />
      ) : effect === 'bloom' ? (
        <BloomCanvas
          colors={colorList}
          progress={progress}
          width={width}
          height={height}
          intensity={intensity}
          mode={mode}
          size={size}
        />
      ) : (
        <Canvas style={StyleSheet.absoluteFill}>
          {(effect === 'rain' ? RAIN_SEEDS : AMBIENT_MOTES)
            .slice(0, ambientParticleCount(effect, density))
            .map((seed, index) => (
              <AmbientParticle
                key={index}
                seed={seed}
                index={index}
                effect={effect}
                progress={progress}
                width={width}
                height={height}
                intensity={intensity}
                mode={mode}
                color={colorList[index % colorList.length]!}
                size={size}
                direction={direction}
              />
            ))}
        </Canvas>
      )}
    </View>
  );
}

function AmbientParticle({
  seed,
  index,
  effect,
  progress,
  width,
  height,
  intensity,
  mode,
  color,
  size,
  direction,
}: {
  seed: (typeof AMBIENT_MOTES)[number];
  index: number;
  effect: Exclude<ThemeAmbientEffect, 'none' | 'scanlines' | 'bloom'>;
  progress: SharedValue<number>;
  width: number;
  height: number;
  intensity: number;
  mode: 'light' | 'dark';
  color: string;
  size: number;
  direction?: ThemeEffectDirection;
}) {
  const resolvedDirection =
    direction ??
    (effect === 'rain'
      ? 'down-right'
      : effect === 'snow' || effect === 'particles'
        ? 'down'
        : 'up');
  const frame = useDerivedValue(() =>
    effect === 'stars'
      ? ambientMoteFrame(progress.value, seed, width, height, 'stars')
      : directionalAmbientFrame(
          progress.value * (effect === 'rain' ? 1 + (index % 2) : 1),
          seed,
          width,
          height,
          resolvedDirection,
          effect === 'rain' ? 0 : seed.drift
        )
  );
  const center = useDerivedValue(() => vec(frame.value.x, frame.value.y));
  const end = useDerivedValue(() => {
    const vector = ambientDirectionVector(resolvedDirection);
    const length = (18 + (index % 5) * 8) * size;
    return vec(
      frame.value.x + vector.x * length * (vector.y === 0 ? 1 : 0.3),
      frame.value.y + vector.y * length
    );
  });
  const opacity = useDerivedValue(
    () =>
      frame.value.opacity * intensity * (effect === 'rain' ? (mode === 'dark' ? 0.45 : 0.35) : 0.7)
  );
  const oval = useDerivedValue(() => ({
    x: frame.value.x,
    y: frame.value.y,
    width: (3 + (index % 4) * 1.5) * 1.4 * size,
    height: (3 + (index % 4) * 1.5) * 0.65 * size,
  }));
  if (effect === 'rain')
    return <Line p1={center} p2={end} color={color} opacity={opacity} strokeWidth={1.5 * size} />;
  if (effect === 'particles') return <Oval rect={oval} color={color} opacity={opacity} />;
  const radius =
    effect === 'snow'
      ? 1.2 + ((seed.radius - 0.8) / 0.9) * 1.4
      : effect === 'stars'
        ? 1 + (seed.radius - 0.8) / 0.9
        : seed.radius;
  return <Circle c={center} r={radius * size} opacity={opacity} color={color} />;
}

function BloomCanvas({
  progress,
  width,
  height,
  intensity,
  mode,
  colors,
  size,
}: {
  progress: SharedValue<number>;
  width: number;
  height: number;
  intensity: number;
  mode: 'light' | 'dark';
  colors: string[];
  size: number;
}) {
  const radius = useDerivedValue(
    () =>
      Math.min(width, height) *
      Math.min(0.9, 0.6 * size) *
      (0.85 + 0.15 * Math.sin(progress.value * Math.PI * 2))
  );
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {colors.map((color, index) => (
        <Circle
          key={index}
          c={vec(width * (0.5 + (index - (colors.length - 1) / 2) * 0.12), height * 0.6)}
          r={radius}
          color={withAlpha(color, ((mode === 'dark' ? 0.12 : 0.08) * intensity) / colors.length)}
        />
      ))}
    </Canvas>
  );
}
