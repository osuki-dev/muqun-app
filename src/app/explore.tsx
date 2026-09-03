import { Trans, useLingui } from '@lingui/react/macro';
import { Button, Card, Input, Text, useThemeTokens } from '@osuki-dev/ui';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import { type Href, useRouter } from 'expo-router';
import {
  Check,
  Copy as CopyIcon,
  Keyboard as KeyboardIcon,
  ScanLine,
  Waypoints,
  X,
} from 'lucide-react-native';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Keyboard,
  Linking,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoLoader } from '@/components/logo-loader';
import { SshConnectPromptGate } from '@/components/ssh-connect-prompt-gate';
import { PressableScale } from '@/components/pressable-scale';
import { GATEWAY_INSTALL_COMMAND, GATEWAY_SETUP_URL } from '@/constants/links';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { GATEWAY_DEFAULT_PORT } from '@/lib/ssh-tunnel';
import { sortSshHosts, sshHostAddress } from '@/lib/ssh-hosts';
import { useSshHostsStore } from '@/stores/ssh-hosts';
import { useSshTunnelsStore } from '@/stores/ssh-tunnels';
import { beginPairingTransaction, claimPairingTransaction } from '@/lib/pairing-transaction';
import {
  normalizeGatewayUrl,
  DEMO_PAIRING_SERVER_ID,
  isDemoPairingOffer,
  normalizePairingCode,
  PAIRING_CODE_CHARACTER_COUNT,
  PAIRING_CODE_LENGTH,
  parsePairingOffer,
  type PairingOffer,
  type ResolvedPairingOffer,
} from '@/lib/pairing';
import { feedback } from '@/lib/feedback';
import {
  fadeIn,
  fadeInLeft,
  fadeInRight,
  fadeOut,
  listLayout,
  PULSE_PERIOD,
  timing,
  zoomIn,
} from '@/lib/motion';
import { describeGatewayFailure } from '@/lib/network-error';
import {
  pairingApertureSize,
  pairingScanPresentation,
  pairingScanReadingWithRequest,
  COPIED_HOLD_MS,
  SCAN_REJECT_HOLD_MS,
  type ScanReading,
} from '@/lib/pairing-scan';

type Step = 'scan' | 'confirm' | 'success';

/**
 * The aperture: one square, in one place, for the whole of the scan step.
 *
 * It is the same mark the home screen's empty card draws at 64pt and the home
 * header draws at 20pt -- four corner brackets around a square the size of a QR
 * code -- promoted here to the size a phone is actually held at. That is the
 * whole of the visual identity this flow needs, and it is why nothing else on
 * the screen has a frame.
 *
 * Crucially it is a *slot*, not a viewfinder: it accepts either light or
 * letters. Switching to manual entry does not replace it, it changes what it
 * takes. The ground never changes colour, which is what the mode switch used to
 * do -- a `#06101B` slab dissolving over a cream page while a white card faded
 * in under it, which the owner reported as a black flash.
 *
 * `pairingApertureSize` keeps it square at every width. See that function for
 * why a wide window gets a bigger square rather than a wider rectangle.
 */

/**
 * The column the whole route sits in.
 *
 * One number, because the header, the aperture and the toggle are one
 * instrument and a reader should be able to draw a straight line down their
 * left edges. There used to be three -- 960 for the scroll content, 840 for the
 * step, 760 for the scanner -- so on a tablet the title floated 80pt to the left
 * of the frame it was titling.
 */
const ROUTE_MEASURE = 560;

/** The route's horizontal inset, shared by the scroll content and the frame. */
const ROUTE_GUTTER = 20;

const PairingCamera = lazy(() => import('@/components/pairing-camera'));

/**
 * How far the reticle fades at the bottom of a breath, and how far it closes in
 * when a code is found.
 *
 * Both are small on purpose. The reticle sits over a live camera preview that
 * the reader is aiming, so it has to stay legible as a frame throughout: this is
 * a sign of life and then an acknowledgement, not something asking to be
 * watched. The inset is a single timed move rather than a spring, per the design
 * system.
 */
const RETICLE_BREATH_DEPTH = 0.45;
const RETICLE_CONFIRM_INSET = 0.06;

/**
 * The one colour on this screen that is not a theme token, and the reason it is
 * allowed to exist.
 *
 * Everything else here sits on a surface the theme owns, so the theme decides
 * what reads against it -- across thirty-two packs in both polarities. This ink
 * sits on a live camera image, which is neither a surface nor something this app
 * chose, so no token can promise it any contrast at all. White on the preview's
 * own scrim is what a viewfinder overlay has always been, and it is deliberately
 * scoped to the pixels: nothing drawn on an app surface may use it.
 */
const OVER_PREVIEW_INK = '#FFFFFF';

export default function PairModal() {
  // `t` from the hook, never the global `t` from `@lingui/core/macro`: React
  // Compiler memoizes a global `t` call whose arguments have not changed and
  // has no way to know the result also depends on the active locale.
  const { t } = useLingui();
  const theme = useThemeTokens();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { setRecord, enterDemo } = useGatewayRecord();
  const handledScan = useRef(false);
  // A failed scan must not re-fire instantly: the same QR is still in frame, so
  // resetting the guard immediately looped scan→fail→scan and flickered the UI.
  const scanBlockedUntil = useRef(0);
  const [step, setStep] = useState<Step>('scan');
  /**
   * Whether the install command was just copied, which is the only
   * acknowledgement the copy gets.
   *
   * A clipboard write is invisible: without this the button answers a press by
   * looking exactly as it did before it, and the reader presses it again. The
   * flag is held rather than derived because there is nothing to derive it
   * from -- the clipboard is not readable state, and asking for it back to
   * confirm a write we just made would be a permission prompt on iOS.
   */
  const [copiedInstall, setCopiedInstall] = useState(false);
  // Held so a copy made on the way off this screen cannot land its reset on a
  // component that has gone.
  const copiedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedResetTimer.current) clearTimeout(copiedResetTimer.current);
    },
    []
  );
  /**
   * Which way the flow last travelled, so a step arrives from the side the tap
   * that asked for it implies: forward out of the right edge, "Scan again" back
   * in from the left. `none` is the first render, where there is no previous
   * step to have come from and the modal's own presentation is the entrance.
   */
  const [stepDirection, setStepDirection] = useState<'none' | 'forward' | 'back'>('none');
  /**
   * A code is in frame and has been accepted. Held here rather than inside the
   * reticle because the camera reports it and the reticle draws it, and the two
   * are on opposite sides of `CameraContent`.
   */
  const [detected, setDetected] = useState(false);
  // Scanning is the default path. Manual address entry is a peer mode rather
  // than a disclosure under the camera, so switching replaces the preview
  // instead of stacking a form below it.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  // The third way in: a gateway that only listens on its own machine, reached
  // through an SSH host the reader has already saved. The pairing itself is
  // the existing manual flow, pointed at the loopback forward the tunnel
  // opens; only the record remembers the host it rode on.
  const [sshOpen, setSshOpen] = useState(false);
  const [sshHostId, setSshHostId] = useState<string | null>(null);
  const [sshPort, setSshPort] = useState(String(GATEWAY_DEFAULT_PORT));
  const sshHosts = useSshHostsStore((state) => state.hosts);
  const sshHostsLoading = useSshHostsStore((state) => state.loading);
  const hydrateSshHosts = useSshHostsStore((state) => state.hydrate);
  const holdTunnel = useSshTunnelsStore((state) => state.hold);
  const releaseTunnel = useSshTunnelsStore((state) => state.release);
  const waitForTunnel = useSshTunnelsStore((state) => state.waitForOpen);
  /**
   * The transient record whose forward the pairing is riding. Held until this
   * screen goes away rather than until the claim lands, so the workspace the
   * success step opens finds the SSH connection still up and reuses it.
   */
  const pairingTunnelRef = useRef<GatewayRecord | null>(null);
  useEffect(() => {
    if (sshHostsLoading) void hydrateSshHosts();
  }, [hydrateSshHosts, sshHostsLoading]);
  useEffect(
    () => () => {
      const held = pairingTunnelRef.current;
      pairingTunnelRef.current = null;
      if (held) releaseTunnel(held);
    },
    [releaseTunnel]
  );
  const [offer, setOffer] = useState<ResolvedPairingOffer | null>(null);
  const [requestId, setRequestId] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | undefined>();
  const [clock, setClock] = useState(0);
  const [serverName, setServerName] = useState('');
  const [code, setCode] = useState('');
  const [pairedServer, setPairedServer] = useState<GatewayRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  /**
   * What the lazily loaded camera chunk can tell us about the lens. Held here
   * because the aperture's frame, its copy and the mode toggle all change with
   * it, and all three are drawn by this route rather than inside that chunk.
   *
   * `permission` until the chunk says otherwise: an aperture that starts on
   * `aiming` shows an aiming frame over nothing for as long as CameraX takes to
   * answer, which on a cold start is most of a second.
   */
  const [cameraReading, setCameraReading] = useState<ScanReading>('permission');
  /**
   * A code was refused and the re-fire guard is holding. Mirrors
   * `scanBlockedUntil` into render, because the aperture has to say the refusal
   * happened -- the ref alone only kept the reader from re-reading it.
   */
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  // The guard's own expiry, so the aperture goes back to aiming on its own
  // rather than waiting for the next render to happen to notice.
  useEffect(() => {
    if (!rejected) return;
    const timeout = setTimeout(() => setRejected(false), SCAN_REJECT_HOLD_MS);
    return () => clearTimeout(timeout);
  }, [rejected]);

  useEffect(() => {
    if (!pairedServer) return;
    const timeout = setTimeout(() => {
      router.replace({
        pathname: '/servers/[serverId]',
        params: { serverId: pairedServer.serverId },
      } as Href);
    }, 850);
    return () => clearTimeout(timeout);
  }, [pairedServer, router]);

  useEffect(() => {
    if (step !== 'confirm' || !expiresAt) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, step]);

  const secondsRemaining = expiresAt ? Math.max(0, Math.ceil((expiresAt - clock) / 1000)) : null;
  const codeExpired = secondsRemaining === 0;

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  /**
   * `fromScan` is what tells the failure path whether there is a QR still being
   * held up at the camera. A typed address that could not be reached is a form
   * to correct, not a code to stop re-reading -- arming the scan guard for it
   * blocked the *next* genuine scan for two and a half seconds and opened the
   * aperture on "that code was refused" for a code that never existed.
   */
  async function beginPairing(nextOffer: PairingOffer, fromScan: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const deviceName = Device.deviceName ?? Device.modelName ?? `Muqun ${Platform.OS}`;
      const request = await beginPairingTransaction(nextOffer, deviceName);
      setOffer(request.offer);
      setRequestId(request.requestId);
      setServerName(request.serverLabel);
      setExpiresAt(request.expiresAt);
      setStepDirection('forward');
      setStep('confirm');
    } catch (error) {
      const failure = describeGatewayFailure(error, t`Could not reach the gateway.`);
      // Whether the gateway turned this down, or was never reached at all.
      // Only the first is the code's fault, and only the first may arm the
      // aperture's "that code was refused".
      const unreachable = failure.kind === 'network' || failure.kind === 'timeout';
      if (fromScan && !unreachable) {
        // Wait before accepting the same QR again, or a bad/stale code loops.
        scanBlockedUntil.current = Date.now() + SCAN_REJECT_HOLD_MS;
        setRejected(true);
      }
      handledScan.current = false;
      // The reticle said it had the code; the gateway then said otherwise. Let
      // it go back to looking, or the frame stays locked on a code that failed.
      setDetected(false);
      // A connection failure while pairing is almost always a stale QR or a
      // gateway that is not running -- say so instead of a bare network notice.
      // Typed and scanned offers fail differently, though: a scanned QR is
      // stale (refresh it), but a typed address was never a QR at all, and
      // telling a reader who typed it to go scan something is no help.
      setMessage(
        unreachable
          ? nextOffer.sshTunnel
            ? t`Nothing answered on port ${nextOffer.sshTunnel.remotePort} through the SSH host. Check the gateway's port on that machine.`
            : nextOffer.serverId
              ? t`Could not reach the gateway. Make sure it is running, then refresh the QR and scan again.`
              : t`Could not reach that address. Check it and make sure the Gateway is running.`
          : failure.message
      );
    } finally {
      setBusy(false);
    }
  }

  function handleScanned(value: string) {
    if (handledScan.current || busy || step !== 'scan') return;
    if (Date.now() < scanBlockedUntil.current) return;
    handledScan.current = true;
    try {
      const parsed = parsePairingOffer(value);
      // The demo card. It is not a Gateway and there is nothing to pair with,
      // so this returns before any request is made -- see `isDemoPairingOffer`
      // for why it exists at all and why the address it carries can never be
      // dialled.
      if (isDemoPairingOffer(parsed)) {
        setDetected(true);
        void feedback('selection');
        enterDemo();
        router.replace({
          pathname: '/servers/[serverId]',
          params: { serverId: DEMO_PAIRING_SERVER_ID },
        } as Href);
        return;
      }
      // The acknowledgement, and the whole point of it: `beginPairing` is a
      // round trip to a machine that may be slow or asleep, and until this
      // landed the only thing on screen between "the code was seen" and
      // "the next step" was an unchanged viewfinder. The reader had no way to
      // know whether to keep holding the phone still. The beat runs alongside
      // the request rather than delaying it.
      setDetected(true);
      void feedback('selection');
      void beginPairing(parsed, true);
    } catch (error) {
      scanBlockedUntil.current = Date.now() + SCAN_REJECT_HOLD_MS;
      setRejected(true);
      handledScan.current = false;
      setDetected(false);
      setMessage(error instanceof Error ? error.message : t`This QR code is not valid.`);
    }
  }

  async function handleManualPair() {
    const trimmedUrl = manualUrl.trim();
    setManualUrl(trimmedUrl);
    let url: string;
    try {
      // normalizeGatewayUrl throws on anything malformed. Unhandled, that
      // surfaced as an uncaught promise rejection and the user got no feedback.
      url = normalizeGatewayUrl(trimmedUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t`Gateway URL is not valid.`);
      return;
    }
    if (!url) {
      setMessage(t`Enter a gateway URL.`);
      return;
    }
    setManualUrl(url);
    Keyboard.dismiss();
    handledScan.current = true;
    await beginPairing({ url }, false);
  }

  /**
   * Open the forward, then run the ordinary typed-address pairing against it.
   * The forward is held on this screen (see `pairingTunnelRef`); a host-key
   * question or a keyboard-interactive challenge from the SSH host surfaces
   * through the app-wide prompt gate, exactly as the terminal screen asks it.
   */
  async function handleSshPair() {
    const host = sshHosts.find((item) => item.id === sshHostId);
    if (!host) {
      setMessage(t`Choose an SSH host.`);
      return;
    }
    const port = Number(sshPort.trim());
    if (!/^\d+$/.test(sshPort.trim()) || !Number.isInteger(port) || port < 1 || port > 65535) {
      setMessage(t`Enter the gateway's port on that host.`);
      return;
    }
    Keyboard.dismiss();
    setBusy(true);
    setMessage(null);
    const previous = pairingTunnelRef.current;
    if (previous) releaseTunnel(previous);
    const transient: GatewayRecord = {
      serverId: `pairing:${host.id}:${port}`,
      label: host.label,
      url: '',
      token: '',
      pairedAt: 0,
      sshTunnel: { hostId: host.id, remoteHost: '127.0.0.1', remotePort: port },
    };
    pairingTunnelRef.current = transient;
    holdTunnel(transient);
    let url: string;
    try {
      url = await waitForTunnel(transient.serverId);
    } catch (error) {
      // The reason is already sanitised and credential-free (`sshFailureLine`).
      const reason = error instanceof Error ? error.message : '';
      setMessage(
        reason ? t`Could not open the SSH tunnel: ${reason}` : t`Could not open the SSH tunnel.`
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    handledScan.current = true;
    await beginPairing({ url, sshTunnel: transient.sshTunnel }, false);
  }

  async function copyInstallCommand() {
    await Clipboard.setStringAsync(GATEWAY_INSTALL_COMMAND);
    void feedback('success');
    setCopiedInstall(true);
    if (copiedResetTimer.current) clearTimeout(copiedResetTimer.current);
    copiedResetTimer.current = setTimeout(() => setCopiedInstall(false), COPIED_HOLD_MS);
  }

  async function handleClaim() {
    if (!offer) return;
    if (codeExpired) {
      setMessage(t`Pairing code expired. Scan again for a new code.`);
      return;
    }
    const normalizedCode = normalizePairingCode(code);
    setCode(normalizedCode);
    if (normalizedCode.length !== PAIRING_CODE_LENGTH) {
      setMessage(t`Enter the ${PAIRING_CODE_CHARACTER_COUNT}-character code.`);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const record = await claimPairingTransaction(
        { offer, requestId, serverLabel: serverName },
        normalizedCode,
        serverName
      );
      setRecord(record);
      await feedback('success');
      Keyboard.dismiss();
      setPairedServer(record);
      setStepDirection('forward');
      setStep('success');
    } catch (error) {
      setMessage(describeGatewayFailure(error, t`Pairing failed.`).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    handledScan.current = false;
    setStepDirection('back');
    setStep('scan');
    setDetected(false);
    setRejected(false);
    setOffer(null);
    setRequestId('');
    setExpiresAt(undefined);
    setServerName('');
    setCode('');
    setPairedServer(null);
    setMessage(null);
  }

  const cameraActive = step === 'scan' && !manualOpen && !sshOpen && !busy && appState === 'active';

  /**
   * The aperture's one reading, folded together from what the camera chunk knows
   * about the lens and what this route knows about the request in flight. The
   * frame, the copy, the reticle and the weight of the mode toggle are all
   * derived from it, so no two of them can disagree -- which is exactly what
   * "camera unavailable" printed under "align the QR inside the frame" was.
   */
  const scan = pairingScanPresentation(
    pairingScanReadingWithRequest(cameraReading, {
      cameraError: Boolean(cameraError),
      detected,
      busy: busy && !manualOpen && !sshOpen,
      rejected,
    })
  );
  const onCameraReading = useCallback((next: ScanReading) => setCameraReading(next), []);
  // The route's own gutters, taken off before the frame is squared, so the
  // aperture is square against the column it actually occupies.
  const apertureSize = pairingApertureSize(Math.min(windowWidth, ROUTE_MEASURE) - ROUTE_GUTTER * 2);

  /**
   * The step transition, which is the most-hit one in the whole flow and used
   * to be nothing at all: the viewfinder ceased to exist and a form was there
   * instead, on one frame, with only the final success card animating.
   *
   * Directional on the way in, plain on the way out, and that asymmetry is
   * deliberate. Reanimated reads `exiting` off the view as it was last
   * committed, so an outgoing step cannot know it is being left backwards --
   * "Scan again" would slide the confirm card the same way a successful pair
   * does. A step that fades in place under one arriving from a named side
   * still reads as travel, and it reads correctly in both directions.
   */
  const stepEntering =
    stepDirection === 'none'
      ? undefined
      : stepDirection === 'back'
        ? fadeInLeft('short')
        : fadeInRight('short');
  const stepExiting = fadeOut('short');

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        mode="insets"
        showsVerticalScrollIndicator={false}>
        <View style={styles.modalHeader}>
          <View style={styles.headerCopy}>
            <Text variant="heading" style={styles.title}>
              {step === 'scan'
                ? t`Pair server`
                : step === 'confirm'
                  ? t`Confirm pairing`
                  : t`Connected`}
            </Text>
            {/* The header says what to do; the aperture says why. They never
              repeat each other, and they never disagree -- which is what
              "Scan the Gateway QR." printed above "no camera to scan with"
              was doing on every device without a rear lens. */}
            <Text variant="bodySmall" color={theme.colors.textMuted}>
              {step === 'scan'
                ? sshOpen
                  ? t`A Gateway on a machine you can SSH into, even one that only listens on its own loopback.`
                  : manualOpen
                    ? t`The address the Gateway prints when it starts.`
                    : scan.reading === 'unavailable'
                      ? t`Enter the Gateway's address instead.`
                      : scan.reading === 'permission'
                        ? t`Allow the camera, or enter the address instead.`
                        : scan.reading === 'claiming'
                          ? t`Asking the Gateway about that code.`
                          : t`Scan the Gateway QR.`
                : step === 'confirm'
                  ? t`Name it, then enter the code shown by the Gateway.`
                  : t`Opening the server.`}
            </Text>
          </View>
          <PressableScale
            accessibilityLabel={t`Close pairing`}
            onPress={close}
            style={[styles.closeButton, { backgroundColor: theme.colors.surfaceRaised }]}>
            <X size={20} color={theme.colors.text} />
          </PressableScale>
        </View>

        {/* Slack, split unevenly, so the instrument settles a little above the
          middle of the space it has instead of hanging off the header with a
          screen of nothing under it. Both collapse the moment a keyboard or a
          long error makes the content taller than the window. */}
        <View style={styles.slackAbove} />

        {/* One slot for all three steps, carrying the height difference between a
          360pt viewfinder and a form card. The outgoing step is detached from
          layout for the length of its fade, so this travels to the incoming
          step's height rather than to the sum of the two. */}
        <Animated.View style={styles.stepArea} layout={listLayout('short')}>
          {step === 'scan' ? (
            <Animated.View
              key="scan"
              entering={stepEntering}
              exiting={stepExiting}
              style={styles.step}>
              {/* One aperture, one place, one size, for both modes.
 
              It does not resize between them, and that is the design rather
              than a shortcut: the frame is a slot that accepts either light or
              letters, and a slot that collapses to a third of its height the
              moment you choose letters is two panels wearing one fill. Holding
              the square also removes the last artefact of the reported flash --
              the fill visibly dimmed for about eight frames while a layout
              animation grew it back, which on a cream page is a grey slab. With
              nothing to grow, there is nothing to dim. */}
              <Animated.View
                style={[
                  styles.aperture,
                  {
                    width: apertureSize,
                    height: apertureSize,
                    backgroundColor: theme.colors.surfaceRaised,
                    // A hairline, because `surfaceRaised` and `background` are the
                    // same colour to within a percent in several packs -- an
                    // aperture defined only by its fill simply vanished in those,
                    // and a 460pt invisible rectangle is worse than no frame.
                    borderColor: theme.colors.border,
                  },
                ]}>
                {sshOpen ? (
                  <Animated.View
                    key="ssh"
                    testID="pairing-ssh"
                    entering={fadeIn('short')}
                    exiting={fadeOut('micro')}
                    style={styles.manualPanel}>
                    <Text variant="label" color={theme.colors.textMuted}>
                      {t`SSH host`}
                    </Text>
                    {sshHosts.length === 0 ? (
                      <PressableScale
                        accessibilityRole="link"
                        accessibilityLabel={t`Add an SSH host`}
                        onPress={() => router.push('/ssh')}
                        style={styles.sshEmpty}>
                        <Text variant="caption" color={theme.colors.textMuted}>
                          {t`No SSH hosts saved yet.`}
                        </Text>
                        <Text variant="caption" color={theme.colors.primary}>
                          {t`Add one first`}
                        </Text>
                      </PressableScale>
                    ) : (
                      <View style={styles.sshHostList}>
                        {sortSshHosts(sshHosts).map((host) => {
                          const selected = host.id === sshHostId;
                          return (
                            <PressableScale
                              key={host.id}
                              accessibilityRole="radio"
                              accessibilityState={{ selected }}
                              accessibilityLabel={t`Pair through ${host.label}`}
                              testID={`pairing-ssh-host-${host.id}`}
                              onPress={() => setSshHostId(host.id)}
                              style={[
                                styles.sshHostRow,
                                {
                                  backgroundColor: selected
                                    ? theme.colors.primarySubtle
                                    : theme.colors.surface,
                                  borderColor: selected
                                    ? theme.colors.primary
                                    : theme.colors.border,
                                },
                              ]}>
                              <Text
                                variant="bodySmall"
                                numberOfLines={1}
                                style={styles.sshHostLabel}>
                                {host.label}
                              </Text>
                              <Text
                                variant="caption"
                                color={theme.colors.textMuted}
                                numberOfLines={1}>
                                {sshHostAddress(host)}
                              </Text>
                            </PressableScale>
                          );
                        })}
                      </View>
                    )}
                    <Input
                      label={t`Gateway port on that host`}
                      value={sshPort}
                      onChangeText={setSshPort}
                      keyboardType="number-pad"
                      placeholder={String(GATEWAY_DEFAULT_PORT)}
                      variant="underline"
                      testID="pairing-ssh-port"
                    />
                    <Button
                      onPress={() => void handleSshPair()}
                      loading={busy}
                      loadingLabel={t`Opening tunnel`}
                      testID="pairing-ssh-continue">
                      {t`Continue`}
                    </Button>
                  </Animated.View>
                ) : manualOpen ? (
                  <Animated.View
                    key="manual"
                    testID="pairing-manual"
                    entering={fadeIn('short')}
                    exiting={fadeOut('micro')}
                    style={styles.manualPanel}>
                    <Input
                      label={t`Gateway URL`}
                      value={manualUrl}
                      onChangeText={setManualUrl}
                      onBlur={() => setManualUrl((value) => value.trim())}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      placeholder="http://100.x.x.x:23847"
                      // Underline, not outline: the design system's `outline`
                      // variant fills with `surfaceRaised` and draws no border
                      // width at all, which on the aperture's own `surfaceRaised`
                      // ground left the field with no edge anywhere -- a label and
                      // a placeholder floating in a box with nothing to tap at.
                      variant="underline"
                    />
                    <Button onPress={handleManualPair} loading={busy} loadingLabel={t`Connecting`}>
                      {t`Continue`}
                    </Button>
                  </Animated.View>
                ) : (
                  <Animated.View
                    key="scanner"
                    testID="pairing-scanner"
                    entering={fadeIn('short')}
                    exiting={fadeOut('micro')}
                    style={styles.scanner}>
                    {/* The chunk itself takes a beat to arrive on a cold start.
                    A blank frame for that beat is the same non-answer the
                    camera's own warm-up used to give. */}
                    <Suspense
                      fallback={
                        <View style={styles.waiting}>
                          <LogoLoader accessibilityLabel={t`Starting the camera`} size={44} />
                        </View>
                      }>
                      <PairingCamera
                        active={cameraActive}
                        error={cameraError}
                        knownUnavailable={cameraReading === 'unavailable'}
                        onError={(value) => {
                          setCameraError(value);
                        }}
                        onReading={onCameraReading}
                        onScanned={handleScanned}
                      />
                    </Suspense>
                    {/* Only over camera pixels. With no preview the aperture's own
                    corners are the mark, and a second frame floating inside the
                    first was the old scanner's black-box-in-a-black-box. */}
                    {scan.showsPreview ? (
                      <Animated.View
                        entering={fadeIn('short')}
                        exiting={fadeOut('micro')}
                        pointerEvents="none"
                        style={styles.scanOverlay}>
                        <ScanReticle active={cameraActive} detected={scan.reticleClosed} />
                        <Text variant="caption" color={OVER_PREVIEW_INK}>
                          {scan.reading === 'rejected' ? (
                            <Trans>That code was refused. Hold still for a new one.</Trans>
                          ) : scan.reticleClosed ? (
                            <Trans>Code found. Reaching the Gateway.</Trans>
                          ) : scan.reading === 'aiming-front' ? (
                            // Saying which lens is doing the looking, because the
                            // reader is about to see themselves and needs to know
                            // that is the scanner working rather than the wrong one
                            // opening.
                            <Trans>Front camera. Hold the QR up to the screen</Trans>
                          ) : (
                            <Trans>Align the QR inside the frame</Trans>
                          )}
                        </Text>
                      </Animated.View>
                    ) : null}
                    {scan.isWaiting ? (
                      <Animated.View
                        entering={fadeIn('short')}
                        exiting={fadeOut('micro')}
                        style={styles.waiting}>
                        <LogoLoader accessibilityLabel={t`Reaching the Gateway`} size={44} />
                        <Text variant="label" color={theme.colors.textMuted}>
                          {t`Reaching the Gateway`}
                        </Text>
                      </Animated.View>
                    ) : null}
                    {/* The aperture's own corners: the same mark as the home card's
                    empty state at 64pt and the home header's glyph at 20pt,
                    here at the size the phone is held at. Themed while the
                    aperture is empty; white over pixels this app does not
                    control, because no token can promise contrast against an
                    arbitrary camera image. */}
                    {scan.showsPreview ? null : (
                      <View pointerEvents="none" style={styles.apertureFrame}>
                        <ReticleCorners color={theme.colors.borderStrong} />
                      </View>
                    )}
                  </Animated.View>
                )}
              </Animated.View>

              {/* The alternative route, below the instrument rather than above it:
              scanning is what this screen is for, and typing an address is the
              way out of it. It stops being quiet exactly when scanning cannot
              work -- same control, same words, more weight -- so a reader on a
              device with no lens is not left choosing between a dead frame and
              a caption. */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={manualOpen ? t`Scan a gateway QR` : t`Enter URL manually`}
                onPress={() => {
                  setSshOpen(false);
                  setManualOpen((value) => !value);
                }}
                style={[
                  styles.manualToggle,
                  {
                    // The quiet state is the aperture's own surface, not `surface`:
                    // in several packs `surface` is brighter than the page, so a
                    // 42pt pill outshone the 460pt frame it is subordinate to.
                    backgroundColor:
                      scan.promotesManualEntry && !manualOpen
                        ? theme.colors.primarySubtle
                        : theme.colors.surfaceRaised,
                  },
                ]}>
                {manualOpen ? (
                  <ScanLine size={17} color={theme.colors.textMuted} strokeWidth={2} />
                ) : (
                  <KeyboardIcon
                    size={17}
                    color={scan.promotesManualEntry ? theme.colors.primary : theme.colors.textMuted}
                    strokeWidth={2}
                  />
                )}
                <Text
                  variant="label"
                  color={
                    !manualOpen && scan.promotesManualEntry
                      ? theme.colors.primary
                      : theme.colors.textMuted
                  }>
                  {manualOpen ? t`Scan a gateway QR` : t`Enter URL manually`}
                </Text>
              </PressableScale>

              {/* The gateway that cannot be reached at all from here -- loopback
              only, or firewalled -- but whose machine the reader can already
              SSH into. Same weight as the manual toggle; it is a peer mode. */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={sshOpen ? t`Scan a gateway QR` : t`Pair through an SSH host`}
                testID="pairing-ssh-toggle"
                onPress={() => {
                  setManualOpen(false);
                  setSshOpen((value) => !value);
                }}
                style={[styles.manualToggle, { backgroundColor: theme.colors.surfaceRaised }]}>
                {sshOpen ? (
                  <ScanLine size={17} color={theme.colors.textMuted} strokeWidth={2} />
                ) : (
                  <Waypoints size={17} color={theme.colors.textMuted} strokeWidth={2} />
                )}
                <Text variant="label" color={theme.colors.textMuted}>
                  {sshOpen ? t`Scan a gateway QR` : t`Pair through an SSH host`}
                </Text>
              </PressableScale>

              {/* The way out for the reader who has neither a QR nor an address,
              which is everyone opening this screen for the first time. Quiet,
              and below the toggle: it is the answer to "I do not have one of
              those yet", not a third way to pair. */}
              <PressableScale
                accessibilityRole="link"
                accessibilityLabel={t`Set up a Gateway on your computer`}
                onPress={() => void Linking.openURL(GATEWAY_SETUP_URL)}
                style={styles.setupLink}>
                {/* The gap is laid out, not typed. A literal space inside the Text
                becomes part of the node's own text, so every matcher -- and the
                screen reader -- sees "No Gateway yet? " with a tail on it. */}
                <Text variant="caption" color={theme.colors.textMuted}>
                  {t`No Gateway yet?`}
                </Text>
                <Text variant="caption" color={theme.colors.primary}>
                  {t`Set one up on your computer`}
                </Text>
              </PressableScale>

              {/* The command itself, under the link that would otherwise be the
              only answer.

              The link sends a reader with a phone in one hand and a laptop in
              front of them to a web page, on the phone, to be told what to type
              on the laptop. That detour is most of why this screen reads as a
              dead end -- an App Store reviewer walked into exactly it. Printing
              the command here ends the sentence the caption above starts.

              Copy rather than only display, because the two devices are usually
              already sharing a clipboard, and because a 48-character command
              retyped from a phone screen is a command retyped wrong. It stays
              legible either way: the text is selectable, so the reader who has
              no shared clipboard can still read it off and type it. */}
              <PressableScale
                accessibilityRole="button"
                accessibilityHint={t`Copies it, ready to paste into a terminal`}
                accessibilityLabel={
                  copiedInstall ? t`Install command copied` : t`Copy the install command`
                }
                testID="pairing-install-command"
                onPress={() => void copyInstallCommand()}
                style={[styles.installRow, { backgroundColor: theme.colors.surfaceRaised }]}>
                {/* Two lines, not one shrunk to fit: the command wraps at the phone
                widths this screen is read on, and a command scaled down until it
                fits is a command nobody can read off the screen. */}
                <Text
                  numberOfLines={2}
                  style={[styles.installCommand, { color: theme.colors.textMuted }]}>
                  {GATEWAY_INSTALL_COMMAND}
                </Text>
                {copiedInstall ? (
                  <Check size={16} color={theme.colors.primary} strokeWidth={2} />
                ) : (
                  <CopyIcon size={16} color={theme.colors.textMuted} strokeWidth={2} />
                )}
              </PressableScale>
            </Animated.View>
          ) : step === 'confirm' ? (
            <Animated.View key="confirm" entering={stepEntering} exiting={stepExiting}>
              <Card variant="raised" padding="lg" style={styles.confirmCard}>
                <View style={styles.confirmCopy}>
                  <Text variant="label">
                    {/* The product's name for the daemon, kept as a name in every
                  locale -- but routed through the catalog so a language that
                  wants an article or a particle around it can have one. */}
                    <Trans>Gateway</Trans>
                  </Text>
                  <Text
                    selectable
                    variant="caption"
                    color={theme.colors.textMuted}
                    numberOfLines={2}>
                    {offer?.url}
                  </Text>
                </View>
                <Input
                  label={t`Server name`}
                  value={serverName}
                  onChangeText={(value) => setServerName(value.slice(0, 48))}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  placeholder={t`Mac mini · Office`}
                  variant="outline"
                />
                {/* Do not set native maxLength here. Android truncates pasted text
              before onChangeText, so a leading space would consume one slot
              and discard the final real code character before normalization. */}
                <Input
                  label={t`Pairing code`}
                  value={code}
                  onChangeText={(value) => setCode(normalizePairingCode(value))}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
                  returnKeyType="done"
                  textContentType="oneTimeCode"
                  onSubmitEditing={() => void handleClaim()}
                  // Shows the shape without looking like a code to copy. Prose does
                  // not fit: this input is 26pt with 6pt letter spacing.
                  placeholder="••••-••••"
                  variant="outline"
                  style={styles.codeInput}
                  testID="pairing-code-input"
                />
                {secondsRemaining !== null ? (
                  <Text
                    variant="caption"
                    color={secondsRemaining <= 15 ? theme.colors.danger : theme.colors.textMuted}>
                    {codeExpired
                      ? t`Code expired`
                      : t`Expires in ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, '0')}`}
                  </Text>
                ) : null}
                <Button
                  disabled={codeExpired}
                  onPress={handleClaim}
                  loading={busy}
                  loadingLabel={t`Pairing`}>
                  {t`Pair server`}
                </Button>
                <Button onPress={reset} variant="ghost">
                  {t`Scan again`}
                </Button>
              </Card>
            </Animated.View>
          ) : pairedServer ? (
            <Animated.View
              key="success"
              entering={stepEntering ?? fadeIn('short')}
              exiting={stepExiting}
              style={[styles.successCard, { backgroundColor: theme.colors.primarySubtle }]}>
              <Animated.View
                // Timed, not sprung: the design system rules out bounce, and the
                // tick landing cleanly reads as confirmation rather than as a toy.
                entering={zoomIn('short')}
                style={[styles.successIcon, { backgroundColor: theme.colors.primary }]}>
                <Check size={30} strokeWidth={2.5} color={theme.colors.onPrimary} />
              </Animated.View>
              <View style={styles.successCopy}>
                <Text variant="heading" style={styles.successTitle} numberOfLines={1}>
                  {pairedServer.label}
                </Text>
                <Text selectable variant="caption" color={theme.colors.textMuted} numberOfLines={2}>
                  {pairedServer.url}
                </Text>
              </View>
            </Animated.View>
          ) : null}
        </Animated.View>

        {/* A bad QR, an expired code and an unreachable gateway all arrive here,
          and all three used to appear and vanish on one frame -- a paragraph of
          red simply existing under the form, with the scroll content jumping by
          its height as it did. */}
        {message ? (
          <Animated.View
            entering={fadeIn('short')}
            exiting={fadeOut('micro')}
            layout={listLayout('short')}
            style={[styles.message, { backgroundColor: theme.colors.dangerSubtle }]}>
            <Text selectable variant="bodySmall" color={theme.colors.danger}>
              {message}
            </Text>
          </Animated.View>
        ) : null}

        <View style={styles.slackBelow} />
      </KeyboardAwareScrollView>

      {/* This screen is presented as a native modal, and the gate near the
          navigation root cannot draw a dialog over one on iOS. Pairing through
          an SSH host asks about the host key from right here, so it mounts its
          own gate; being the innermost one, it is the one that draws. */}
      <SshConnectPromptGate />
    </SafeAreaView>
  );
}

/**
 * The frame the QR is aimed into, and the only thing on this screen that can
 * say a code was seen.
 *
 * It was four static corners. The camera reported a scan straight into
 * `onScanned` and nothing on screen acknowledged it, so the seconds the gateway
 * took to answer were indistinguishable from the scanner not working -- the
 * reader's move is to jiggle the phone, which is the one thing that makes it
 * worse.
 *
 * Two states, both drawn as a second set of corners cross-faded over the first
 * rather than as a colour animation: a Lucide-style border colour resolves in
 * JS before the style reaches React Native, so there is nothing for the UI
 * thread to drive. Idle breathes, on the same period as a live status dot,
 * because both mean the same thing -- this is on and it is looking. Found
 * closes the frame in once, on `short`, and stays there.
 */
function ScanReticle({ active, detected }: { active: boolean; detected: boolean }) {
  const theme = useThemeTokens();
  const reduceMotion = useReducedMotion();
  const breath = useSharedValue(0);
  const confirm = useSharedValue(0);

  useEffect(() => {
    // Nothing to be a sign of life for once the code is in hand, and nothing to
    // breathe about while the camera is off.
    if (!active || detected || reduceMotion) {
      cancelAnimation(breath);
      breath.value = 0;
      return;
    }
    breath.value = 0;
    breath.value = withRepeat(withTiming(1, timing(PULSE_PERIOD)), -1, true);
    return () => cancelAnimation(breath);
  }, [active, breath, detected, reduceMotion]);

  useEffect(() => {
    confirm.value = withTiming(detected ? 1 : 0, timing('short'));
  }, [confirm, detected]);

  const frameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - confirm.value * RETICLE_CONFIRM_INSET }],
  }));
  const restingStyle = useAnimatedStyle(() => ({
    opacity: (1 - RETICLE_BREATH_DEPTH * breath.value) * (1 - confirm.value),
  }));
  const foundStyle = useAnimatedStyle(() => ({ opacity: confirm.value }));

  return (
    <Animated.View style={[styles.scanFrame, frameStyle]}>
      <Animated.View style={[styles.reticleLayer, restingStyle]}>
        <ReticleCorners color={OVER_PREVIEW_INK} />
      </Animated.View>
      <Animated.View style={[styles.reticleLayer, foundStyle]}>
        <ReticleCorners color={theme.colors.success} />
      </Animated.View>
    </Animated.View>
  );
}

function ReticleCorners({ color }: { color: string }) {
  return (
    <>
      <View style={[styles.corner, styles.cornerTopLeft, { borderColor: color }]} />
      <View style={[styles.corner, styles.cornerTopRight, { borderColor: color }]} />
      <View style={[styles.corner, styles.cornerBottomLeft, { borderColor: color }]} />
      <View style={[styles.corner, styles.cornerBottomRight, { borderColor: color }]} />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: ROUTE_MEASURE,
    alignSelf: 'center',
    padding: ROUTE_GUTTER,
    paddingBottom: 32,
    gap: 18,
  },
  slackAbove: {
    flexGrow: 0.45,
    flexShrink: 1,
    flexBasis: 0,
  },
  slackBelow: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  modalHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The slot both modes live in. No fill of its own here: the surface token is
  // applied at the call site, and it is the one thing on this screen that must
  // never change colour mid-transition.
  aperture: {
    alignSelf: 'center',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  scanner: {
    ...StyleSheet.absoluteFill,
  },
  // Inset from the aperture's own edge, so the corner brackets read as the
  // frame's corners rather than as a border drawn on top of one.
  apertureFrame: {
    ...StyleSheet.absoluteFill,
    margin: 18,
  },
  waiting: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    // Only ever painted over camera pixels, which is why it is a fixed value:
    // it is darkening an image, not tinting a surface.
    backgroundColor: 'rgba(2, 10, 18, 0.18)',
  },
  // The scan step's own column, and the slot the three steps share. `gap`
  // matches the scroller's, so a step that is one element and a step that is
  // three space themselves identically.
  stepArea: {
    gap: 18,
  },
  step: {
    width: '100%',
    gap: 18,
  },
  scanFrame: {
    width: 214,
    height: 214,
  },
  reticleLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  // Every call site passes its own `borderColor`; there is no default here on
  // purpose, so the file's one deliberate literal stays the only one.
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 14,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 14,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 14,
  },
  cornerBottomRight: {
    right: 0,
    bottom: 0,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderBottomRightRadius: 14,
  },
  // A control rather than a caption. It used to be a bare row of caps type with
  // an icon pushed to the far edge, which is the shape of a section header, not
  // of something you can press -- and it was above the instrument it was an
  // alternative to.
  installRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  installCommand: {
    flex: 1,
    // Not the design system's `label` role, which is 11pt uppercase with
    // tracking: a shell command that has been upper-cased is a shell command
    // that does not run. This is the one string on the screen that has to be
    // reproduced character for character, so it gets a monospace face of its
    // own and no transform.
    fontFamily: Platform.OS === 'ios' ? 'ui-monospace' : 'monospace',
    fontSize: 12,
    lineHeight: 17,
  },
  setupLink: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  manualToggle: {
    alignSelf: 'center',
    minHeight: 42,
    borderRadius: 21,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 16,
  },
  // The form, on the aperture's own ground, centred in the square rather than
  // sizing it. It was a Card inside the step and the step was already a
  // surface, so the address field sat two fills deep.
  sshHostList: {
    gap: 8,
    width: '100%',
  },
  sshHostRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  sshHostLabel: {
    flexShrink: 1,
  },
  sshEmpty: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  manualPanel: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  confirmCard: {
    gap: 16,
  },
  confirmCopy: {
    gap: 6,
  },
  codeInput: {
    fontSize: 26,
    height: 36,
    lineHeight: 34,
    letterSpacing: 6,
    // Left aligned: centring re-lays out the text on every keystroke, so the
    // code visibly jumps around while it is being typed.
    textAlign: 'left',
  },
  successCard: {
    minHeight: 260,
    borderRadius: 24,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 22,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCopy: {
    alignItems: 'center',
    gap: 7,
  },
  successTitle: {
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
  },
  message: {
    borderRadius: 14,
    padding: 14,
  },
});
