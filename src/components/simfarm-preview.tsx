import { Input, Spinner, useThemeTokens, Button, Text } from '@osuki-dev/ui';
import { GuideCommand } from '@/components/guide-command';
import { Trans, useLingui } from '@lingui/react/macro';
import { LockedIcon, DevicesIcon } from '@/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SimfarmNotice } from '@/components/simfarm-notice';
import { SimfarmStage } from '@/components/simfarm-stage';
import { SIMFARM_DEFAULT_PORT, SIMFARM_RUN_COMMAND, simfarmSocketUrl } from '@/lib/simfarm';
import { probeSimfarm, type SimfarmProbe } from '@/lib/simfarm-client';
import { reconnectSimfarm, warmSimfarm } from '@/lib/simfarm-stream';
import { parsePort } from '@/lib/web-service';

export { SimfarmNotice } from '@/components/simfarm-notice';

/**
 * The simulator on the paired machine, drawn where the reader is standing.
 *
 * One component with two hosts: a full-screen modal on a phone, and the
 * right-hand column beside the terminal on a Pad. They are the same thing in
 * different amounts of space, and splitting them into two components would be
 * two places to fix the next thing simfarm changes.
 *
 * ## Why it draws the picture itself now
 *
 * It used to be simfarm's own browser client in a web view, on the reasoning
 * that the reference client already did the drawing and the touch forwarding
 * and was the thing the protocol is tested against -- with the option of a
 * native client left open for the day the seam actually hurt. This is that day,
 * and the seam is that simfarm's client is an instrument for a window on a
 * desk. Measured on the phone this was reported from, in the client's own
 * numbers: a 402x812pt sheet, out of which it reserves a 72pt rail column, 24pt
 * of margin and a 56pt pill row, then snaps the remaining 69% down to the
 * largest of 50/75/100% that fits -- so it drew a 201pt-wide picture, half the
 * width of the screen, with 375pt of empty background above and below it. Its
 * device picker sits in the top 14pt of the window, which on a sheet is
 * underneath the grabber, so the one control needed to get a picture at all
 * could not be pressed.
 *
 * None of that is reachable from outside a page. The fit rule and the touch
 * mapping now live in `simfarm-frame.ts` where they can be tested, the wire
 * format in `simfarm-protocol.ts`, and the socket in `simfarm-stream.ts`.
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
  serverId,
  allowed,
  initialPort,
  onPortFound,
  onClose,
  /** Beside the terminal rather than over the screen: no insets, no heading. */
  embedded = false,
}: {
  gatewayUrl: string | undefined;
  serverId?: string;
  /** Whether this connection may be offered the preview; see `probeSimfarm`. */
  allowed: boolean;
  initialPort?: number;
  /** Called with a port that answered, so the caller can remember it. */
  onPortFound?: (port: number) => void;
  /**
   * Dismiss, for the host that is a modal. Absent when there is nothing to
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
  /**
   * How many streams this port has had.
   *
   * The stage's key: a socket that dropped cannot be revived from inside, and
   * the honest way back is a new one -- so Look again there re-probes *and*
   * remounts, and the two outcomes are the two this screen already draws.
   */
  const [session, setSession] = useState(0);
  const [selectedDevice, setSelectedDevice] = useState<string | undefined>();
  const [configuring, setConfiguring] = useState(false);

  const look = useCallback(
    async (candidate: number) => {
      const mine = (attempt.current += 1);
      setLooking(true);
      // The socket beside the probe rather than after it: the two are
      // independent round trips to the same port, and a look that finds a
      // simfarm finds the socket already open. One that finds nothing finds
      // the socket already dead, which costs nothing.
      warmSimfarm(simfarmSocketUrl(gatewayUrl, candidate), allowed);
      const result = await probeSimfarm(gatewayUrl, candidate, allowed);
      if (attempt.current !== mine) return;
      setAnswer({ port: candidate, probe: result });
      setLooking(false);
      if (result.found) {
        setConfiguring(false);
        onPortFound?.(candidate);
      }
    },
    [allowed, gatewayUrl, onPortFound]
  );

  useEffect(() => {
    void look(askedPort);
  }, [askedPort, look]);

  const submitPort = useCallback(() => {
    const parsed = parsePort(portText);
    if (parsed === null) return;
    if (parsed === askedPort) void look(parsed);
    else setAskedPort(parsed);
  }, [askedPort, look, portText]);

  const url = answer === null ? null : simfarmSocketUrl(gatewayUrl, answer.port);

  // The first look, before there is anything to report. A second and subsequent
  // look does *not* land here: it keeps the miss on screen and spins inside the
  // Look again button, so pressing it does not blank the screen the reader is
  // reading and then rebuild it.
  if (answer === null) {
    return (
      <SimfarmNotice embedded={embedded} onClose={onClose}>
        <Spinner size="sm" />
        <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.middle}>
          {t`Looking for a simulator`}
        </Text>
      </SimfarmNotice>
    );
  }

  if (answer.probe.found && url !== null && !configuring) {
    return (
      <SimfarmStage
        // Bumped when the stream drops, so pressing Look again there gets a
        // new socket rather than the dead one it was just told about.
        key={session}
        url={url}
        devices={answer.probe.devices}
        initialDeviceId={selectedDevice}
        embedded={embedded}
        onClose={onClose}
        onConfigure={() => setConfiguring(true)}
        onLost={(deviceId) => {
          setSelectedDevice(deviceId);
          reconnectSimfarm(url);
          setSession((count) => count + 1);
          void look(answer.port);
        }}
      />
    );
  }

  // `blocked` should not reach here: the entry that opens this is hidden on a
  // connection that fails the gate, because a control that can never work is
  // furniture. It is handled anyway rather than falling through to a port
  // field, which would invite the reader to fix something a number cannot fix
  // -- and so it says which connection would work instead.
  if (answer.probe.found === false && answer.probe.reason === 'blocked') {
    return (
      <SimfarmNotice
        embedded={embedded}
        onClose={onClose}
        icon={<LockedIcon size={40} color={theme.colors.textMuted} />}
        title={t`No preview on this connection`}>
        <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.middle}>
          <Trans>
            A simulator can be driven and not only watched, so a preview is offered only over
            Tailscale or HTTPS. Pair this machine at its tailnet address, or serve its gateway over
            HTTPS, and the preview appears on its own.
          </Trans>
        </Text>
      </SimfarmNotice>
    );
  }

  // The port the miss is about, which is `askedPort` except during a re-look.
  const port = answer.port;

  return (
    <SimfarmNotice
      embedded={embedded}
      onClose={onClose}
      icon={<DevicesIcon size={40} color={theme.colors.textMuted} />}
      title={configuring ? t`Simulator connection` : t`No simulator on port ${port}`}>
      <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.middle}>
        {answer.probe.found ? (
          t`Enter the simulator service port on this computer.`
        ) : (
          <Trans>
            simfarm is the small program on that machine that serves this preview. Either it is not
            running, or it is listening on another port.
          </Trans>
        )}
      </Text>
      {!answer.probe.found ? <RunCommand serverId={serverId} /> : null}
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
      {configuring && answer.probe.found ? (
        <Button testID="simfarm-configure-cancel" onPress={() => setConfiguring(false)}>
          {t`Return to preview`}
        </Button>
      ) : null}
    </SimfarmNotice>
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
function RunCommand({ serverId }: { serverId: string | undefined }) {
  const { t } = useLingui();
  // The machine with no simfarm is the one this preview asks: the computer
  // the app is pointed at.
  return (
    <GuideCommand
      serverId={serverId}
      command={SIMFARM_RUN_COMMAND}
      testID="simfarm-run-command"
      copyLabel={t`Copy the command that starts simfarm`}
      copiedLabel={t`Command copied`}
      copyHint={t`Copies it, ready to paste into a terminal`}
      // Two lines, not one shrunk to fit: it wraps at the widths this is read
      // at -- a phone and a Pad's narrower column.
      numberOfLines={2}
    />
  );
}

const styles = StyleSheet.create({
  middle: { textAlign: 'center' },
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
