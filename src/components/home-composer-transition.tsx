import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Canvas, Fill, Shader, Skia } from 'react-native-skia';
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';

import { useAppActive } from '@/hooks/use-app-active';
import { HOME_COMPOSER_TRANSITION_SKSL } from '@/lib/home-composer-transition-shader';
import { HOME_COMPOSER_TRANSITION_MS } from '@/lib/motion';
import { useAppSettings } from '@/stores/app-settings';

export type HomeComposerTransitionKind = 'options' | 'choice' | 'send';
export type HomeComposerPulse = { id: number; kind: HomeComposerTransitionKind };

function compileEffect() {
  try {
    return Skia.RuntimeEffect.Make(HOME_COMPOSER_TRANSITION_SKSL);
  } catch {
    return null;
  }
}
const effect = compileEffect();

function Flow({ kind, radius }: { kind: HomeComposerTransitionKind; radius: number }) {
  const theme = useThemeTokens();
  const size = useSharedValue({ width: 1, height: 1 });
  const progress = useSharedValue(0);
  const lastPaint = useSharedValue(-1000);
  const frame = useFrameCallback(({ timeSinceFirstFrame }) => {
    if (timeSinceFirstFrame - lastPaint.get() < 1000 / 30 || progress.get() >= 1) return;
    lastPaint.set(timeSinceFirstFrame);
    progress.set(Math.min(1, timeSinceFirstFrame / HOME_COMPOSER_TRANSITION_MS));
  }, false);
  useEffect(() => {
    frame.setActive(true);
    return () => frame.setActive(false);
  }, [frame]);
  const tint = Array.from(Skia.Color(theme.colors.primary));
  const phase = kind === 'options' ? 0 : kind === 'choice' ? 1 : 2;
  const uniforms = useDerivedValue(() => ({
    size: [size.get().width, size.get().height],
    radius,
    phase,
    progress: progress.get(),
    tint,
  }));
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) =>
        size.set({ width: layout.width, height: layout.height })
      }>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Fill>
          <Shader source={effect!} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

/** A one-shot decoration. Its lifetime never holds navigation or a network request. */
export function HomeComposerTransition({
  pulse,
  focused,
  radius,
}: {
  pulse: HomeComposerPulse | null;
  focused: boolean;
  radius: number;
}) {
  const theme = useThemeTokens();
  const active = useAppActive();
  const effectsEnabled = useAppSettings((state) => state.themeEffectsEnabled);
  const initialReduced = useReducedMotion();
  const [reduced, setReduced] = useState(initialReduced);
  const [finished, setFinished] = useState(0);
  useEffect(() => {
    let current = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (current) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!pulse) return;
    if (!focused || !active) {
      setFinished(pulse.id);
      return;
    }
    const timer = setTimeout(() => setFinished(pulse.id), HOME_COMPOSER_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [pulse, focused, active]);
  if (!pulse || pulse.id <= finished || !focused || !active) return null;
  return (
    <View
      testID="home-composer-transition"
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: radius }]}>
      {!reduced && effectsEnabled && effect ? (
        <Flow key={pulse.id} kind={pulse.kind} radius={radius} />
      ) : (
        <View
          style={[
            styles.quiet,
            { borderRadius: Math.max(0, radius - 3), borderColor: theme.colors.primary },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  quiet: { position: 'absolute', inset: 3, borderWidth: 1, opacity: 0.35 },
});
