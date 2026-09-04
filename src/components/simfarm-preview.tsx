import { Trans, useLingui } from '@lingui/react/macro';
import { Button, Input, Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy as CopyIcon, Lock, MonitorSmartphone, X } from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { WebView } from 'react-native-webview';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { feedback } from '@/lib/feedback';
import { COPIED_HOLD_MS } from '@/lib/pairing-scan';
import { parsePort } from '@/lib/web-service';
import {
  SIMFARM_DEFAULT_PORT,
  SIMFARM_RUN_COMMAND,
  simfarmThemedClientUrl,
  type SimfarmThemeColors,
} from '@/lib/simfarm';
import { probeSimfarm, type SimfarmProbe } from '@/lib/simfarm-client';

/**
 * The simulator on the paired machine, drawn where the reader is standing.
 *
 * One component with two hosts: a sheet on a phone, and the right-hand column
 * beside the terminal on a Pad. They are the same thing in different amounts of
 * space, and splitting them into two components would be two places to fix the
 * next thing simfarm changes.
 *
 * ## Why a web view rather than a client of our own
 *
 * simfarm's protocol is public and this app already draws a terminal grid from
 * scratch, so writing a native client is not unthinkable -- but it would mean
 * binary frame handling and a video decode path, and the reference client that
 * ships with the server already does all of it and is the thing the protocol is
 * tested against. A web view gets 1:1 drawing, touch forwarding and every
 * provider for the cost of a dependency, and leaves the option of a native
 * client open for the day the seam actually hurts.
 *
 * ## What is on screen and when
 *
 * Four states, and only one of them is the simulator: the look, the miss, the
 * connection that may not be offered one at all, and the preview itself. The
 * middle two are the point of the design -- most machines need no configuration
 * at all, so simfarm has a default port and the host is already on the tailnet,
 * and the app looks first and only asks when looking failed. A port field that
 * appeared every time would be a form charging rent on the common case.
 *
 * ## Why the three that are not the simulator share one skeleton
 *
 * They used to be three shapes: a spinner with a caption, a lone sentence, and
 * a headerless screen with an upper-cased line, a paragraph, a bare field and a
 * pill wide enough to be the only thing on it. Nothing said which screen the
 * reader was on, nothing said what simfarm is, and nothing said how to get one
 * -- three ways of being a dead end. `PreviewNotice` below is the app's own
 * empty state, the one the SSH host list and the pairing screen already draw:
 * a glyph, a sentence-case title, one calm paragraph, and at most one thing to
 * do. What varies between the three is the glyph, the words, and whether there
 * is a port to type.
 */
export function SimfarmPreview({
  gatewayUrl,
  allowed,
  initialPort,
  onPortFound,
  onClose,
  /** Beside the terminal rather than in a sheet: no padding, no heading. */
  embedded = false,
}: {
  gatewayUrl: string | undefined;
  /** Whether this connection may be offered the preview; see `probeSimfarm`. */
  allowed: boolean;
  initialPort?: number;
  /** Called with a port that answered, so the caller can remember it. */
  onPortFound?: (port: number) => void;
  /**
   * Dismiss, for the host that is a sheet. Absent when there is nothing to
   * dismiss -- the Pad column is part of the workspace, not over it -- and the
   * header is drawn only when it is present, so no host grows a close button
   * that closes nothing.
   */
  onClose?: () => void;
  embedded?: boolean;
}) {
  const theme = useThemeTokens();
  const { t } = useLingui();

  // The port to look on, which is not always the port the screen is talking
  // about: see `answer` below.
  const [askedPort, setAskedPort] = useState(initialPort ?? SIMFARM_DEFAULT_PORT);
  const [portText, setPortText] = useState(String(initialPort ?? SIMFARM_DEFAULT_PORT));
  /**
   * The last answer, and the port it is an answer *about*.
   *
   * The port is carried with it because the two drift apart for as long as a
   * look takes: the field submits, `port` becomes 9000, and the screen would
   * otherwise say "No simulator on port 9000" a fifth of a second before
   * anything had asked 9000. The heading reports what was actually tried.
   */
  const [answer, setAnswer] = useState<{ port: number; probe: SimfarmProbe } | null>(null);
  const [looking, setLooking] = useState(true);
  // Guards a probe that returns after the reader has already asked for another
  // one; without it a slow answer for the old port can overwrite a fresh miss.
  const attempt = useRef(0);

  const look = useCallback(
    async (candidate: number) => {
      const mine = (attempt.current += 1);
      setLooking(true);
      const result = await probeSimfarm(gatewayUrl, candidate, allowed);
      if (attempt.current !== mine) return;
      setAnswer({ port: candidate, probe: result });
      setLooking(false);
      if (result.found) onPortFound?.(candidate);
    },
    [allowed, gatewayUrl, onPortFound]
  );

  useEffect(() => {
    void look(askedPort);
  }, [askedPort, look]);

  const submitPort = useCallback(() => {
    const parsed = parsePort(portText);
    if (parsed !== null) setAskedPort(parsed);
  }, [portText]);

  const colors: SimfarmThemeColors = {
    background: theme.colors.background,
    surface: theme.colors.surface,
    text: theme.colors.text,
    textMuted: theme.colors.textMuted,
    border: theme.colors.border,
    primary: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
  };
  const url = answer === null ? null : simfarmThemedClientUrl(gatewayUrl, answer.port, colors);

  // The first look, before there is anything to report. A second and subsequent
  // look does *not* land here: it keeps the miss on screen and spins inside the
  // Look again button, so pressing it does not blank the screen the reader is
  // reading and then rebuild it.
  if (answer === null) {
    return (
      <PreviewNotice embedded={embedded} onClose={onClose}>
        <Spinner size="sm" />
        <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.middle}>
          {t`Looking for a simulator`}
        </Text>
      </PreviewNotice>
    );
  }

  if (answer.probe.found && url !== null) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
        <WebView
          source={{ uri: url }}
          style={styles.fill}
          // The gateway is reached over http on a tailnet, so the preview is
          // too. Both platforms already permit it -- `NSAllowsArbitraryLoads`
          // on iOS and `usesCleartextTraffic` through expo-build-properties on
          // Android -- because the app has always had to talk to http gateways.
          originWhitelist={['http://*', 'https://*']}
          // The client draws devices at 1:1 and forwards touches; a web view
          // that rubber-bands under them would fight the device being driven.
          bounces={false}
          overScrollMode="never"
          // Nothing here is a document to read, so the usual text controls are
          // only ways to end up somewhere unexpected.
          allowsLinkPreview={false}
          // A blank flash between the app's background and the client's is the
          // one thing `?theme=` was passed to prevent; keep it out of the gap
          // before the first paint too.
          containerStyle={{ backgroundColor: theme.colors.background }}
          onError={() =>
            setAnswer({ port: answer.port, probe: { found: false, reason: 'unreachable' } })
          }
        />
      </View>
    );
  }

  // `blocked` should not reach here: the entry that opens this is hidden on a
  // connection that fails the gate, because a control that can never work is
  // furniture. It is handled anyway rather than falling through to a port
  // field, which would invite the reader to fix something a number cannot fix
  // -- and so it says which connection would work instead.
  if (answer.probe.found === false && answer.probe.reason === 'blocked') {
    return (
      <PreviewNotice
        embedded={embedded}
        onClose={onClose}
        icon={<Lock size={40} color={theme.colors.textMuted} strokeWidth={1.5} />}
        title={t`No preview on this connection`}>
        <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.middle}>
          <Trans>
            A simulator can be driven and not only watched, so a preview is offered only over
            Tailscale or HTTPS. Pair this machine at its tailnet address, or serve its gateway over
            HTTPS, and the preview appears on its own.
          </Trans>
        </Text>
      </PreviewNotice>
    );
  }

  // The port the miss is about, which is `askedPort` except during a re-look.
  const port = answer.port;

  return (
    <PreviewNotice
      embedded={embedded}
      onClose={onClose}
      icon={<MonitorSmartphone size={40} color={theme.colors.textMuted} strokeWidth={1.5} />}
      title={t`No simulator on port ${port}`}>
      <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.middle}>
        <Trans>
          simfarm is the small program on that machine that serves this preview. Either it is not
          running, or it is listening on another port.
        </Trans>
      </Text>
      <RunCommand />
      <View style={styles.portRow}>
        <Text variant="label" color={theme.colors.textMuted}>
          {t`Port`}
        </Text>
        <Input
          value={portText}
          onChangeText={setPortText}
          keyboardType="number-pad"
          returnKeyType="go"
          // Outline, like every other field the app asks a question in: the
          // underline default draws a filled slab, which beside a pill button
          // reads as a disabled control rather than as somewhere to type.
          variant="outline"
          placeholder={String(SIMFARM_DEFAULT_PORT)}
          accessibilityLabel={t`simfarm port`}
          testID="simfarm-port"
          // `containerStyle`, not `style`: this Input hands `style` to the
          // TextInput inside its own full-width wrapper, so a width there sized
          // the text box and left the wrapper as wide as the screen. The row
          // then overflowed both edges -- the port lost its first digit on the
          // left and Look again was cut off on the right.
          containerStyle={styles.port}
          onSubmitEditing={submitPort}
        />
        <Button
          // The design system's button at its own height, with the horizontal
          // padding brought in: this one sits beside a four-digit field rather
          // than alone under a paragraph, and at the token padding it was half
          // again as wide as the field it acts on.
          style={styles.lookAgain}
          loading={looking}
          loadingLabel={t`Looking`}
          disabled={parsePort(portText) === null}
          testID="simfarm-look-again"
          onPress={submitPort}>
          {t`Look again`}
        </Button>
      </View>
    </PreviewNotice>
  );
}

/**
 * The shape every state that is not a simulator is drawn in.
 *
 * A header when this is a sheet, and under it one bounded column centred in
 * whatever is left. The column is capped rather than stretched because these
 * are two sentences and a field: on a Pad's full width an uncapped paragraph
 * runs to a line nobody tracks back from, and the field and its button drift to
 * opposite edges. 420 is the measure the rest of the app's centred copy uses.
 */
function PreviewNotice({
  icon,
  title,
  embedded,
  onClose,
  children,
}: {
  icon?: ReactNode;
  title?: string;
  embedded: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  const theme = useThemeTokens();
  const { t } = useLingui();

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {/* Only in a sheet, and only on the states that are not the simulator.
          The preview itself stays headerless on purpose -- what is inside it is
          a device drawn at 1:1, and a bar over it would crop the thing the
          screen exists to show. These states have room, and a full screen with
          no name on it is the part of this that read as broken. */}
      {onClose && !embedded ? (
        <View style={styles.header}>
          {/* The panels and Files sheets draw this and this one did not, which
              is the sort of difference that reads as two different apps.
              Android only: iOS has the system grabber. */}
          {process.env.EXPO_OS === 'android' ? <View style={styles.sheetHandle} /> : null}
          <View style={styles.headerRow}>
            <Text variant="bodySmall" style={styles.headerTitle}>
              <Trans>Simulator</Trans>
            </Text>
            {/* The same chrome as the Files sheet, from the same component:
                two sheets whose close buttons were different materials would
                read as two apps. `sheet`, not `floating` -- see `GlassChrome`. */}
            <GlassChrome face="sheet" style={styles.iconButton}>
              <PressableScale
                accessibilityLabel={t`Close the simulator`}
                testID="simfarm-close"
                onPress={onClose}
                style={styles.iconButtonHit}>
                <X size={18} color={theme.colors.text} />
              </PressableScale>
            </GlassChrome>
          </View>
        </View>
      ) : null}
      {/* Centred by the content container rather than by the view, because the
          port field is the one control here and the number pad covers exactly
          where a centred column puts it. `flexGrow` keeps the column in the
          middle while there is room and lets the scroller lift it once there is
          not, which is the same instrument every other field in this app sits
          in (`open-web-service-sheet.tsx`, `ssh-host-list.tsx`). */}
      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.body, embedded ? styles.embeddedPad : styles.sheetPad]}>
        <View style={styles.column}>
          {icon ? (
            <View style={[styles.glyph, { backgroundColor: theme.colors.surfaceRaised }]}>
              {icon}
            </View>
          ) : null}
          {title ? (
            <Text variant="subheading" style={styles.middle}>
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

/**
 * The command that starts a simfarm, under the sentence that says one is
 * missing.
 *
 * The pairing screen's install line, in the situation it was written for. The
 * reader is holding a phone in front of the machine that has no simfarm on it,
 * and the two devices are usually already sharing a clipboard -- so the command
 * is copyable rather than only printed, and it stays selectable so the reader
 * with no shared clipboard can still read it off and type it.
 */
function RunCommand() {
  const theme = useThemeTokens();
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The hold is a timer on a component that can leave with the sheet before it
  // fires, and a `setCopied` after that is a warning in the log at best.
  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityHint={t`Copies it, ready to paste into a terminal`}
      accessibilityLabel={copied ? t`Command copied` : t`Copy the command that starts simfarm`}
      testID="simfarm-run-command"
      onPress={() => {
        void (async () => {
          await Clipboard.setStringAsync(SIMFARM_RUN_COMMAND);
          void feedback('success');
          setCopied(true);
          if (resetTimer.current) clearTimeout(resetTimer.current);
          resetTimer.current = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
        })();
      }}
      style={[styles.commandRow, { backgroundColor: theme.colors.surfaceRaised }]}>
      {/* Two lines, not one shrunk to fit: the command wraps at the widths this
          is read at -- a phone sheet and a Pad's narrower column -- and a
          command scaled down until it fits is a command nobody can read off the
          screen. */}
      <Text
        selectable
        numberOfLines={2}
        style={[styles.command, { color: theme.colors.textMuted }]}>
        {SIMFARM_RUN_COMMAND}
      </Text>
      {copied ? (
        <Check size={16} color={theme.colors.primary} strokeWidth={2} />
      ) : (
        <CopyIcon size={16} color={theme.colors.textMuted} strokeWidth={2} />
      )}
    </PressableScale>
  );
}

/** The glyph's disc, and the glyph inside it at the SSH empty state's size. */
const GLYPH_SIZE = 72;

/** The focused field's clearance above the keyboard and its toolbar. */
const KEYBOARD_BOTTOM_OFFSET = 88;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  middle: { textAlign: 'center' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 12,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 20,
    lineHeight: 25,
    includeFontPadding: false,
  },
  // Shape only; the fill comes from `GlassChrome`, as it does in the Files
  // sheet and in the server page's header circles.
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
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  column: { width: '100%', maxWidth: 420, alignItems: 'center', gap: 12 },
  glyph: {
    width: GLYPH_SIZE,
    height: GLYPH_SIZE,
    borderRadius: GLYPH_SIZE / 2,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  sheetPad: { paddingHorizontal: 24, paddingBottom: 24 },
  embeddedPad: { paddingHorizontal: 12, paddingBottom: 12 },
  commandRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  command: {
    flex: 1,
    // Not the design system's `label` role, which is 11pt uppercase with
    // tracking: a shell command that has been upper-cased is a shell command
    // that does not run. This is the one string here that has to be reproduced
    // character for character, so it gets a monospace face and no transform.
    fontFamily: Platform.OS === 'ios' ? 'ui-monospace' : 'monospace',
    fontSize: 12,
    lineHeight: 17,
  },
  // Wraps rather than overflows: the narrowest host is the Pad column, where
  // the label, the field and the button do not always fit on one line.
  portRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    maxWidth: '100%',
  },
  port: { width: 92 },
  lookAgain: { paddingHorizontal: 16 },
});
