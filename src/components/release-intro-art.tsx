import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Canvas, Fill, Shader, Skia, type SkRuntimeEffect } from 'react-native-skia';
import {
  cancelAnimation,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { GitFork, Layers3, Workflow } from 'lucide-react-native';
import { useAppActive } from '@/hooks/use-app-active';
import { timing } from '@/lib/motion';
import { RELEASE_INTRO_SKSL } from '@/lib/release-intro-shader';

/** Resolve accessibility before starting the decorative renderer, including live changes. */
function useDecorativeMotion() {
  const initialReduced = useReducedMotion();
  const [reduced, setReduced] = useState(initialReduced);
  const [screenReader, setScreenReader] = useState(true);
  useEffect(() => {
    let mounted = true;
    let readerChanged = false;
    let motionChanged = false;
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      readerChanged = true;
      setScreenReader(enabled);
    });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      motionChanged = true;
      setReduced(enabled);
    });
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (mounted && !readerChanged) setScreenReader(enabled);
      })
      .catch(() => {});
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted && !motionChanged) setReduced(enabled);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      reader.remove();
      motion.remove();
    };
  }, []);
  return !reduced && !screenReader;
}

function ParticleField({ scene, effect }: { scene: number; effect: SkRuntimeEffect }) {
  const theme = useThemeTokens();
  const size = useSharedValue({ width: 1, height: 1 });
  const shape = useSharedValue(scene);
  const clock = useSharedValue(0);
  const lastPaint = useSharedValue(-1000);
  useEffect(() => {
    shape.set(withTiming(scene, timing('long')));
    return () => cancelAnimation(shape);
  }, [scene, shape]);
  const frame = useFrameCallback(({ timeSinceFirstFrame, timeSincePreviousFrame }) => {
    if (timeSincePreviousFrame === null) lastPaint.set(-1000);
    if (timeSinceFirstFrame - lastPaint.get() < 1000 / 30) return;
    lastPaint.set(timeSinceFirstFrame);
    clock.set(timeSinceFirstFrame / 1000);
  }, false);
  useEffect(() => {
    frame.setActive(true);
    return () => frame.setActive(false);
  }, [frame]);
  const tint = Array.from(Skia.Color(theme.colors.primary)).slice(0, 3);
  const ink = Array.from(Skia.Color(theme.colors.text)).slice(0, 3);
  const uniforms = useDerivedValue(() => ({
    size: [size.get().width, size.get().height],
    scene: shape.get(),
    time: clock.get(),
    tint,
    ink,
  }));
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) =>
        size.set({ width: layout.width, height: layout.height })
      }>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Fill>
          <Shader source={effect} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

/** Own the effect only while visible. A failed compile leaves the readable static emblem. */
function IntroParticles({ scene }: { scene: number }) {
  const [effect, setEffect] = useState<SkRuntimeEffect | null>(null);
  useEffect(() => {
    let compiled: SkRuntimeEffect | null = null;
    try {
      compiled = Skia.RuntimeEffect.Make(RELEASE_INTRO_SKSL);
    } catch {
      // The static emblem is also the reduced-motion and screen-reader presentation.
    }
    setEffect(compiled);
    return () => compiled?.dispose();
  }, []);
  return effect ? <ParticleField effect={effect} scene={scene} /> : null;
}

export function ReleaseIntroArt({ scene, visible }: { scene: number; visible: boolean }) {
  const theme = useThemeTokens();
  const active = useAppActive();
  const motion = useDecorativeMotion();
  const Icon = [Workflow, GitFork, Layers3][scene] ?? Workflow;
  return (
    <View
      style={styles.art}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View style={[styles.orbit, { borderColor: theme.colors.border }]} />
      <View style={[styles.innerOrbit, { borderColor: theme.colors.border }]} />
      {visible && active && motion ? <IntroParticles scene={scene} /> : null}
      <View style={[styles.emblem, { backgroundColor: theme.colors.background }]}>
        <Icon size={36} color={theme.colors.primary} strokeWidth={1.4} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  art: {
    width: '100%',
    aspectRatio: 1.16,
    maxWidth: 440,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: {
    position: 'absolute',
    width: '68%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.36,
  },
  innerOrbit: {
    position: 'absolute',
    width: '48%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.2,
  },
  emblem: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
