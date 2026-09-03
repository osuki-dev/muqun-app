import { useLingui } from '@lingui/react/macro';
import { Button, Text, useThemeTokens } from '@osuki-dev/ui';
import { CameraOff, ScanLine } from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  useCameraDevice,
  useCameraDevices,
  useCameraPermission,
  VisionCamera,
} from 'react-native-vision-camera';

import { LogoLoader } from '@/components/logo-loader';
import { PressableScale } from '@/components/pressable-scale';
import { QrCamera, qrCameraSupport } from '@/components/qr-camera';
import { fadeIn, fadeOut } from '@/lib/motion';
import {
  isAimingReading,
  LENS_PUBLISH_GRACE_MS,
  LENS_SETTLE_MS,
  pairingLensReading,
  pairingScanFault,
  pairingScanReading,
  PREVIEW_START_TIMEOUT_MS,
  type ScanReading,
  type ScanReadingInput,
} from '@/lib/pairing-scan';

/**
 * Camera-only half of pairing.
 *
 * Kept behind React.lazy in the route so importing the home route does not
 * initialize CameraX. Some tablets legitimately expose only one lens; CameraX
 * validates both when its native module starts and retries for several seconds
 * when the other lens is absent. That work belongs to the scanner, not app
 * startup.
 *
 * It draws nothing outside the aperture it is mounted in, and nothing dark: the
 * only near-black on this screen is the camera's own pixels, which arrive with
 * the preview and leave with it. Everything this component draws when there is
 * no preview -- no permission, no lens, a lens that failed -- is drawn in theme
 * tokens on the aperture's own ground, because a scan screen that hardcodes one
 * pack's dark is a hole in the other thirty-one.
 */
/**
 * One device-factory promise for the life of this chunk.
 *
 * vision-camera's own hooks cache exactly one of these, and the aperture has to
 * match that: it is unmounted every time the reader switches to typing an
 * address and remounted when they come back, and building a native device
 * factory on each of those is work nobody asked for. Memoised rather than
 * created at import so a screen that never opens the camera never pays for one.
 */
let deviceFactoryReady: Promise<unknown> | null = null;

function whenLensesEnumerated(): Promise<unknown> {
  // Swallowed here and re-handled per caller: an unhandled rejection on a
  // module-scope promise is a red box, and a factory that failed still answers
  // the only question being asked of it, which is "has it stopped pending".
  deviceFactoryReady ??= VisionCamera.createDeviceFactory().catch(() => undefined);
  return deviceFactoryReady;
}

export default function PairingCamera({
  active,
  error,
  knownUnavailable,
  onError,
  onReading,
  onScanned,
}: {
  active: boolean;
  error: string | null;
  /**
   * The route already watched this device fail to produce a lens.
   *
   * This component is unmounted while the reader is typing an address and
   * remounted when they come back, so without this it re-runs its whole warm-up
   * every time: seconds of a loader before re-announcing a fact it established
   * before the reader ever left. A lens does not appear while someone fills in
   * a form.
   *
   * It seeds the settle clock and nothing else. It used to seed the preview
   * timeout too, which turned one bad verdict into a permanent one: the route
   * fed `unavailable` back in, the remount started already-failed, and no
   * amount of coming back could re-derive a lens that had been there all along.
   */
  knownUnavailable: boolean;
  onError: (message: string) => void;
  /**
   * What the aperture is reading, hoisted to the route. The route owns the
   * frame, the copy and the mode toggle, and all three change with this -- but
   * the permission and device facts only exist inside this lazily loaded chunk,
   * so the reading is derived here and handed up.
   */
  onReading: (reading: ScanReading) => void;
  onScanned: (value: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { hasPermission, requestPermission } = useCameraPermission();
  const requestedPermission = useRef(false);
  const backDevice = useCameraDevice('back');
  const frontDevice = useCameraDevice('front');
  /**
   * The whole enumerated list, for the one thing a single device cannot say.
   *
   * `useCameraDevice` collapses "the factory has not answered" and "there is no
   * such lens" into the same `undefined`, so a device that is merely slow is
   * indistinguishable from a device that has nothing. A list with anything in
   * it is positive proof the enumeration finished, which is what lets the
   * reading resolve on evidence instead of on a stopwatch.
   */
  const devices = useCameraDevices();
  const lensCount = devices.length;
  const [lensSettled, setLensSettled] = useState(knownUnavailable);
  /**
   * The preview has pixels in it.
   *
   * This is the other half of the black flash, and the half that survived
   * getting rid of the near-black shell. A native preview is a `SurfaceView`:
   * mounting it punches a hole through the window, and until CameraX delivers
   * its first frame that hole composites as pure black. Coming back from manual
   * entry therefore dropped a full-size black rectangle into a light page for
   * about a sixth of a second, no matter what colour anything in React was.
   *
   * So the aperture keeps its own surface over the camera until this is true.
   * Reset whenever the camera stops, because the next start draws the same
   * empty surface again.
   */
  const [firstFrame, setFirstFrame] = useState(false);
  /**
   * The preview was given its chance and did not take it.
   *
   * Without this the shutter is a promise the camera does not always keep: an
   * emulator with a stubbed lens, and a real camera the OS hands to another app,
   * both mount cleanly and then never deliver a frame. The aperture would sit
   * behind its own shutter forever, which is a blank rectangle that says nothing
   * -- the worst of the states this whole card exists to get rid of.
   */
  const [previewLate, setPreviewLate] = useState(false);

  /**
   * Where this platform's scanner cannot report a first frame there is nothing
   * to wait for, so the wait is over before it starts. Android's `CodeScanner`
   * never forwards the callback, which used to leave the shutter down forever
   * and the timeout below guaranteed to fire on hardware that was working.
   */
  const previewStarted = firstFrame || !qrCameraSupport.reportsFirstFrame;

  const lens = pairingLensReading({
    hasBackLens: Boolean(backDevice),
    // Only a front lens this platform can actually be pointed at counts; where
    // it cannot, offering it would mount a scanner that throws on mount.
    hasFrontLens: Boolean(frontDevice) && qrCameraSupport.lensPositions.includes('front'),
    lensCount,
    settled: lensSettled,
  });

  // Only the facts this chunk owns. Whether a code is in frame and whether a
  // request is in flight belong to the route, which folds them in over the top.
  const scanInput: ScanReadingInput = {
    isWeb: Platform.OS === 'web',
    hasPermission,
    lens,
    cameraError: Boolean(error),
    previewTimedOut: previewLate && !previewStarted,
    detected: false,
    busy: false,
    rejected: false,
  };
  const reading = pairingScanReading(scanInput);
  const fault = pairingScanFault(scanInput);

  /**
   * The numbers behind the sentence, for a screen nobody here can plug in.
   *
   * Not translated, and not prose, on purpose. This is a reading to be relayed
   * verbatim -- photographed, or typed into an issue -- and a translated one
   * arrives in a language the person reading the report cannot search for. It
   * is closer to a stack trace than to copy. Kept behind a tap on the glyph
   * because a working scan must never show it and a broken one must not lead
   * with it: the reader needs the sentence, we need the numbers.
   *
   * `positions` is the load-bearing one. This app opens the camera through two
   * unrelated stacks -- vision-camera drives the scanner in-process, while an
   * attachment photo hands off to the system camera app through
   * `expo-image-picker` -- so a device can take pictures perfectly well and
   * still tell the scanner it has no lenses. Only what vision-camera itself
   * enumerated can settle which of those is happening, and one screenshot of
   * this line answers it.
   */
  const diagnostic = [
    `lens=${lens}`,
    `lenses=${lensCount}`,
    `positions=${devices.map((candidate) => candidate.position).join(',') || '-'}`,
    `permission=${hasPermission ? 'granted' : 'denied'}`,
    `preview=${previewStarted ? 'started' : previewLate ? 'timeout' : 'waiting'}`,
    `os=${Platform.OS}`,
  ].join(' ');

  /**
   * A camera is mounted right now, which is the only condition under which a
   * first frame can be overdue.
   *
   * The lens has to be resolved and pointable and the permission granted before
   * anything is asked to produce a picture. Deriving this from the same facts
   * the reading uses, rather than from `active` alone, is the fix: the old clock
   * ran from the moment the screen appeared, so a reader who spent three
   * seconds on the permission dialog had already spent the sensor's budget and
   * was told the device has no rear camera the instant they tapped Allow.
   */
  const cameraMounted = isAimingReading(reading);

  useEffect(() => {
    if (!active) {
      setFirstFrame(false);
      setPreviewLate(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active || !cameraMounted || previewStarted) return;
    const timeout = setTimeout(() => setPreviewLate(true), PREVIEW_START_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [active, cameraMounted, previewStarted]);

  useEffect(() => {
    if (Platform.OS === 'web' || hasPermission || requestedPermission.current) return;
    requestedPermission.current = true;
    void requestPermission();
  }, [hasPermission, requestPermission]);

  /**
   * The exact moment an empty list stops meaning "not yet".
   *
   * `useCameraDevice` yields `undefined` until vision-camera has built its
   * device factory, and that factory is a promise. Awaiting the same promise
   * turns the one genuinely ambiguous case -- an empty list -- from a guess
   * into a fact, which matters because the guess was wrong in the direction
   * that prints "no camera" at someone holding a working one. Measured on an
   * emulator taking over four seconds to resolve it, long enough that a clock
   * tuned to the enumeration flashed a dead end before recovering.
   */
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    let publish: ReturnType<typeof setTimeout>;
    const enumerated = () => {
      // The factory awaited here is not the instance `useCameraDevices` reads,
      // so its answer can land a beat before that store publishes. Without this
      // grace the two race, and the prize for losing is announcing an empty
      // list as an empty device -- the exact wrong answer this card is about.
      publish = setTimeout(() => {
        if (!cancelled) setLensSettled(true);
      }, LENS_PUBLISH_GRACE_MS);
    };
    // A factory that rejects has still stopped being pending, and leaving the
    // aperture warming forever is the one outcome worse than a wrong verdict.
    void whenLensesEnumerated().then(enumerated);
    return () => {
      cancelled = true;
      clearTimeout(publish);
    };
  }, []);

  /**
   * The backstop, for a promise that neither resolves nor rejects. Generous
   * because it is no longer the mechanism -- only the thing that keeps a hung
   * bridge from leaving the reader watching a spinner with no way out.
   */
  useEffect(() => {
    if (!hasPermission || lensCount > 0) return;
    const timeout = setTimeout(() => setLensSettled(true), LENS_SETTLE_MS);
    return () => clearTimeout(timeout);
  }, [hasPermission, lensCount]);

  // What the route is told, which is not always what this component mounts: the
  // camera is mounted the moment it can be, but until the shutter lifts there is
  // nothing to aim at, and the route's white reticle and "align the QR" caption
  // are drawn for camera pixels. On the aperture's own light surface they would
  // be invisible ink over an empty frame.
  const reportedReading = cameraMounted && !previewStarted ? 'warming' : reading;

  useEffect(() => {
    onReading(reportedReading);
  }, [onReading, reportedReading]);

  const content = cameraMounted ? (
    <>
      <QrCamera
        active={active}
        position={reading === 'aiming-front' ? 'front' : 'back'}
        onScanned={onScanned}
        onPreviewStarted={() => setFirstFrame(true)}
        onError={(cameraFailure) => onError(cameraFailure.message)}
      />
      {/* The shutter. It is the aperture's own surface, held over the empty
            preview and lifted the moment there is something behind it, so the
            camera opens by revealing an image rather than by cutting a black
            hole in the page and filling it in afterwards. */}
      {previewStarted ? null : (
        <Animated.View
          exiting={fadeOut('short')}
          style={[styles.state, { backgroundColor: theme.colors.surfaceRaised }]}>
          <LogoLoader accessibilityLabel={t`Starting the camera`} size={44} />
        </Animated.View>
      )}
    </>
  ) : reading === 'warming' ? (
    // The app's own breath, not a spinner and not nothing. An empty frame was
    // honest about the lens and useless to the reader: on a device where the
    // enumeration is slow it is indistinguishable from a screen that has
    // given up. This says the same thing the live status dot says -- it is on,
    // and it is working on it.
    <View style={styles.state}>
      <LogoLoader accessibilityLabel={t`Starting the camera`} size={44} />
    </View>
  ) : reading === 'permission' ? (
    <ApertureState
      icon={<ScanLine size={26} color={theme.colors.textMuted} strokeWidth={1.8} />}
      title={t`Camera access needed`}
      detail={t`Muqun reads the Gateway's QR code through the camera. Nothing is recorded.`}
      action={t`Allow camera`}
      onAction={() => void requestPermission()}
    />
  ) : (
    <ApertureState
      icon={<CameraOff size={26} color={theme.colors.textMuted} strokeWidth={1.8} />}
      title={
        fault === 'preview-never-started' ? t`The camera did not start` : t`No camera to scan with`
      }
      // The reason, and only the reason. What to do about it is the header's
      // line, and printing "type the address instead" in both places put the
      // same sentence on screen twice, 500pt apart.
      //
      // Which reason, though, is the whole point: "this device has no rear
      // camera" was printed for a lens that was still enumerating, a lens the
      // app had not been allowed to open and a preview that never woke up, on
      // hardware nobody here can plug in. A wrong reason is worse than none,
      // because it sends the reader to check the one thing that is fine.
      detail={
        fault === 'camera-error'
          ? (error ?? t`The camera reported an error.`)
          : fault === 'preview-never-started'
            ? t`It was found, but never showed a picture. Another app may be holding it.`
            : fault === 'web'
              ? t`Scanning needs a camera, which this browser does not offer.`
              : t`No camera was found on this device.`
      }
      diagnostic={diagnostic}
    />
  );

  return (
    <Animated.View
      key={cameraMounted ? 'camera' : reading}
      style={StyleSheet.absoluteFill}
      entering={fadeIn('short')}
      exiting={fadeOut('micro')}>
      {content}
    </Animated.View>
  );
}

/**
 * One reading of an aperture with no pixels in it.
 *
 * No fill of its own: the aperture the route draws is already the surface, and
 * a second panel inside it was what made the old fallback read as a black card
 * inside a black card.
 */
function ApertureState({
  icon,
  title,
  detail,
  action,
  onAction,
  diagnostic,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: string;
  onAction?: () => void;
  /** Raw lens facts, revealed by tapping the glyph. Never shown unprompted. */
  diagnostic?: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [showsDiagnostic, setShowsDiagnostic] = useState(false);
  return (
    <View style={styles.state}>
      {diagnostic ? (
        <PressableScale
          accessibilityLabel={t`Show camera details`}
          testID="pairing-camera-diagnostic"
          onPress={() => setShowsDiagnostic((shown) => !shown)}>
          {icon}
        </PressableScale>
      ) : (
        icon
      )}
      <View style={styles.stateCopy}>
        <Text variant="label" color={theme.colors.textMuted}>
          {title}
        </Text>
        {detail ? (
          <Text variant="bodySmall" color={theme.colors.textSubtle} style={styles.stateDetail}>
            {detail}
          </Text>
        ) : null}
        {diagnostic && showsDiagnostic ? (
          <Text variant="caption" color={theme.colors.textSubtle} style={styles.stateDetail}>
            {diagnostic}
          </Text>
        ) : null}
      </View>
      {action && onAction ? (
        <Button variant="secondary" onPress={onAction}>
          {action}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  state: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 28,
  },
  stateCopy: {
    alignItems: 'center',
    gap: 6,
  },
  stateDetail: {
    maxWidth: 300,
    textAlign: 'center',
    lineHeight: 20,
  },
});
