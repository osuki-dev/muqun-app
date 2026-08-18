import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SplashBackground } from '@/constants/theme';

const DURATION = 600;
/**
 * The overlay covers the whole app, so it must never outlive its animation --
 * even if Reanimated drops the entering callback because the view remounted.
 */
const MAX_SPLASH_MS = 4_000;

// Matches the native splash colours in app.json so the handover is seamless.
const SPLASH_BACKGROUND = SplashBackground;

// Built once: constructing this per render restarts the animation on re-render.
const splashKeyframe = new Keyframe({
  0: {
    transform: [{ scale: 1 }],
    opacity: 1,
  },
  20: {
    opacity: 1,
  },
  70: {
    opacity: 0,
    easing: Easing.elastic(0.7),
  },
  100: {
    opacity: 0,
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);
  const scheme = useColorScheme();

  useEffect(() => {
    const timeout = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => undefined);
      setVisible(false);
    }, MAX_SPLASH_MS);
    return () => clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  const overlayStyle = [
    styles.splashOverlay,
    { backgroundColor: scheme === 'dark' ? SPLASH_BACKGROUND.dark : SPLASH_BACKGROUND.light },
  ];
  const image = <Image style={styles.image} source={require('@/assets/images/loading-mark.png')} />;

  return animate ? (
    <Animated.View
      // Once it starts fading out it must not swallow taps meant for the app.
      pointerEvents="none"
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={overlayStyle}>
      {image}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={overlayStyle}>
      {image}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: 96,
    height: 96,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
