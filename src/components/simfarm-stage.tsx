import { useLingui } from '@lingui/react/macro';
import { Input, Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Canvas, Group, Image as SkiaImage, vec } from '@shopify/react-native-skia';
import {
  ArrowLeft,
  ChevronDown,
  House,
  Keyboard as KeyboardIcon,
  Lock,
  RefreshCw,
  SendHorizontal,
  Smartphone,
  SquareStack,
  X,
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { feedback } from '@/lib/feedback';
import { simfarmCanStream, type SimfarmDevice } from '@/lib/simfarm';
import {
  clampSimfarmOffset,
  placeSimfarmFrame,
  simfarmNormalizedPoint,
  SIMFARM_MAX_ZOOM,
  SIMFARM_MIN_ZOOM,
  type SimfarmPoint,
} from '@/lib/simfarm-frame';
import {
  SIMFARM_TOUCH_PHASE,
  type SimfarmButton,
  type SimfarmTouchPhase,
} from '@/lib/simfarm-protocol';
import { useSimfarmStream } from '@/lib/simfarm-stream';

/**
 * The picture, and everything a finger can do to it.
 *
 * Kept out of `simfarm-preview.tsx` because the two have nothing in common: that
 * file decides *whether* there is a simulator to show and draws four states
 * saying so, and this one has exactly one job once the answer is yes. Putting
 * them together meant a component where the empty states and a live video
 * stream shared a render.
 *
 * ## The picture fills the surface, and nothing sits in a bar
 *
 * The fit rule is in `simfarm-frame.ts` with the reasoning; what belongs here is
 * the consequence. There is no header, no footer and no reserved column: the
 * controls float over the picture in the corners, so a device drawn at the full
 * width of the screen loses nothing to chrome. What that costs is that a phone
 * taller than the surface hangs over both ends, which is what the two-finger
 * drag is for.
 *
 * ## Why the controls start below the top of the sheet
 *
 * Because this is presented as a form sheet, and iOS puts a grabber across the
 * top of one with a hit area far larger than the bar it draws. simfarm's own
 * client floats its device picker 14pt from the top of the window, and on a
 * sheet that is underneath the grabber: every press on it was read as the start
 * of a drag, so the one control needed to choose a device could not be reached
 * at all. `CHROME_INSET` is that clearance, and it is the reason this screen has
 * no control in its first 40pt on iOS.
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
  const stream = useSimfarmStream(url, devices);

  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<SimfarmPoint>({ x: 0, y: 0 });
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

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

  const placement = useMemo(
    () => (frame === null ? null : placeSimfarmFrame(frame, viewport, zoom, offset)),
    [frame, offset, viewport, zoom]
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport({ width, height });
  }, []);

  const forward = useCallback(
    (phase: SimfarmTouchPhase, x: number, y: number) => {
      if (placement === null) return;
      stream.touch({ phase, ...simfarmNormalizedPoint({ x, y }, placement) });
    },
    [placement, stream]
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
    stream.type(draft);
    setDraft('');
    void feedback('success');
  }, [draft, stream]);

  const attach = useCallback(
    (deviceId: string) => {
      setPicking(false);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      stream.attach(deviceId);
    },
    [stream]
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
          if (placement === null) return;
          setOffset((current) =>
            clampSimfarmOffset(placement, viewport, {
              x: current.x + event.changeX,
              y: current.y + event.changeY,
            })
          );
        }),
    [placement, viewport]
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
  const name = stream.device?.name ?? t`Choose a simulator`;

  if (stream.status === 'lost') {
    return (
      <View style={[styles.fill, styles.middle, { backgroundColor: theme.colors.background }]}>
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
            canvas would composite it against the sheet on every frame. */}
        <Canvas style={styles.fill} opaque>
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
          {stream.status === 'picking' ? (
            <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centred}>
              {t`Choose a simulator above.`}
            </Text>
          ) : (
            <Spinner size="sm" />
          )}
        </View>
      ) : null}

      {/* `box-none`: the bar is over the picture, so only the controls in it
          may take a touch. Anything else here would be a strip of the device
          that silently ignores presses -- the defect this screen had. */}
      <View style={[styles.topBar, { paddingTop: CHROME_INSET }]} pointerEvents="box-none">
        <GlassChrome style={styles.pill}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Choose which simulator to show`}
            testID="simfarm-device"
            onPress={() => setPicking((open) => !open)}
            style={styles.pillHit}>
            <Smartphone size={14} color={theme.colors.textMuted} strokeWidth={2} />
            <Text variant="bodySmall" numberOfLines={1} style={styles.pillLabel}>
              {name}
            </Text>
            <ChevronDown size={14} color={theme.colors.textMuted} strokeWidth={2} />
          </PressableScale>
        </GlassChrome>
        {onClose && !embedded ? (
          <GlassChrome style={styles.iconButton}>
            <PressableScale
              accessibilityLabel={t`Close the simulator`}
              testID="simfarm-close"
              onPress={onClose}
              style={styles.iconButtonHit}>
              <X size={18} color={theme.colors.text} />
            </PressableScale>
          </GlassChrome>
        ) : null}
      </View>

      {picking ? (
        <View style={[styles.picker, { top: CHROME_INSET + 46 }]}>
          <GlassChrome style={styles.pickerCard}>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.pickerScroll}>
              {stream.devices.length === 0 ? (
                <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.pickerEmpty}>
                  {t`Nothing is booted on that machine.`}
                </Text>
              ) : (
                stream.devices.map((entry) => (
                  <PressableScale
                    key={entry.id}
                    accessibilityRole="button"
                    testID={`simfarm-device-${entry.id}`}
                    // A device that cannot be drawn is listed and refused
                    // rather than hidden: "my simulator is missing" is a worse
                    // screen than one that says which of them can be shown.
                    disabled={!entry.booted || !simfarmCanStream(entry)}
                    onPress={() => attach(entry.id)}
                    style={styles.pickerRow}>
                    <Text
                      variant="bodySmall"
                      numberOfLines={1}
                      color={
                        entry.booted && simfarmCanStream(entry)
                          ? theme.colors.text
                          : theme.colors.textMuted
                      }>
                      {entry.name}
                    </Text>
                    <Text variant="label" color={theme.colors.textMuted}>
                      {!entry.booted
                        ? t`Not running`
                        : simfarmCanStream(entry)
                          ? entry.kind
                          : t`No still frames`}
                    </Text>
                  </PressableScale>
                ))
              )}
            </ScrollView>
          </GlassChrome>
        </View>
      ) : null}

      <KeyboardStickyView style={styles.bottom}>
        {typing ? (
          <GlassChrome style={styles.composer}>
            {/* A field and a button, not a field alone. The return key sends
                too, but on a phone that is a key some layouts spend on a
                newline -- and a composer whose only way to send is a key that
                might not be there is the same defect as a control nobody can
                reach. */}
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
                onPress={() => setTyping((open) => !open)}
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
      </KeyboardStickyView>
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
 * How far down the first control may sit.
 *
 * iOS draws the sheet's grabber across the top and takes presses for a good way
 * below it; 40pt clears it. Nothing else needs the clearance, so nothing else
 * pays for it.
 */
const CHROME_INSET = Platform.OS === 'ios' ? 40 : 12;

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
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  pill: {
    flexShrink: 1,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  pillHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
  },
  pillLabel: { flexShrink: 1 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonHit: {
    width: 38,
    height: 38,
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
    overflow: 'hidden',
  },
  pickerScroll: { maxHeight: 260 },
  pickerEmpty: { padding: 14, textAlign: 'center' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 16,
    alignItems: 'center',
    gap: 10,
  },
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
  keys: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
