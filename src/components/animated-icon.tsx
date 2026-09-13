import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import Animated, {
  Easing,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SplashBackground } from '@/constants/theme';
import { useLaunchArtwork, useLaunchBackground } from '@/hooks/use-launch-artwork';
import { DURATION, timing } from '@/lib/motion';

const DISSOLVE_MS = 600;
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
  const packBackground = useLaunchBackground();
  const handoff = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handedOff = useRef(false);

  /*
   * The floor underneath keeps two answers, and the no-pack one is the older
   * and stricter of the two.
   *
   * With no pack it must match the *native* splash, whose two colours are
   * compiled into the app and follow the system scheme -- not the reader's
   * light/dark preference, which the native side never sees. So it stays on
   * `useColorScheme`, exactly as it always did.
   *
   * A pack has already broken that agreement: its paper is not the app's, and
   * there is nothing left to match. It follows the app's own resolved mode
   * instead, and it arrives as a layer over the native colour rather than in
   * place of it, so the change can be eased rather than switched.
   */
  const nativeFloor = scheme === 'dark' ? SPLASH_BACKGROUND.dark : SPLASH_BACKGROUND.light;
  const picture = artwork.kind === 'default' ? null : artwork.uri;
  const hasPicture = picture !== null;
  // A pack may change only the paper -- no illustration, no logo -- and that is
  // still a handover worth easing.
  const softHandover = hasPicture || packBackground !== null;

  /*
   * 0 is what the native splash was showing -- the app's mark on the app's
   * paper -- and 1 is the pack's. One value drives all three layers so the
   * picture, the mark it replaces and the floor under both cannot drift apart.
   *
   * It lives here rather than in the views below because those views are
   * replaced when `animate` flips: `AnimatedSplashOverlay` itself stays
   * mounted, so the progress survives the swap and the picture does not jump
   * back to the mark when the dissolve begins.
   */
  const handover = useSharedValue(0);
  const floorStyle = useAnimatedStyle(() => ({ opacity: handover.value }));
  const pictureStyle = useAnimatedStyle(() => ({ opacity: handover.value }));
  // Only a picture takes the mark's place. A pack that changed the paper alone
  // still needs a mark on it.
  const markStyle = useAnimatedStyle(() => ({
    opacity: hasPicture ? 1 - handover.value : 1,
  }));

  useEffect(() => {
    const timeout = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => undefined);
      setVisible(false);
    }, MAX_SPLASH_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(
    () => () => {
      if (handoff.current) clearTimeout(handoff.current);
    },
    []
  );

  if (!visible) return null;

  const overlayStyle = [styles.splashOverlay, { backgroundColor: nativeFloor }];

  /*
   * Every layer is mounted at once and the handover moves between them, which
   * is what makes it a cross-fade rather than a swap. Nothing here is laid
   * out: the mark and the picture share one 96pt square and the floor is the
   * whole screen, so opacity is the only thing that moves.
   */
  const layers = (
    <>
      {softHandover && packBackground ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: packBackground }, floorStyle]}
        />
      ) : null}
      <View pointerEvents="none" style={styles.stage}>
        <Animated.View style={[StyleSheet.absoluteFill, markStyle]}>
          <Image contentFit="contain" style={StyleSheet.absoluteFill} source={bundledMark} />
        </Animated.View>
        {picture ? (
          <Animated.View style={[StyleSheet.absoluteFill, pictureStyle]}>
            <Image
              source={{ uri: picture }}
              contentFit="contain"
              cachePolicy="memory"
              autoplay={false}
              accessible={false}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
      </View>
    </>
  );

  return animate ? (
    <Animated.View
      // Once it starts fading out it must not swallow taps meant for the app.
      pointerEvents="none"
      entering={splashKeyframe.duration(DISSOLVE_MS).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={overlayStyle}>
      {layers}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        // `onLayout` fires again on a rotation, and the handover is a one-off.
        if (handedOff.current) return;
        handedOff.current = true;
        SplashScreen.hideAsync().finally(() => {
          /*
           * This is the frame the reader first sees anything: the native
           * splash covered the whole app until `hideAsync` resolved. So it is
           * where the handover starts, and where the dissolve has to wait for
           * it -- a cross-fade cut in half by the overlay leaving is the hard
           * edge it was meant to remove.
           *
           * `medium` on both, because the design system calls `medium` "one
           * surface replacing another" and that is exactly what this is. The
           * dissolve itself is unchanged, and so is `hideAsync`: it is still
           * called once, here, on first layout. Only the pack's arrival is
           * given its own 300 ms, and only when there is a pack to arrive --
           * without one the overlay flips straight to the dissolve, as it
           * always did, and the launch is not a millisecond longer.
           *
           * Reduce motion is answered by `timing`, which carries
           * `ReduceMotion.System`: the value lands immediately and the picture
           * is simply there.
           */
          if (!softHandover) {
            setAnimate(true);
            return;
          }
          handover.value = withTiming(1, timing('medium'));
          handoff.current = setTimeout(() => setAnimate(true), DURATION.medium);
        });
      }}
      style={overlayStyle}>
      {layers}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
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
