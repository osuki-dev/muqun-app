import { Canvas, Circle, Line, vec } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
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

import type { ThemeAmbientEffect } from '@/theme/schema';

export interface SkiaAmbientEffectProps {
  effect?: ThemeAmbientEffect;
  intensity?: number;
  speed?: number;
  mode: 'light' | 'dark';
}

// Fixed deterministic seeds for particles and rain streaks so they don't jump on re-renders
const RAIN_STREAKS = Array.from({ length: 32 }, (_, i) => ({
  xNorm: ((i * 137.5) % 100) / 100,
  yNorm: ((i * 73.1) % 100) / 100,
  len: 18 + (i % 5) * 8,
  speedMult: 0.8 + (i % 4) * 0.2,
  opacityMult: 0.3 + (i % 3) * 0.25,
}));

const SAKURA_PARTICLES = Array.from({ length: 24 }, (_, i) => ({
  xNorm: ((i * 193.3) % 100) / 100,
  yNorm: ((i * 89.7) % 100) / 100,
  size: 3 + (i % 4) * 1.5,
  drift: ((i % 5) - 2) * 15,
  speedMult: 0.6 + (i % 3) * 0.3,
  phase: (i * 0.5) % Math.PI,
}));

export function SkiaAmbientEffect({
  effect = 'none',
  intensity = 0.5,
  speed = 1,
  mode,
}: SkiaAmbientEffectProps) {
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (effect === 'none' || reducedMotion) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    const duration = Math.max(1000, 6000 / Math.max(0.2, speed));
    progress.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(progress);
    };
  }, [effect, speed, reducedMotion, progress]);

  if (effect === 'none') return null;

  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}>
      {effect === 'rain' ? (
        <RainCanvas
          progress={progress}
          width={width}
          height={height}
          intensity={intensity}
          mode={mode}
        />
      ) : effect === 'particles' ? (
        <ParticlesCanvas
          progress={progress}
          width={width}
          height={height}
          intensity={intensity}
          mode={mode}
        />
      ) : effect === 'scanlines' ? (
        <ScanlinesCanvas width={width} height={height} intensity={intensity} mode={mode} />
      ) : effect === 'bloom' ? (
        <BloomCanvas
          progress={progress}
          width={width}
          height={height}
          intensity={intensity}
          mode={mode}
        />
      ) : null}
    </View>
  );
}

function RainCanvas({
  progress,
  width,
  height,
  intensity,
  mode,
}: {
  progress: SharedValue<number>;
  width: number;
  height: number;
  intensity: number;
  mode: 'light' | 'dark';
}) {
  const rainColor =
    mode === 'dark'
      ? `rgba(180, 220, 255, ${0.45 * intensity})`
      : `rgba(90, 140, 190, ${0.35 * intensity})`;

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {RAIN_STREAKS.map((streak, idx) => (
        <RainStreak
          key={idx}
          streak={streak}
          progress={progress}
          width={width}
          height={height}
          color={rainColor}
        />
      ))}
    </Canvas>
  );
}

function RainStreak({
  streak,
  progress,
  width,
  height,
  color,
}: {
  streak: (typeof RAIN_STREAKS)[number];
  progress: SharedValue<number>;
  width: number;
  height: number;
  color: string;
}) {
  const p1 = useDerivedValue(() => {
    const y = ((streak.yNorm + progress.value * streak.speedMult) % 1) * height;
    const x = ((streak.xNorm + progress.value * streak.speedMult * 0.15) % 1) * width;
    return vec(x, y);
  });

  const p2 = useDerivedValue(() => {
    return vec(p1.value.x + streak.len * 0.3, p1.value.y + streak.len);
  });

  return <Line p1={p1} p2={p2} color={color} strokeWidth={1.5} />;
}

function ParticlesCanvas({
  progress,
  width,
  height,
  intensity,
  mode,
}: {
  progress: SharedValue<number>;
  width: number;
  height: number;
  intensity: number;
  mode: 'light' | 'dark';
}) {
  const particleColor =
    mode === 'dark'
      ? `rgba(255, 170, 205, ${0.6 * intensity})`
      : `rgba(235, 120, 170, ${0.45 * intensity})`;

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {SAKURA_PARTICLES.map((particle, idx) => (
        <ParticleCircle
          key={idx}
          particle={particle}
          progress={progress}
          width={width}
          height={height}
          color={particleColor}
        />
      ))}
    </Canvas>
  );
}

function ParticleCircle({
  particle,
  progress,
  width,
  height,
  color,
}: {
  particle: (typeof SAKURA_PARTICLES)[number];
  progress: SharedValue<number>;
  width: number;
  height: number;
  color: string;
}) {
  const center = useDerivedValue(() => {
    const y = ((particle.yNorm + progress.value * particle.speedMult) % 1) * height;
    const sway = Math.sin(progress.value * Math.PI * 2 + particle.phase) * particle.drift;
    const x = ((particle.xNorm + sway / width) % 1) * width;
    return vec(x, y);
  });

  return <Circle c={center} r={particle.size} color={color} />;
}

function ScanlinesCanvas({
  width,
  height,
  intensity,
  mode,
}: {
  width: number;
  height: number;
  intensity: number;
  mode: 'light' | 'dark';
}) {
  const lineGap = 4;
  const count = Math.ceil(height / lineGap);
  const color =
    mode === 'dark'
      ? `rgba(0, 240, 255, ${0.035 * intensity})`
      : `rgba(0, 0, 0, ${0.04 * intensity})`;

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {Array.from({ length: Math.min(count, 120) }, (_, i) => {
        const y = i * (height / Math.min(count, 120));
        return <Line key={i} p1={vec(0, y)} p2={vec(width, y)} color={color} strokeWidth={1} />;
      })}
    </Canvas>
  );
}

function BloomCanvas({
  progress,
  width,
  height,
  intensity,
  mode,
}: {
  progress: SharedValue<number>;
  width: number;
  height: number;
  intensity: number;
  mode: 'light' | 'dark';
}) {
  const center = vec(width * 0.5, height * 0.6);
  const radius = useDerivedValue(() => {
    const pulse = 0.85 + 0.15 * Math.sin(progress.value * Math.PI * 2);
    return Math.min(width, height) * 0.6 * pulse;
  });

  const bloomColor =
    mode === 'dark'
      ? `rgba(80, 180, 255, ${0.12 * intensity})`
      : `rgba(255, 140, 60, ${0.08 * intensity})`;

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Circle c={center} r={radius} color={bloomColor} />
    </Canvas>
  );
}
