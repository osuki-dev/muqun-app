import { Trans, useLingui } from '@lingui/react/macro';
import { Text } from '@/components/text';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { DURATION, fadeIn, fadeOut, timing, zoomIn } from '@/lib/motion';

const AXIS_UNDECIDED = 0;
const AXIS_HORIZONTAL = 1;
const AXIS_VERTICAL = 2;
const AXIS_LOCK_DISTANCE = 8;
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
/** How far down the sheet has to travel before letting go closes it. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

export interface PreviewImage {
  id: string;
  uri: string;
  /**
   * Sent with the request. A composer attachment is a local file and needs
   * none; a gateway asset is behind a bearer token, and letting the image
   * library make the authenticated request itself keeps the bytes out of the
   * JS heap entirely.
   */
  headers?: Record<string, string>;
  /** Cache identity, for a URL whose contents can change under it. */
  cacheKey?: string;
}

/**
 * A full-screen viewer for a set of images -- composer attachments, or a single
 * artifact opened from the session: pinch or double tap to zoom, drag down to
 * dismiss, swipe sideways between them.
 *
 * Hand-built on the gesture handler and Reanimated the app already ships rather
 * than a gallery library, and it deliberately uses one Pan recognizer for all
 * three drag meanings -- pager, dismiss, and panning a zoomed image -- because
 * separate recognizers fight each other for the same finger.
 */
export function ImagePreviewModal({
  images,
  initialIndex,
  onClose,
}: {
  images: PreviewImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pagerX = useSharedValue(-initialIndex * width);
  const dragY = useSharedValue(0);
  const scale = useSharedValue(1);
  const imageX = useSharedValue(0);
  const imageY = useSharedValue(0);
  const gestureStartPagerX = useSharedValue(0);
  const gestureStartImageX = useSharedValue(0);
  const gestureStartImageY = useSharedValue(0);
  const gestureStartScale = useSharedValue(1);
  const panAxis = useSharedValue(AXIS_UNDECIDED);
  const pageIndex = useSharedValue(initialIndex);

  // A rotation, or opening a different image, changes what "page 3" means in
  // pixels. Re-resting the pager keeps the visible page put.
  useEffect(() => {
    pagerX.set(-pageIndex.get() * width);
  }, [pageIndex, pagerX, width]);

  const panGesture = Gesture.Pan()
    .minDistance(2)
    .onStart(() => {
      gestureStartPagerX.set(pagerX.get());
      gestureStartImageX.set(imageX.get());
      gestureStartImageY.set(imageY.get());
      panAxis.set(AXIS_UNDECIDED);
    })
    .onUpdate((event) => {
      if (scale.get() > 1) {
        // Zoomed in, the drag moves the image inside its own frame. The bounds
        // are half the overflow in each direction, so the picture can never be
        // dragged clear of the screen.
        const boundX = ((scale.get() - 1) * width) / 2;
        const boundY = ((scale.get() - 1) * height) / 2;
        imageX.set(
          Math.max(-boundX, Math.min(boundX, gestureStartImageX.get() + event.translationX))
        );
        imageY.set(
          Math.max(-boundY, Math.min(boundY, gestureStartImageY.get() + event.translationY))
        );
        return;
      }

      if (panAxis.get() === AXIS_UNDECIDED) {
        const dx = Math.abs(event.translationX);
        const dy = Math.abs(event.translationY);
        if (Math.max(dx, dy) >= AXIS_LOCK_DISTANCE) {
          panAxis.set(dx > dy ? AXIS_HORIZONTAL : AXIS_VERTICAL);
        }
      }
      if (panAxis.get() === AXIS_HORIZONTAL) {
        pagerX.set(gestureStartPagerX.get() + event.translationX);
      } else if (panAxis.get() === AXIS_VERTICAL) {
        // Only downward: dragging up has no meaning here and letting the image
        // follow it looked like a broken scroll.
        dragY.set(Math.max(0, event.translationY));
      }
    })
    .onEnd((event) => {
      if (scale.get() > 1) return;
      if (panAxis.get() === AXIS_HORIZONTAL) {
        const travelled = event.translationX;
        const flicked = Math.abs(event.velocityX) > 500;
        const step = flicked || Math.abs(travelled) > width * 0.3 ? (travelled < 0 ? 1 : -1) : 0;
        const next = Math.max(0, Math.min(images.length - 1, pageIndex.get() + step));
        pageIndex.set(next);
        pagerX.set(withTiming(-next * width, timing('short')));
        return;
      }
      if (panAxis.get() === AXIS_VERTICAL) {
        if (dragY.get() > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
          scheduleOnRN(onClose);
          return;
        }
        dragY.set(withTiming(0, timing('short')));
      }
    })
    .onFinalize(() => {
      panAxis.set(AXIS_UNDECIDED);
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      gestureStartScale.set(scale.get());
    })
    .onUpdate((event) => {
      scale.set(Math.max(MIN_SCALE, Math.min(MAX_SCALE, gestureStartScale.get() * event.scale)));
    })
    .onEnd(() => {
      // Anything near 1x snaps back cleanly, so a stray pinch cannot leave the
      // image a few percent off and permanently pannable.
      if (scale.get() <= 1.05) {
        scale.set(withTiming(1, timing('micro')));
        imageX.set(withTiming(0, timing('micro')));
        imageY.set(withTiming(0, timing('micro')));
        return;
      }
      // Re-clamp: shrinking can leave the image translated further than its
      // new, smaller overflow allows.
      const boundX = ((scale.get() - 1) * width) / 2;
      const boundY = ((scale.get() - 1) * height) / 2;
      imageX.set(withTiming(Math.max(-boundX, Math.min(boundX, imageX.get())), timing('micro')));
      imageY.set(withTiming(Math.max(-boundY, Math.min(boundY, imageY.get())), timing('micro')));
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((_event, success) => {
      if (!success) return;
      const zoomedIn = scale.get() > 1.05;
      scale.set(withTiming(zoomedIn ? 1 : DOUBLE_TAP_SCALE, timing('short')));
      imageX.set(withTiming(0, timing('short')));
      imageY.set(withTiming(0, timing('short')));
    });

  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .maxDistance(12)
    .onEnd((_event, success) => {
      if (success) scheduleOnRN(onClose);
    });

  const gesture = Gesture.Exclusive(
    doubleTapGesture,
    singleTapGesture,
    Gesture.Simultaneous(panGesture, pinchGesture)
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.7, dragY.get() / 420),
  }));
  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pagerX.get() }, { translateY: dragY.get() }],
  }));
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: imageX.get() }, { translateY: imageY.get() }, { scale: scale.get() }],
  }));

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      // Android's back button. It is the way out a reader reaches for first
      // while a picture is still arriving, and it has to keep working when
      // there is nothing on screen yet.
      onRequestClose={onClose}>
      {/* Gestures inside a native modal need their own root on Android. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        <GestureDetector gesture={gesture}>
          <Animated.View
            // The arrival beat, on the modal token.
            //
            // Not a shared element: the picture is opened from a 62pt tile in
            // the attachment strip *or* from a row in the artifacts list, and
            // neither hands this component the frame it came from -- a real
            // shared-element transition needs that measurement plumbed through
            // both call sites, which is a piece of work of its own. What is
            // wrong without one is not the missing continuity so much as the
            // stillness: the system fade brought the picture up at full size
            // with nothing to say it had been opened. Growing the last few
            // percent says it, and the gesture that dismisses it already
            // shrinks the same way, so the two agree.
            entering={zoomIn('modal')}
            style={[styles.pager, { width: width * images.length }, pagerStyle]}>
            {images.map((image) => (
              <PreviewPage
                key={image.id}
                image={image}
                width={width}
                height={height}
                zoomStyle={zoomStyle}
              />
            ))}
          </Animated.View>
        </GestureDetector>
        {/* Declared last, and carrying `zIndex` and `elevation` as well:
            Android hit-tests by Z before draw order, and this is the control
            that has to stay reachable no matter what the pager is doing or
            failing to do underneath it. */}
        <PressableScale
          accessibilityLabel={t`Close preview`}
          onPress={onClose}
          style={[styles.close, { top: insets.top + 10 }]}>
          <X size={20} color="#FFFFFF" />
        </PressableScale>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * One image, and the two things that can happen instead of one.
 *
 * The viewer used to draw nothing at all until the bytes arrived, which on a
 * slow gateway is a black screen with a faint circle in the corner -- and a
 * black screen is what a broken app looks like. So: a spinner while it is
 * coming, a sentence when it is not, and the state lives per page because in a
 * set of attachments one can fail while its neighbour is fine.
 *
 * Both states are `pointerEvents="none"`. A view that fills the screen while it
 * waits and swallows the touches aimed at the way out is how a loading state
 * becomes a trap; the tap-to-dismiss underneath has to keep working through it.
 */
function PreviewPage({
  image,
  width,
  height,
  zoomStyle,
}: {
  image: PreviewImage;
  width: number;
  height: number;
  zoomStyle: React.ComponentProps<typeof Animated.View>['style'];
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');

  return (
    <View style={{ width, height }}>
      <Animated.View style={[styles.page, zoomStyle]}>
        <Image
          source={{
            uri: image.uri,
            headers: image.headers,
            cacheKey: image.cacheKey,
          }}
          style={styles.image}
          contentFit="contain"
          // The decode's own fade. It was 120 ms, which is not a step on any
          // scale this app uses. There is deliberately no `placeholder`: a
          // blurhash is the right answer and the gateway does not send one, so
          // writing a fake one here would be a lie about the file. Until it
          // does, the wait is stated by the frame below rather than guessed at.
          transition={DURATION.micro}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      </Animated.View>
      {status === 'loading' ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('short')}
          style={styles.pageState}
          pointerEvents="none">
          <ActivityIndicator size="small" color="#FFFFFF" />
        </Animated.View>
      ) : null}
      {status === 'failed' ? (
        <Animated.View
          entering={fadeIn('short')}
          exiting={fadeOut('micro')}
          style={styles.pageState}
          pointerEvents="none">
          {/* The kit's `Text`, not React Native's: this is a sentence the
              reader reads, so it is set in the face they chose. The colour
              stays hard-coded because this one is read against the viewer's
              own black backdrop rather than against a theme surface. */}
          <Text variant="bodySmall" style={styles.pageStateText}>
            <Trans>This image could not be loaded.</Trans>
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: '#000000',
  },
  pager: {
    flex: 1,
    flexDirection: 'row',
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  pageState: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  pageStateText: {
    color: 'rgba(255, 255, 255, 0.72)',
    textAlign: 'center',
  },
  close: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    // Legible on a black backdrop, which is what the screen is for as long as
    // the picture has not arrived. At 16% this button was the only way out of a
    // stalled read and could barely be seen.
    backgroundColor: 'rgba(255, 255, 255, 0.30)',
    // `zIndex` orders the layer, `elevation` is what Android draws and, more to
    // the point, hit-tests by.
    zIndex: 1,
    elevation: 1,
  },
});
