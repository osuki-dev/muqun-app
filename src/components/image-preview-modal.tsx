import { Trans, useLingui } from '@lingui/react/macro';
import { Text, PressableScale } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { CloseIcon } from '@/icons';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useFileActions } from '@/hooks/use-file-actions';
import { useStableHandler } from '@/hooks/use-render-refs';
import { savePreviewImage } from '@/lib/save-file';
import {
  failedPreviewLoad,
  resolvedPreviewLoad,
  type PreviewImageSource,
  saveOriginalPreview,
  shouldLoadImagePreview,
  type PreviewImageDescriptor,
  type PreviewLoadState,
} from '@/lib/gateway-image-previews';
import {
  clampPreviewTransform,
  finishPreviewPan,
  panPreviewFrom,
  previewPageIndex,
  RESTING_PREVIEW,
  zoomPreviewAt,
  type PreviewSize,
} from '@/lib/image-preview-geometry';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewProps,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DURATION, fadeIn, fadeOut, timing, zoomIn } from '@/lib/motion';

const AXIS_LOCK_DISTANCE = 8;
const DOUBLE_TAP_SCALE = 2.5;
const UNKNOWN_SIZE: PreviewSize = { width: 0, height: 0 };

export interface PreviewImage extends PreviewImageDescriptor {
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
  const window = useWindowDimensions();
  const [layout, setLayout] = useState<PreviewSize | null>(null);
  const [pendingSaves] = useState(() => new Set<AbortController>());
  useEffect(
    () => () => {
      for (const controller of pendingSaves) controller.abort();
      pendingSaves.clear();
    },
    [pendingSaves]
  );
  const { width, height } = layout ?? window;
  const sourceKey = JSON.stringify([
    initialIndex,
    images.map(({ id, uri, cacheKey }) => [id, uri, cacheKey]),
  ]);
  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape-left',
        'landscape-right',
      ]}
      onRequestClose={onClose}>
      {/* Keep the native modal mounted on rotation; reset only its gesture surface. */}
      <GestureHandlerRootView
        style={styles.root}
        onLayout={({ nativeEvent: { layout: next } }) => {
          setLayout((current) =>
            current?.width === next.width && current.height === next.height
              ? current
              : { width: next.width, height: next.height }
          );
        }}>
        <Animated.View entering={zoomIn('modal')} style={styles.root}>
          <PreviewSelection
            key={sourceKey}
            images={images}
            initialIndex={initialIndex}
            width={width}
            height={height}
            onClose={onClose}
            pendingSaves={pendingSaves}
          />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Image identity resets selection; viewport identity resets only manipulation. */
function PreviewSelection({
  images,
  initialIndex,
  width,
  height,
  onClose,
  pendingSaves,
}: {
  images: PreviewImage[];
  initialIndex: number;
  width: number;
  height: number;
  onClose: () => void;
  pendingSaves: Set<AbortController>;
}) {
  const [index, setIndex] = useState(() => previewPageIndex(initialIndex, images.length));
  return (
    <PreviewSurface
      key={`${width}:${height}`}
      images={images}
      activeIndex={index}
      width={width}
      height={height}
      onPageChange={setIndex}
      onClose={onClose}
      pendingSaves={pendingSaves}
    />
  );
}

type PreviewAccessibility = Pick<
  ViewProps,
  'accessibilityActions' | 'onAccessibilityAction' | 'onAccessibilityEscape'
>;

function PreviewSurface({
  images,
  activeIndex,
  width,
  height,
  onPageChange,
  onClose,
  pendingSaves,
}: {
  images: PreviewImage[];
  activeIndex: number;
  width: number;
  height: number;
  onPageChange: (index: number) => void;
  onClose: () => void;
  pendingSaves: Set<AbortController>;
}) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const viewport = useMemo(() => ({ width, height }), [width, height]);
  const count = images.length;
  const [originalPages, setOriginalPages] = useState<ReadonlyMap<number, number>>(new Map());
  const [loadedOriginalPages, setLoadedOriginalPages] = useState<ReadonlySet<number>>(new Set());
  const canViewOriginal = Boolean(
    !loadedOriginalPages.has(activeIndex) &&
    images[activeIndex]?.resolveOriginal &&
    images[activeIndex]?.original &&
    images[activeIndex]?.uri !== images[activeIndex]?.original?.uri
  );
  const viewOriginal = () =>
    setOriginalPages((current) =>
      new Map(current).set(activeIndex, (current.get(activeIndex) ?? 0) + 1)
    );
  const pagerX = useSharedValue(-activeIndex * width);
  const dragY = useSharedValue(0);
  const transform = useSharedValue(RESTING_PREVIEW);
  const sizes = useSharedValue<PreviewSize[]>(images.map(() => UNKNOWN_SIZE));
  const pageIndex = useSharedValue(activeIndex);
  const pan = useSharedValue({
    axis: null as 'horizontal' | 'vertical' | null,
    startPagerX: 0,
    startImage: RESTING_PREVIEW,
    origin: { x: 0, y: 0 },
    zoomedAtStart: false,
    usedMultiplePointers: false,
    needsRebase: false,
  });
  const pinch = useSharedValue({
    active: false,
    startImage: RESTING_PREVIEW,
    focal: { x: 0, y: 0 },
    eventScale: 1,
    pointers: 0,
  });
  const close = useStableHandler(onClose);
  const commitPage = useStableHandler(onPageChange);
  const fileActions = useFileActions(
    t`Save image`,
    async () => {
      const image = images[pageIndex.get()];
      if (image) {
        const controller = new AbortController();
        pendingSaves.add(controller);
        await saveOriginalPreview(image, savePreviewImage, controller.signal).finally(() =>
          pendingSaves.delete(controller)
        );
      }
    },
    true
  );
  const showFileActions = useStableHandler(fileActions.show);

  // Native recognizers and all their relations must share one memoized lifetime.
  const gesture = useMemo(() => {
    const panGesture = Gesture.Pan()
      .minDistance(AXIS_LOCK_DISTANCE)
      .averageTouches(true)
      .onBegin((event) => {
        pan.set({
          ...pan.get(),
          axis: null,
          usedMultiplePointers: event.numberOfPointers > 1,
          needsRebase: false,
        });
      })
      .onTouchesDown((event) => {
        if (event.numberOfTouches > 1) {
          pan.set({ ...pan.get(), usedMultiplePointers: true, needsRebase: true });
        }
      })
      .onStart(() => {
        cancelAnimation(pagerX);
        cancelAnimation(dragY);
        cancelAnimation(transform);
        const image = clampPreviewTransform(
          transform.get(),
          sizes.get()[pageIndex.get()] ?? UNKNOWN_SIZE,
          viewport
        );
        transform.set(image);
        pan.set({
          ...pan.get(),
          startPagerX: pagerX.get(),
          startImage: image,
          origin: { x: 0, y: 0 },
          zoomedAtStart: image.scale > 1,
        });
      })
      .onUpdate((event) => {
        const state = pan.get();
        if (pinch.get().active || event.numberOfPointers !== 1) {
          pan.set({ ...state, usedMultiplePointers: true, needsRebase: true });
          return;
        }
        const translation = { x: event.translationX, y: event.translationY };
        if (state.needsRebase) {
          cancelAnimation(transform);
          const current = transform.get();
          const rebased = current.scale <= 1.05 ? RESTING_PREVIEW : current;
          transform.set(rebased);
          pan.set({
            ...state,
            startImage: rebased,
            origin: translation,
            needsRebase: false,
          });
          return;
        }
        if (state.zoomedAtStart || state.usedMultiplePointers || transform.get().scale > 1) {
          transform.set(
            panPreviewFrom(
              state.startImage,
              state.origin,
              translation,
              sizes.get()[pageIndex.get()] ?? UNKNOWN_SIZE,
              viewport
            )
          );
          return;
        }
        let axis = state.axis;
        if (
          axis === null &&
          Math.max(Math.abs(event.translationX), Math.abs(event.translationY)) >= AXIS_LOCK_DISTANCE
        ) {
          axis =
            Math.abs(event.translationX) > Math.abs(event.translationY) ? 'horizontal' : 'vertical';
          pan.set({ ...state, axis });
        }
        if (axis === 'horizontal') {
          pagerX.set(
            Math.max(
              -Math.max(0, count - 1) * width,
              Math.min(0, state.startPagerX + event.translationX)
            )
          );
        } else if (axis === 'vertical') {
          dragY.set(Math.max(0, event.translationY));
        }
      })
      .onEnd((event, success) => {
        const state = pan.get();
        const result = finishPreviewPan({
          success,
          zoomedAtStart: state.zoomedAtStart,
          usedMultiplePointers: state.usedMultiplePointers,
          axis: state.axis,
          index: pageIndex.get(),
          count,
          width,
          translationX: event.translationX,
          velocityX: event.velocityX,
          dragY: dragY.get(),
          velocityY: event.velocityY,
        });
        if (result.index !== pageIndex.get()) {
          pageIndex.set(result.index);
          transform.set(RESTING_PREVIEW);
          scheduleOnRN(commitPage, result.index);
        }
        pagerX.set(withTiming(-result.index * width, timing('short')));
        dragY.set(withTiming(0, timing('short')));
        if (result.dismiss) scheduleOnRN(close);
      })
      .onFinalize((_event, success) => {
        if (!success) {
          pagerX.set(withTiming(-pageIndex.get() * width, timing('short')));
          dragY.set(withTiming(0, timing('short')));
        }
        pan.set({ ...pan.get(), axis: null });
      });

    const pinchGesture = Gesture.Pinch()
      .onStart((event) => {
        cancelAnimation(transform);
        cancelAnimation(pagerX);
        cancelAnimation(dragY);
        pagerX.set(-pageIndex.get() * width);
        dragY.set(0);
        pinch.set({
          active: true,
          startImage: clampPreviewTransform(
            transform.get(),
            sizes.get()[pageIndex.get()] ?? UNKNOWN_SIZE,
            viewport
          ),
          focal: { x: event.focalX - width / 2, y: event.focalY - height / 2 },
          eventScale: event.scale,
          pointers: event.numberOfPointers,
        });
        pan.set({ ...pan.get(), usedMultiplePointers: true, needsRebase: true });
      })
      .onUpdate((event) => {
        const state = pinch.get();
        const focal = { x: event.focalX - width / 2, y: event.focalY - height / 2 };
        if (event.numberOfPointers !== state.pointers || state.eventScale <= 0) {
          pinch.set({
            ...state,
            startImage: transform.get(),
            focal,
            eventScale: event.scale,
            pointers: event.numberOfPointers,
          });
          return;
        }
        transform.set(
          zoomPreviewAt(
            state.startImage,
            (state.startImage.scale * event.scale) / state.eventScale,
            state.focal,
            focal,
            sizes.get()[pageIndex.get()] ?? UNKNOWN_SIZE,
            viewport
          )
        );
      })
      .onFinalize(() => {
        if (!pinch.get().active) return;
        const current = transform.get();
        transform.set(
          withTiming(
            current.scale <= 1.05
              ? RESTING_PREVIEW
              : clampPreviewTransform(
                  current,
                  sizes.get()[pageIndex.get()] ?? UNKNOWN_SIZE,
                  viewport
                ),
            timing('micro')
          )
        );
        pinch.set({ ...pinch.get(), active: false });
        pan.set({ ...pan.get(), needsRebase: true });
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(260)
      .maxDelay(260)
      .maxDistance(12)
      .onTouchesDown((event, manager) => {
        if (event.numberOfTouches > 1) manager.fail();
      })
      .onEnd((event, success) => {
        if (!success) return;
        cancelAnimation(transform);
        cancelAnimation(pagerX);
        cancelAnimation(dragY);
        pagerX.set(-pageIndex.get() * width);
        dragY.set(0);
        const focal = { x: event.x - width / 2, y: event.y - height / 2 };
        const current = transform.get();
        transform.set(
          withTiming(
            current.scale > 1.05
              ? RESTING_PREVIEW
              : zoomPreviewAt(
                  current,
                  DOUBLE_TAP_SCALE,
                  focal,
                  focal,
                  sizes.get()[pageIndex.get()] ?? UNKNOWN_SIZE,
                  viewport
                ),
            timing('short')
          )
        );
      });
    const singleTap = Gesture.Tap()
      .maxDistance(12)
      .onTouchesDown((event, manager) => {
        if (event.numberOfTouches > 1) manager.fail();
      })
      .onEnd((_event, success) => {
        if (success) scheduleOnRN(close);
      });
    const longPress = Gesture.LongPress()
      .minDuration(450)
      .maxDistance(12)
      .numberOfPointers(1)
      .onTouchesDown((event, manager) => {
        if (event.numberOfTouches > 1) manager.fail();
      })
      .onEnd((_event, success) => {
        if (success) scheduleOnRN(showFileActions);
      });
    return Gesture.Race(
      Gesture.Simultaneous(panGesture, pinchGesture),
      Gesture.Exclusive(longPress, doubleTap, singleTap)
    );
  }, [
    close,
    commitPage,
    count,
    dragY,
    height,
    pageIndex,
    pagerX,
    pan,
    pinch,
    showFileActions,
    sizes,
    transform,
    viewport,
    width,
  ]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.7, dragY.get() / 420),
  }));
  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pagerX.get() }, { translateY: dragY.get() }],
  }));
  const accessibility: PreviewAccessibility = {
    onAccessibilityEscape: close,
    accessibilityActions: [
      ...(canViewOriginal ? [{ name: 'viewOriginal', label: t`View original` }] : []),
      { name: 'increment', label: t`Zoom in` },
      { name: 'decrement', label: t`Zoom out` },
      { name: 'resetZoom', label: t`Reset zoom` },
      ...(count > 1
        ? [
            { name: 'previousImage', label: t`Previous image` },
            { name: 'nextImage', label: t`Next image` },
          ]
        : []),
      { name: 'longpress', label: t`Save image` },
      { name: 'escape', label: t`Close preview` },
    ],
    onAccessibilityAction: ({ nativeEvent: { actionName } }) => {
      if (actionName === 'viewOriginal' && canViewOriginal) {
        viewOriginal();
        return;
      }
      if (actionName === 'escape') {
        close();
        return;
      }
      if (actionName === 'longpress') {
        showFileActions();
        return;
      }
      scheduleOnUI(() => {
        'worklet';
        cancelAnimation(transform);
        const index = pageIndex.get();
        if (actionName === 'previousImage' || actionName === 'nextImage') {
          const next = previewPageIndex(index + (actionName === 'nextImage' ? 1 : -1), count);
          transform.set(RESTING_PREVIEW);
          pageIndex.set(next);
          pagerX.set(withTiming(-next * width, timing('short')));
          dragY.set(0);
          scheduleOnRN(commitPage, next);
        } else if (
          actionName === 'increment' ||
          actionName === 'decrement' ||
          actionName === 'resetZoom'
        ) {
          const current = transform.get();
          transform.set(
            withTiming(
              actionName === 'resetZoom'
                ? RESTING_PREVIEW
                : zoomPreviewAt(
                    current,
                    current.scale + (actionName === 'increment' ? 0.5 : -0.5),
                    { x: 0, y: 0 },
                    { x: 0, y: 0 },
                    sizes.get()[index] ?? UNKNOWN_SIZE,
                    viewport
                  ),
              timing('short')
            )
          );
        }
      });
    },
  };
  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={gesture}>
        <Animated.View style={styles.viewport} testID="image-preview-viewport">
          {/* The detector stays still; its focal coordinates never include pager translation. */}
          <Animated.View style={[styles.pager, { width: width * count }, pagerStyle]}>
            {images.map((image, index) => (
              <PreviewPage
                key={image.id}
                image={image}
                index={index}
                active={index === activeIndex}
                accessibility={accessibility}
                width={width}
                height={height}
                transform={transform}
                sizes={sizes}
                pageIndex={pageIndex}
                originalRequested={originalPages.get(index) ?? 0}
                onOriginalLoaded={(loaded) =>
                  setLoadedOriginalPages((current) => {
                    if (current.has(index) === loaded) return current;
                    const next = new Set(current);
                    if (loaded) next.add(index);
                    else next.delete(index);
                    return next;
                  })
                }
              />
            ))}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
      {/* Declared last, and carrying `zIndex` and `elevation` as well:
            Android hit-tests by Z before draw order, and this is the control
            that has to stay reachable no matter what the pager is doing or
            failing to do underneath it. */}
      {fileActions.menu && (
        <View
          style={{
            position: 'absolute',
            bottom: insets.bottom + 24,
            left: 24 + insets.left,
            right: 24 + insets.right,
          }}>
          {fileActions.menu}
        </View>
      )}
      <PressableScale
        accessibilityLabel={t`Close preview`}
        onPress={onClose}
        style={[styles.close, { top: insets.top + 10, right: 14 + insets.right }]}>
        <CloseIcon size={20} color="#FFFFFF" />
      </PressableScale>
      {canViewOriginal ? (
        <PressableScale
          accessibilityLabel={t`View original`}
          onPress={viewOriginal}
          style={[styles.original, { top: insets.top + 10, left: 14 + insets.left }]}>
          <Text variant="caption" style={{ color: '#FFFFFF' }}>{t`View original`}</Text>
        </PressableScale>
      ) : null}
    </>
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
  index,
  active,
  accessibility,
  width,
  height,
  transform,
  sizes,
  pageIndex,
  originalRequested,
  onOriginalLoaded,
}: {
  image: PreviewImage;
  index: number;
  active: boolean;
  accessibility: PreviewAccessibility;
  width: number;
  height: number;
  transform: SharedValue<typeof RESTING_PREVIEW>;
  sizes: SharedValue<PreviewSize[]>;
  pageIndex: SharedValue<number>;
  originalRequested: number;
  onOriginalLoaded: (loaded: boolean) => void;
}) {
  const { t } = useLingui();
  const [load, setLoad] = useState<PreviewLoadState>(() => ({
    source: image.resolveSource ? null : image,
    status: 'loading',
    original: false,
  }));
  const { status, original } = load;
  const wantsPreview = Boolean(load.previewFallback && (load.request ?? 0) === originalRequested);
  const wantsOriginal = !wantsPreview && (original || originalRequested > 0);
  const asynchronous = Boolean(image.resolveSource);
  const resolve = useEffectEvent((signal: AbortSignal, original: boolean, preview: boolean) =>
    preview && image.resolvePreview
      ? image.resolvePreview(signal)
      : original
        ? (image.resolveOriginal?.(signal) ?? Promise.resolve(image.original ?? image))
        : (image.resolveSource?.(signal) ?? Promise.resolve(image))
  );
  useEffect(() => {
    if (!active || !asynchronous) return;
    const controller = new AbortController();
    resolve(controller.signal, wantsOriginal, wantsPreview).then(
      (source) => {
        if (!controller.signal.aborted)
          setLoad((current) =>
            resolvedPreviewLoad(current, source, wantsOriginal, wantsPreview, originalRequested)
          );
        else source.dispose?.();
      },
      () => {
        if (!controller.signal.aborted)
          setLoad((current) =>
            current.readySource
              ? { ...current, source: current.readySource, status: 'loaded' }
              : { ...current, status: 'failed' }
          );
      }
    );
    return () => controller.abort();
  }, [active, asynchronous, wantsOriginal, wantsPreview, originalRequested]);
  // Keep the last decoded preview leased while a replacement is decoding. A
  // failed original can restore it without referring to an already-deleted file.
  const owned = useRef(new Set<PreviewImageSource>());
  useEffect(() => {
    const next = new Set(
      [load.source, load.readySource].filter((source): source is PreviewImageSource =>
        Boolean(source)
      )
    );
    for (const source of owned.current) if (!next.has(source)) source.dispose?.();
    owned.current = next;
  }, [load.source, load.readySource]);
  useEffect(
    () => () => {
      for (const source of owned.current) source.dispose?.();
      owned.current.clear();
    },
    []
  );
  const zoomStyle = useAnimatedStyle(() => {
    // Clamp even during timed zooms: an axis may not overflow until halfway through.
    const current =
      index === pageIndex.get()
        ? clampPreviewTransform(transform.get(), sizes.get()[index] ?? UNKNOWN_SIZE, {
            width,
            height,
          })
        : RESTING_PREVIEW;
    return {
      transform: [{ translateX: current.x }, { translateY: current.y }, { scale: current.scale }],
    };
  });

  return (
    <View
      style={{ width, height, overflow: 'hidden' }}
      accessible={active}
      importantForAccessibility={active ? 'yes' : 'no-hide-descendants'}
      accessibilityElementsHidden={!active}
      accessibilityRole="adjustable"
      accessibilityLabel={
        status === 'failed' ? t`This image could not be loaded.` : t`Image preview`
      }
      {...accessibility}>
      <Animated.View style={[styles.page, zoomStyle]}>
        {load.source && shouldLoadImagePreview(image, active, status === 'loaded') ? (
          <Image
            key={load.source.cacheKey ?? load.source.uri}
            source={{
              uri: load.source.uri,
              headers: load.source.headers,
              cacheKey: load.source.cacheKey,
            }}
            cachePolicy={image.deferred ? 'none' : undefined}
            style={styles.image}
            contentFit="contain"
            // The decode's own fade. It was 120 ms, which is not a step on any
            // scale this app uses. There is deliberately no `placeholder`: a
            // blurhash is the right answer and the gateway does not send one, so
            // writing a fake one here would be a lie about the file. Until it
            // does, the wait is stated by the frame below rather than guessed at.
            transition={DURATION.micro}
            onLoad={({ source }) => {
              onOriginalLoaded(Boolean(load.source?.originalLoaded));
              sizes.set((current) =>
                current.map((size, page) =>
                  page === index ? { width: source.width, height: source.height } : size
                )
              );
              setLoad((current) =>
                current.source === load.source &&
                (current.status !== 'loaded' || current.readySource !== current.source)
                  ? { ...current, status: 'loaded', readySource: current.source ?? undefined }
                  : current
              );
            }}
            onError={() => {
              const failed = load.source;
              if (failed) setLoad((current) => failedPreviewLoad(current, image, failed));
            }}
          />
        ) : null}
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
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  original: {
    position: 'absolute',
    left: 14,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.30)',
    zIndex: 1,
    elevation: 1,
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
