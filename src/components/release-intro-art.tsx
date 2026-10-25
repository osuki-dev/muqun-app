import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Canvas, Points } from 'react-native-skia';
import {
  cancelAnimation,
  useDerivedValue,
  Easing,
  ReduceMotion,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import { ForkIcon, StackIcon, WorkflowIcon } from '@/icons';
import { useAppActive } from '@/hooks/use-app-active';
import {
  introParticlePositions,
  projectIntroParticles,
  RELEASE_INTRO_FORMATION_MS,
  type IntroFormation,
} from '@/lib/release-intro-particles';

/** Resolve accessibility before starting the decorative renderer, including live changes. */
function useDecorativeMotion() {
  const initialReduced = useReducedMotion();
  const [reduced, setReduced] = useState(initialReduced);
  const [screenReader, setScreenReader] = useState<boolean | null>(null);
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
  return screenReader === null ? 'pending' : reduced || screenReader ? 'static' : 'animate';
}

function IntroParticles({
  scene,
  animate,
  width,
  height,
}: {
  scene: number;
  animate: boolean;
  width: number;
  height: number;
}) {
  const theme = useThemeTokens();
  const progress = useSharedValue(animate ? 0 : 1);
  const formation = useSharedValue<IntroFormation>({ scene, from: null });
  const positions = useDerivedValue(() => introParticlePositions(formation.get(), progress.get()));
  useEffect(() => {
    scheduleOnUI(() => {
      'worklet';
      const previous = formation.get();
      // Capture and restart atomically on the UI thread, including rapid taps.
      const from = previous.scene === scene ? null : positions.get();
      cancelAnimation(progress);
      formation.set({ scene, from });
      progress.set(animate ? 0 : 1);
      if (animate) {
        progress.set(
          withTiming(1, {
            duration: RELEASE_INTRO_FORMATION_MS,
            easing: Easing.linear,
            reduceMotion: ReduceMotion.Never,
          })
        );
      }
    });
    return () => cancelAnimation(progress);
  }, [animate, scene, formation, positions, progress]);
  const small = useDerivedValue(() => projectIntroParticles(positions.get(), width, height, 0));
  const medium = useDerivedValue(() => projectIntroParticles(positions.get(), width, height, 1));
  const large = useDerivedValue(() => projectIntroParticles(positions.get(), width, height, 2));
  return (
    <View style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Points
          points={small}
          color={theme.colors.primary}
          strokeWidth={1.4}
          strokeCap="round"
          opacity={0.35}
        />
        <Points
          points={medium}
          color={theme.colors.primary}
          strokeWidth={2.1}
          strokeCap="round"
          opacity={0.55}
        />
        <Points
          points={large}
          color={theme.colors.primary}
          strokeWidth={2.8}
          strokeCap="round"
          opacity={0.8}
        />
      </Canvas>
    </View>
  );
}

export function ReleaseIntroArt({
  scene,
  visible,
  maxHeight,
}: {
  scene: number;
  visible: boolean;
  /** Caps the art on a short window so the copy below it is not pushed out. */
  maxHeight?: number;
}) {
  const theme = useThemeTokens();
  const active = useAppActive();
  const motion = useDecorativeMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const Icon = [WorkflowIcon, ForkIcon, StackIcon][scene] ?? WorkflowIcon;
  return (
    <View
      style={[styles.art, maxHeight !== undefined && { maxHeight }]}
      onLayout={({ nativeEvent: { layout } }) =>
        setSize((current) =>
          current.width === layout.width && current.height === layout.height
            ? current
            : { width: layout.width, height: layout.height }
        )
      }
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {visible && active && motion !== 'pending' && size.width > 0 && size.height > 0 ? (
        <IntroParticles
          scene={scene}
          animate={motion === 'animate'}
          width={size.width}
          height={size.height}
        />
      ) : null}
      <View style={styles.emblem}>
        <Icon size={36} color={theme.colors.primary} />
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
  emblem: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
