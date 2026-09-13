import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SplashBackground } from '@/constants/theme';
import { useLaunchArtwork, useLaunchBackground } from '@/hooks/use-launch-artwork';
import { fadeIn } from '@/lib/motion';

const DURATION = 600;
/**
 * The overlay covers the whole app, so it must never outlive its animation --
 * even if Reanimated drops the entering callback because the view remounted.
 */
const MAX_SPLASH_MS = 4_000;

// Matches the native splash colours in app.json so the handover is seamless.
const SPLASH_BACKGROUND = SplashBackground;

const bundledMark = require('@/assets/images/loading-mark.png');

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
  const artwork = useLaunchArtwork();
  const themeBackground = useLaunchBackground();

  useEffect(() => {
    const timeout = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => undefined);
      setVisible(false);
    }, MAX_SPLASH_MS);
    return () => clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  /*
   * Two different questions, and they have two different answers.
   *
   * With no pack the floor has to match the *native* splash, which is a pair of
   * colours compiled into the app and follows the system scheme -- not the
   * reader's light/dark preference, which the native side never sees. So that
   * branch keeps reading `useColorScheme`, exactly as it always did, and the
   * handover stays a single unbroken colour.
   *
   * A pack has already broken that agreement by the time it gets here: its
   * paper is not the app's, so there is nothing to match. It follows the app's
   * own resolved mode instead (inside `useLaunchBackground`), which is what
   * every surface the overlay lifts off is wearing.
   */
  const overlayStyle = [
    styles.splashOverlay,
    {
      backgroundColor:
        themeBackground ?? (scheme === 'dark' ? SPLASH_BACKGROUND.dark : SPLASH_BACKGROUND.light),
    },
  ];

  const image =
    artwork.kind === 'default' ? (
      <Image style={styles.image} source={bundledMark} />
    ) : (
      <Image
        source={{ uri: artwork.uri }}
        contentFit="contain"
        cachePolicy="memory"
        autoplay={false}
        accessible={false}
        style={styles.image}
      />
    );

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
      {/*
        The entrance belongs on this branch and not on the one below, because
        this is the first branch anybody sees: the native splash covers the
        whole app until `hideAsync` resolves, and the branch below is the one
        rendering behind it. So the overlay becomes visible on exactly the
        frame this mounts.

        And on that frame the app's own icon is replaced by someone else's
        picture. Cut hard, that is two unrelated marks swapping places; at
        `micro` it is one arriving as the other leaves. 150 ms also lands just
        as the keyframe above starts its own fade at 20% of 600 ms, so the
        picture is whole for a moment before the overlay dissolves, and the
        launch is not a millisecond longer than it was.

        A pack that has no picture keeps the bundled mark, which is the icon
        the native splash was already showing -- nothing has changed, so there
        is nothing to fade.
      */}
      {artwork.kind === 'default' ? (
        image
      ) : (
        <Animated.View entering={fadeIn('micro')}>{image}</Animated.View>
      )}
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
