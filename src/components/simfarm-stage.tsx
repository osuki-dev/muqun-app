import { useLingui } from '@lingui/react/macro';
import { Input, Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Canvas, Fill, Group, Image as SkiaImage, vec } from '@shopify/react-native-skia';
import {
  ArrowLeft,
  ChevronDown,
  House,
  Keyboard as KeyboardIcon,
  Lock,
  Power,
  RefreshCw,
  SendHorizontal,
  Smartphone,
  SquareStack,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { feedback } from '@/lib/feedback';
import { timing } from '@/lib/motion';
import { simfarmCanStream, type SimfarmDevice } from '@/lib/simfarm';
import {
  recallSimfarmChrome,
  rememberSimfarmChrome,
  SimfarmChrome,
  simfarmChromeTransition,
} from '@/lib/simfarm-chrome';
import {
  clampSimfarmOffset,
  placeSimfarmFrame,
  simfarmEdgeBands,
  simfarmNormalizedPoint,
  simfarmRestingOffset,
  SIMFARM_MAX_ZOOM,
  SIMFARM_MIN_ZOOM,
  type SimfarmPoint,
} from '@/lib/simfarm-frame';
import {
  SIMFARM_TOUCH_PHASE,
  type SimfarmButton,
  type SimfarmTouchPhase,
} from '@/lib/simfarm-protocol';
import { useSimfarmStream, type SimfarmStreamError } from '@/lib/simfarm-stream';

/**
 * The picture, and everything a finger can do to it.
 *
 * Kept out of `simfarm-preview.tsx` because the two have nothing in common: that
 * file decides *whether* there is a simulator to show and draws four states
 * saying so, and this one has exactly one job once the answer is yes. Putting
 * them together meant a component where the empty states and a live video
 * stream shared a render.
 *
 * ## The picture fills the phone, and nothing sits in a bar
 *
 * The fit rule is in `simfarm-frame.ts` with the reasoning; what belongs here is
 * the consequence. There is no header, no footer and no reserved column: the
 * controls float over the picture in two rows, so a device drawn at the full
 * width of the screen loses nothing to chrome, and the rows can be put away --
 * `simfarm-chrome.ts` has the rule for when and by what. What that costs is
 * that a phone taller than the surface hangs over the bottom, which is what the
 * two-finger drag is for.
 *
 * ## The top band
 *
 * The surface reaches the top of the screen: the host is a full-screen modal
 * with its status bar hidden (the route says why). The picture does not. It
 * starts at the top safe-area inset, because that inset is the camera cutout
 * -- a Dynamic Island, a punch hole -- and a picture drawn under it had the
 * simulated status bar behind the real one's hardware. What is in the band is
 * the collapsed handle, which is the one thing here small enough to share a
 * strip with a camera. On a screen with no cutout the band is `HANDLE_BAND`
 * tall, which is the least the handle needs; `simfarmRestingOffset` is what
 * hangs the overflow off the bottom rather than half of it back into the band.
 */
export function SimfarmStage({
  url,
  devices,
  embedded,
  onClose,
  onLost,
}: {
  /** `ws://host:port/v1`, from `simfarmSocketUrl`. */
  url: string;
  /** What the probe already found, so the picker is populated on the first frame. */
  devices: SimfarmDevice[];
  embedded: boolean;
  onClose?: () => void;
  /**
   * The socket dropped and the reader asked to try again. The caller re-probes
   * and remounts this, which is the only way back: see `useSimfarmStream`.
   */
  onLost: () => void;
}) {
  const theme = useThemeTokens();
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const stream = useSimfarmStream(url, devices);

  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  /** Where the reader dragged the picture to; `null` until they have. */
  const [offset, setOffset] = useState<SimfarmPoint | null>(null);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  /**
   * The two bands the picture keeps clear of the screen's ends. The Pad
   * column is inside the workspace, which has already paid its insets, so
   * there it is only the handle's own room.
   */
  const topBand = embedded ? HANDLE_BAND : Math.max(insets.top, HANDLE_BAND);
  const bottomBand = embedded ? HANDLE_BAND : Math.max(insets.bottom, HANDLE_BAND);

  // ---------------------------------------------------------------------------
  // the chrome
  // ---------------------------------------------------------------------------

  // The clock behind the rows, in state rather than a ref so it is made once
  // and can be reached from render; it is never replaced.
  const [chrome] = useState(() => new SimfarmChrome({ shown: recallSimfarmChrome() }));
  const [shown, setShown] = useState(chrome.isShown);
  useEffect(() => {
    const unsubscribe = chrome.subscribe((next) => {
      setShown(next);
      rememberSimfarmChrome(next);
    });
    return () => {
      unsubscribe();
      chrome.dispose();
    };
  }, [chrome]);
  // A list being read or a field being typed into holds the rows out.
  useEffect(() => chrome.hold(picking || typing), [chrome, picking, typing]);

  const transition = simfarmChromeTransition(reduceMotion);
  const presence = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    // `Never`, not `System`: the reduced-motion answer is the fade chosen
    // above, and the system setting must not turn that into a jump.
    presence.value = withTiming(
      shown ? 1 : 0,
      timing(transition.duration, { reduceMotion: ReduceMotion.Never })
    );
  }, [presence, shown, transition.duration]);
  const slide = transition.slide;
  const topReach = topBand + ROW_HEIGHT + ROW_GAP;
  const bottomReach = bottomBand + HANDLE_HIT_HEIGHT + ROW_HEIGHT + ROW_GAP;
  const topRowStyle = useAnimatedStyle(() => ({
    opacity: presence.value,
    transform: [{ translateY: slide ? (presence.value - 1) * topReach : 0 }],
  }));
  const bottomRowStyle = useAnimatedStyle(() => ({
    opacity: presence.value,
    transform: [{ translateY: slide ? (1 - presence.value) * bottomReach : 0 }],
  }));

  // ---------------------------------------------------------------------------
  // the picture
  // ---------------------------------------------------------------------------

  const screen = stream.screen;
  /**
   * The picture in points rather than pixels. Only the ratio matters to the
   * fit, but points are the units the numbers in the comments are in, and a
   * frame measured in the same units as the surface is one fewer thing to hold
   * in your head when a placement looks wrong.
   */
  const frame = useMemo(
    () =>
      screen === null
        ? null
        : { width: screen.width / screen.scale, height: screen.height / screen.scale },
    [screen]
  );

  /** The surface the picture is fitted to: everything under the top band. */
  const inner = useMemo(
    () => ({ width: viewport.width, height: Math.max(0, viewport.height - topBand) }),
    [topBand, viewport.height, viewport.width]
  );

  /**
   * In the stage's own coordinates, which are the ones a touch arrives in --
   * the fit is worked out against `inner` and then moved down by the band, so
   * the rectangle drawn into and the rectangle a finger is resolved against
   * are the same rectangle by construction.
   */
  const placement = useMemo(() => {
    if (frame === null || inner.height <= 0) return null;
    const placed = placeSimfarmFrame(
      frame,
      inner,
      zoom,
      offset ?? simfarmRestingOffset(frame, inner, zoom)
    );
    return { ...placed, y: placed.y + topBand };
  }, [frame, inner, offset, topBand, zoom]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport({ width, height });
  }, []);

  /**
   * How far in from the sides a touch may begin and still be an edge gesture
   * on the device. Android keeps the outermost strip of the screen for its
   * own back gesture, so there the device's edge starts past it -- the
   * reasoning is with `simfarmEdgeBands`.
   */
  const bands = useMemo(
    () => (placement === null ? undefined : simfarmEdgeBands(Platform.OS, placement.width)),
    [placement]
  );

  const forward = useCallback(
    (phase: SimfarmTouchPhase, x: number, y: number) => {
      if (placement === null) return;
      stream.touch({ phase, ...simfarmNormalizedPoint({ x, y }, placement), bands });
    },
    [bands, placement, stream]
  );

  /**
   * Hand the draft to the device and clear it.
   *
   * The device is a text sink and nothing comes back, so the only
   * acknowledgement worth giving is the field emptying and a tick of haptic --
   * an empty draft is not sent at all, because a zero-length text frame asks
   * the provider to type nothing.
   */
  const sendDraft = useCallback(() => {
    if (draft === '') return;
    chrome.touched();
    stream.type(draft);
    setDraft('');
    void feedback('success');
  }, [chrome, draft, stream]);

  /**
   * Show the row that was pressed: attach if it is running, start it if not.
   *
   * The second half is the defect this screen shipped with. Every row for a
   * device that was not running was disabled, and nothing here ever sent
   * simfarm's `boot` -- so a machine whose simulators were all shut down, which
   * is most machines most of the time, was a list nothing could be pressed on.
   * `select` decides which of the two it is; the stage only clears the view.
   */
  const select = useCallback(
    (deviceId: string) => {
      chrome.touched();
      setPicking(false);
      setZoom(1);
      setOffset(null);
      stream.select(deviceId);
    },
    [chrome, stream]
  );

  /**
   * Turn a row's device off. The picker stays open: the row is about to say
   * "shutting down" and then "not running", and that is the acknowledgement.
   */
  const shutdown = useCallback(
    (deviceId: string) => {
      chrome.touched();
      stream.shutdown(deviceId);
      void feedback('selection');
    },
    [chrome, stream]
  );

  /**
   * One finger is the device's, and it is forwarded verbatim.
   *
   * The raw touch callbacks rather than a pan's lifecycle, and that distinction
   * is the second half of the reported defect. `Gesture.Pan` reports `onStart`
   * on *activation*, and a press that never moves never activates -- so with a
   * pan every drag was forwarded and every tap was silently dropped, which on a
   * phone is almost every input there is. `onTouchesDown` / `Move` / `Up` fire
   * on the touches themselves, so a tap is a down and an up like it is on the
   * device, and `Gesture.Manual` is the one that never decides anything on its
   * own: this gesture means "pass it through", not "recognise something".
   *
   * Nothing here talks to the chrome. A touch on the picture is the device's
   * and only the device's -- `simfarm-chrome.ts` has the rule and the reason.
   */
  const drive = useMemo(
    () =>
      Gesture.Manual()
        .runOnJS(true)
        .onTouchesDown((event, manager) => {
          const touch = event.changedTouches[0];
          if (touch === undefined) return;
          if (event.numberOfTouches > 1) {
            // A second finger means the reader is moving the picture rather
            // than the device. End the touch the device is holding -- a finger
            // left down is a device that stops responding -- and let the pan
            // and the pinch have the rest of the gesture.
            forward(SIMFARM_TOUCH_PHASE.END, touch.x, touch.y);
            return;
          }
          manager.activate();
          forward(SIMFARM_TOUCH_PHASE.BEGIN, touch.x, touch.y);
        })
        .onTouchesMove((event) => {
          if (event.numberOfTouches !== 1) return;
          const touch = event.changedTouches[0];
          if (touch !== undefined) forward(SIMFARM_TOUCH_PHASE.MOVE, touch.x, touch.y);
        })
        .onTouchesUp((event, manager) => {
          const touch = event.changedTouches[0];
          if (touch !== undefined) forward(SIMFARM_TOUCH_PHASE.END, touch.x, touch.y);
          manager.end();
        })
        .onTouchesCancelled((event, manager) => {
          const touch = event.changedTouches[0];
          if (touch !== undefined) forward(SIMFARM_TOUCH_PHASE.END, touch.x, touch.y);
          manager.end();
        }),
    [forward]
  );

  /**
   * Two fingers are this app's: they move the picture, they are never sent.
   *
   * The split is the whole reason a drag can be forwarded at all. If panning
   * were one finger there would be no way to scroll the app under test, and if
   * it were a mode there would be a mode to be in the wrong one of.
   */
  const shift = useMemo(
    () =>
      Gesture.Pan()
        .minPointers(2)
        .runOnJS(true)
        .onChange((event) => {
          if (placement === null || frame === null) return;
          setOffset((current) => {
            const from = current ?? simfarmRestingOffset(frame, inner, zoom);
            return clampSimfarmOffset(placement, inner, {
              x: from.x + event.changeX,
              y: from.y + event.changeY,
            });
          });
        }),
    [frame, inner, placement, zoom]
  );

  const magnify = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onChange((event) => {
          setZoom((current) =>
            Math.min(SIMFARM_MAX_ZOOM, Math.max(SIMFARM_MIN_ZOOM, current * event.scaleChange))
          );
        }),
    []
  );

  const gesture = useMemo(
    () => Gesture.Simultaneous(drive, shift, magnify),
    [drive, magnify, shift]
  );

  // ---------------------------------------------------------------------------
  // the words
  // ---------------------------------------------------------------------------

  const buttons = useMemo(() => visibleButtons(stream.device), [stream.device]);
  /**
   * Inline rather than a helper taking `t`, which is the shape that looks
   * tidier and does not work: Lingui's macro only expands a tagged template
   * whose tag is the hook's own binding, so a `t` passed as an argument is left
   * alone, never extracted, and answers with an empty string at run time --
   * `i18n-audit.ts` exists because that has reached a screen before.
   */
  const buttonName = useCallback(
    (button: SimfarmButton): string => {
      if (button === 'back') return t`Back`;
      if (button === 'app_switch') return t`Switch apps`;
      if (button === 'lock') return t`Lock`;
      return t`Home`;
    },
    [t]
  );
  /**
   * What the pill says, which is the device the reader asked for and not only
   * the one a stream is open on.
   *
   * The two differ for as long as a boot or an attach takes, and for good once
   * either fails -- and a pill that named the wanted device with nothing after
   * it read as "attached" on a screen where nothing was drawn, which is the
   * report this came from. So the name is the wanted device's whenever there is
   * one, and next to it goes the one word that says why there is no picture.
   */
  const wantedDevice = useMemo(
    () => stream.devices.find((entry) => entry.id === stream.wanted) ?? null,
    [stream.devices, stream.wanted]
  );
  const name = stream.device?.name ?? wantedDevice?.name ?? t`Choose a simulator`;
  const hint =
    stream.status === 'booting'
      ? t`Starting…`
      : stream.status === 'attaching'
        ? t`Connecting`
        : stream.status !== 'live' && wantedDevice !== null && !wantedDevice.booted
          ? t`Not running`
          : null;
  /** The sentence for a failure; inline for the reason `buttonName` is. */
  const explain = useCallback(
    (error: SimfarmStreamError): string => {
      if (error.kind === 'boot-unsupported') {
        return t`That simulator cannot be started from here. Start it on the machine and it appears in the list.`;
      }
      if (error.kind === 'boot-timeout') return t`The simulator did not come up in time.`;
      if (error.kind === 'attach-failed') return t`The simulator could not be shown.`;
      if (error.kind === 'shutdown-failed') return t`The simulator could not be shut down.`;
      if (error.kind === 'shutdown-timeout') return t`The simulator did not shut down in time.`;
      return t`The simulator could not be started.`;
    },
    [t]
  );

  const closeButton =
    onClose && !embedded ? (
      <GlassChrome style={styles.iconButton}>
        <PressableScale
          accessibilityLabel={t`Close the simulator`}
          testID="simfarm-close"
          onPress={onClose}
          style={styles.iconButtonHit}>
          <X size={18} color={theme.colors.text} />
        </PressableScale>
      </GlassChrome>
    ) : null;

  if (stream.status === 'lost') {
    return (
      <View style={[styles.fill, styles.middle, { backgroundColor: theme.colors.background }]}>
        {/* The one way off this screen on iOS is the close button, so the
            state with no picture still draws one: the sheet this used to be
            could be swiped away, and a full-screen modal cannot. */}
        <View style={[styles.topRow, { top: topBand + ROW_GAP }]} pointerEvents="box-none">
          <View style={styles.pillSpace} />
          {closeButton}
        </View>
        <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centred}>
          {t`The connection to the simulator stopped.`}
        </Text>
        <PressableScale
          accessibilityRole="button"
          testID="simfarm-reconnect"
          onPress={onLost}
          style={[styles.reconnect, { backgroundColor: theme.colors.surfaceRaised }]}>
          <RefreshCw size={16} color={theme.colors.text} strokeWidth={2} />
          <Text variant="bodySmall">{t`Look again`}</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <View
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
      onLayout={onLayout}
      testID="simfarm-stage">
      <GestureDetector gesture={gesture}>
        {/* `opaque` because the frame covers the surface and a transparent
            canvas would composite it against the screen on every frame. What
            an opaque canvas does not do is paint: the pixels nothing draws
            into are whatever the layer held, which on the simulator is black
            and on a phone was the terminal underneath the sheet -- the
            see-through stage in the report. So the surface is painted here, in
            the theme's colour, before anything else is: the empty and booting
            states then sit on the same ground as every other screen, and a
            landscape picture's side bands are that ground rather than a hole. */}
        <Canvas style={styles.fill} opaque>
          <Fill color={theme.colors.background} />
          {stream.image !== null && placement !== null && screen !== null ? (
            <Group
              transform={[{ rotate: (screen.rotation * Math.PI) / 180 }]}
              origin={vec(placement.x + placement.width / 2, placement.y + placement.height / 2)}>
              <SkiaImage
                image={stream.image}
                // A quarter turn swaps what the decoded frame measures against
                // what the reader sees, so the rectangle drawn into is the
                // placement turned the same way. `screen.width/height` are
                // already the upright picture; the frames are not.
                x={
                  placement.x +
                  (screen.rotation % 180 === 0 ? 0 : (placement.width - placement.height) / 2)
                }
                y={
                  placement.y +
                  (screen.rotation % 180 === 0 ? 0 : (placement.height - placement.width) / 2)
                }
                width={screen.rotation % 180 === 0 ? placement.width : placement.height}
                height={screen.rotation % 180 === 0 ? placement.height : placement.width}
                fit="fill"
              />
            </Group>
          ) : null}
        </Canvas>
      </GestureDetector>

      {stream.image === null ? (
        <View style={styles.waiting} pointerEvents="none">
          {stream.error !== null ? (
            <>
              <Text
                variant="bodySmall"
                color={theme.colors.danger}
                style={styles.centred}
                testID="simfarm-error">
                {explain(stream.error)}
              </Text>
              {/* The server's own words, untranslated: `boot` reaches very
                  different machinery per backend, and the sentence above is the
                  same for all of them. */}
              {stream.error.detail !== null ? (
                <Text variant="label" color={theme.colors.textMuted} style={styles.centred}>
                  {stream.error.detail}
                </Text>
              ) : null}
            </>
          ) : stream.status === 'picking' ? (
            <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centred}>
              {t`Choose a simulator above.`}
            </Text>
          ) : stream.status === 'booting' ? (
            <>
              <Spinner size="sm" />
              <Text
                variant="bodySmall"
                color={theme.colors.textMuted}
                style={styles.centred}
                testID="simfarm-booting">
                {t`Starting ${name}`}
              </Text>
              <Text variant="label" color={theme.colors.textMuted} style={styles.centred}>
                {t`A simulator that was shut down can take a minute to come up.`}
              </Text>
            </>
          ) : (
            <Spinner size="sm" />
          )}
        </View>
      ) : null}

      {/* `box-none` while out, `none` while away: the rows are over the
          picture, so only the controls in them may take a touch, and a row
          that has slid off the screen may take none at all. Anything else here
          would be a strip of the device that silently ignores presses -- the
          defect this screen had. */}
      <Animated.View
        style={[styles.topRow, { top: topBand + ROW_GAP }, topRowStyle]}
        pointerEvents={shown ? 'box-none' : 'none'}
        testID="simfarm-chrome-top">
        <GlassChrome style={styles.pill}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Choose which simulator to show`}
            testID="simfarm-device"
            onPress={() => {
              chrome.touched();
              setPicking((open) => !open);
            }}
            style={styles.pillHit}>
            <Smartphone size={14} color={theme.colors.textMuted} strokeWidth={2} />
            <Text variant="bodySmall" numberOfLines={1} style={styles.pillLabel}>
              {name}
            </Text>
            {hint !== null ? (
              <Text variant="label" color={theme.colors.textMuted} testID="simfarm-device-state">
                {hint}
              </Text>
            ) : null}
            <ChevronDown size={14} color={theme.colors.textMuted} strokeWidth={2} />
          </PressableScale>
        </GlassChrome>
        {closeButton}
      </Animated.View>

      {picking && shown ? (
        <View style={[styles.picker, { top: topBand + ROW_GAP + ROW_HEIGHT + ROW_GAP }]}>
          {/* A solid card, not glass. This is a list of names to read and
              press, and what is under it is either a live picture or the
              empty ground; glass here is a material that has to sample the
              picture on every frame to draw a list that reads better without
              it -- and on the phone this was reported from, what it sampled
              was the terminal under the sheet, so the rows floated over
              Claude Code's output. The controls stay glass because they are
              small and the picture behind them is the point of them. */}
          <View
            style={[
              styles.pickerCard,
              { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border },
            ]}>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.pickerScroll}>
              {stream.devices.length === 0 ? (
                <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.pickerEmpty}>
                  {t`No simulators on that machine.`}
                </Text>
              ) : (
                stream.devices.map((entry) => {
                  const stopping = stream.stopping === entry.id;
                  return (
                    <PressableScale
                      key={entry.id}
                      accessibilityRole="button"
                      testID={`simfarm-device-${entry.id}`}
                      // A device that cannot be drawn is listed and refused
                      // rather than hidden: "my simulator is missing" is a
                      // worse screen than one that says which of them can be
                      // shown. One that is not running is neither: it is the
                      // row that starts it, and whether it can be started is
                      // the provider's answer, given after the press.
                      disabled={stopping || (entry.booted && !simfarmCanStream(entry))}
                      onPress={() => select(entry.id)}
                      style={styles.pickerRow}>
                      <Text
                        variant="bodySmall"
                        numberOfLines={1}
                        style={styles.pickerName}
                        color={
                          !entry.booted || simfarmCanStream(entry)
                            ? theme.colors.text
                            : theme.colors.textMuted
                        }>
                        {entry.name}
                      </Text>
                      <Text variant="label" color={theme.colors.textMuted}>
                        {stopping
                          ? t`Shutting down…`
                          : stream.status === 'booting' && stream.wanted === entry.id
                            ? t`Starting…`
                            : !entry.booted
                              ? t`Not running`
                              : simfarmCanStream(entry)
                                ? entry.kind
                                : t`No still frames`}
                      </Text>
                      {/* The other half of the row that starts a device: a
                          running one can be turned off from here, which is
                          what a machine with two simulators up and one wanted
                          needs. Trailing and small, so the row is still the
                          row that shows the device and the power glyph is
                          the exception to it. */}
                      {entry.booted && !stopping ? (
                        <PressableScale
                          accessibilityRole="button"
                          accessibilityLabel={t`Shut down ${entry.name}`}
                          testID={`simfarm-shutdown-${entry.id}`}
                          onPress={() => shutdown(entry.id)}
                          style={[styles.power, { backgroundColor: theme.colors.surface }]}>
                          <Power size={14} color={theme.colors.textMuted} strokeWidth={2} />
                        </PressableScale>
                      ) : stopping ? (
                        <View style={styles.power}>
                          <Spinner size="sm" />
                        </View>
                      ) : null}
                    </PressableScale>
                  );
                })
              )}
            </ScrollView>
            {/* A shutdown that failed while a picture is on screen has no
                other place to say so: the waiting area above draws the error
                only when there is nothing else to draw. */}
            {stream.error !== null && stream.image !== null ? (
              <View style={[styles.pickerFoot, { borderTopColor: theme.colors.border }]}>
                <Text
                  variant="label"
                  color={theme.colors.danger}
                  style={styles.centred}
                  testID="simfarm-picker-error">
                  {explain(stream.error)}
                </Text>
                {stream.error.detail !== null ? (
                  <Text variant="label" color={theme.colors.textMuted} style={styles.centred}>
                    {stream.error.detail}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <KeyboardStickyView
        style={[styles.bottom, { bottom: bottomBand + HANDLE_HIT_HEIGHT + ROW_GAP }]}
        offset={{ closed: 0, opened: bottomBand + HANDLE_HIT_HEIGHT }}>
        <Animated.View
          style={[styles.bottomRow, bottomRowStyle]}
          pointerEvents={shown ? 'box-none' : 'none'}
          testID="simfarm-chrome-bottom">
          {typing ? (
            <GlassChrome style={styles.composer}>
              {/* A field and a button, not a field alone. The return key
                  sends too, but on a phone that is a key some layouts spend
                  on a newline -- and a composer whose only way to send is a
                  key that might not be there is the same defect as a control
                  nobody can reach. */}
              <Input
                value={draft}
                onChangeText={setDraft}
                variant="outline"
                autoFocus
                returnKeyType="send"
                placeholder={t`Text to type on the simulator`}
                accessibilityLabel={t`Text to type on the simulator`}
                testID="simfarm-text"
                containerStyle={styles.composerField}
                onSubmitEditing={sendDraft}
              />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Send the text`}
                testID="simfarm-send"
                disabled={draft === ''}
                onPress={sendDraft}
                style={styles.send}>
                <SendHorizontal
                  size={18}
                  color={draft === '' ? theme.colors.textMuted : theme.colors.primary}
                  strokeWidth={2}
                />
              </PressableScale>
            </GlassChrome>
          ) : null}
          <View style={styles.keys} pointerEvents="box-none">
            {buttons.map((button) => (
              <GlassChrome key={button} style={styles.iconButton}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={buttonName(button)}
                  testID={`simfarm-button-${button}`}
                  onPress={() => {
                    chrome.touched();
                    stream.press(button);
                    void feedback('selection');
                  }}
                  style={styles.iconButtonHit}>
                  <ButtonGlyph button={button} color={theme.colors.text} />
                </PressableScale>
              </GlassChrome>
            ))}
            {stream.device?.capabilities.text ? (
              <GlassChrome style={styles.iconButton}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t`Type on the simulator`}
                  testID="simfarm-typing"
                  onPress={() => {
                    chrome.touched();
                    setTyping((open) => !open);
                  }}
                  style={styles.iconButtonHit}>
                  <KeyboardIcon
                    size={18}
                    color={typing ? theme.colors.primary : theme.colors.text}
                    strokeWidth={2}
                  />
                </PressableScale>
              </GlassChrome>
            ) : null}
          </View>
        </Animated.View>
      </KeyboardStickyView>

      {/* The handles: the only two things on the picture that are not the
          device. One in each band, both always there, either toggles both
          rows -- `simfarm-chrome.ts` has the rule. The top one sits at the
          bottom of its band, clear of the camera cutout the band exists for;
          the bottom one sits just above the home indicator. */}
      <Handle
        edge="top"
        at={topBand - HANDLE_HIT_HEIGHT}
        shown={shown}
        onPress={() => chrome.toggle()}
      />
      <Handle edge="bottom" at={bottomBand} shown={shown} onPress={() => chrome.toggle()} />
    </View>
  );
}

/**
 * The slim bar that shows or hides the chrome.
 *
 * Drawn as a grabber -- the shape every sheet in the app already teaches means
 * "this moves" -- and pressed rather than dragged, because a drag over the
 * picture would be a drag the device did not get. The hit area is wider and
 * taller than the bar so it can be found without looking; it is still the
 * width of a thumb, not the width of the screen, so a tap at the top of the
 * picture that was meant for the app under test is not caught by it.
 */
function Handle({
  edge,
  at,
  shown,
  onPress,
}: {
  edge: 'top' | 'bottom';
  /** Distance from that edge to the hit area's own near side. */
  at: number;
  shown: boolean;
  onPress: () => void;
}) {
  const theme = useThemeTokens();
  const { t } = useLingui();
  return (
    <View
      style={[styles.handleBand, edge === 'top' ? { top: at } : { bottom: at }]}
      pointerEvents="box-none">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={shown ? t`Hide the controls` : t`Show the controls`}
        testID={`simfarm-handle-${edge}`}
        onPress={onPress}
        style={[styles.handleHit, edge === 'top' ? styles.handleHitTop : styles.handleHitBottom]}>
        <GlassChrome style={styles.handleBar}>
          <View style={[styles.handleInk, { backgroundColor: theme.colors.text }]} />
        </GlassChrome>
      </PressableScale>
    </View>
  );
}

/**
 * The keys worth a place on a phone, in the order a hand expects them.
 *
 * Only what the device declared -- the three backends differ a great deal and a
 * key that does nothing is worse than a key that is not there -- and only the
 * navigation ones. Volume and the ringer switch are real capabilities and would
 * be six more circles over the picture for the sake of a case nobody previews.
 */
const OFFERED_BUTTONS: SimfarmButton[] = ['home', 'back', 'app_switch', 'lock'];

function visibleButtons(device: SimfarmDevice | null): SimfarmButton[] {
  if (device === null) return [];
  return OFFERED_BUTTONS.filter((button) => device.capabilities.buttons.includes(button));
}

function ButtonGlyph({ button, color }: { button: SimfarmButton; color: string }) {
  const size = 18;
  const width = 2;
  if (button === 'back') return <ArrowLeft size={size} color={color} strokeWidth={width} />;
  if (button === 'app_switch') return <SquareStack size={size} color={color} strokeWidth={width} />;
  if (button === 'lock') return <Lock size={size} color={color} strokeWidth={width} />;
  return <House size={size} color={color} strokeWidth={width} />;
}

/**
 * The least a band at either end of the picture may be.
 *
 * The handle's hit area, and no more: on a screen with no camera cutout and
 * the status bar hidden, the top inset is zero, and a handle at a zero inset
 * is a handle off the top of the screen.
 */
const HANDLE_BAND = 22;
/** The handle's hit area; the bar inside it is `handleBar` below. */
const HANDLE_HIT_HEIGHT = 22;
const HANDLE_HIT_WIDTH = 72;
/** A row of 38pt circles, and the gap between a row and whatever it is next to. */
const ROW_HEIGHT = 38;
const ROW_GAP = 8;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  middle: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  centred: { textAlign: 'center' },
  waiting: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  reconnect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  topRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: ROW_GAP,
    paddingHorizontal: 12,
  },
  // Where the pill would be, so the close button in the lost state is where
  // it is everywhere else.
  pillSpace: { flex: 1 },
  pill: {
    flexShrink: 1,
    borderRadius: ROW_HEIGHT / 2,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  pillHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: ROW_HEIGHT,
    paddingHorizontal: 14,
  },
  pillLabel: { flexShrink: 1 },
  iconButton: {
    width: ROW_HEIGHT,
    height: ROW_HEIGHT,
    borderRadius: ROW_HEIGHT / 2,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonHit: {
    width: ROW_HEIGHT,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  picker: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  pickerCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  pickerScroll: { maxHeight: 260 },
  pickerEmpty: { padding: 14, textAlign: 'center' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
  },
  pickerName: { flex: 1, minWidth: 0 },
  power: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerFoot: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bottomRow: { alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '92%',
    maxWidth: 420,
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 4,
  },
  composerField: { flex: 1, minWidth: 0 },
  send: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  keys: { flexDirection: 'row', alignItems: 'center', gap: ROW_GAP },
  handleBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HANDLE_HIT_HEIGHT,
    alignItems: 'center',
  },
  handleHit: {
    width: HANDLE_HIT_WIDTH,
    height: HANDLE_HIT_HEIGHT,
    alignItems: 'center',
  },
  // The bar keeps to the lower side of its band: at the top that is the
  // picture's edge, away from the camera cutout; at the bottom it is just
  // above the home indicator, where a grabber is expected to be.
  handleHitTop: { justifyContent: 'flex-end', paddingBottom: 3 },
  handleHitBottom: { justifyContent: 'flex-end', paddingBottom: 3 },
  handleBar: {
    width: 36,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleInk: { width: 28, height: 2, borderRadius: 1, opacity: 0.55 },
});
