import { useLingui } from '@lingui/react/macro';
import { Button, Input, Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { parsePort } from '@/lib/web-service';
import {
  SIMFARM_DEFAULT_PORT,
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
 * Three states, and the middle one is the point of the whole design: most
 * machines need no configuration at all. simfarm has a default port and the
 * host is already on the tailnet, so the app looks first and only asks when
 * looking failed. A port field that appears every time would be a form charging
 * rent on the common case.
 */
export function SimfarmPreview({
  gatewayUrl,
  allowed,
  initialPort,
  onPortFound,
  /** Beside the terminal rather than in a sheet: no padding, no heading. */
  embedded = false,
}: {
  gatewayUrl: string | undefined;
  /** Whether this connection may be offered the preview; see `probeSimfarm`. */
  allowed: boolean;
  initialPort?: number;
  /** Called with a port that answered, so the caller can remember it. */
  onPortFound?: (port: number) => void;
  embedded?: boolean;
}) {
  const theme = useThemeTokens();
  const { t } = useLingui();

  const [port, setPort] = useState(initialPort ?? SIMFARM_DEFAULT_PORT);
  const [portText, setPortText] = useState(String(initialPort ?? SIMFARM_DEFAULT_PORT));
  const [probe, setProbe] = useState<SimfarmProbe | null>(null);
  // Guards a probe that returns after the reader has already asked for another
  // one; without it a slow answer for the old port can overwrite a fresh miss.
  const attempt = useRef(0);

  const look = useCallback(
    async (candidate: number) => {
      const mine = (attempt.current += 1);
      setProbe(null);
      const result = await probeSimfarm(gatewayUrl, candidate, allowed);
      if (attempt.current !== mine) return;
      setProbe(result);
      if (result.found) onPortFound?.(candidate);
    },
    [allowed, gatewayUrl, onPortFound]
  );

  useEffect(() => {
    void look(port);
  }, [look, port]);

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
  const url = simfarmThemedClientUrl(gatewayUrl, port, colors);

  if (probe === null) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <Spinner size="sm" />
        <Text variant="caption" color={theme.colors.textMuted}>
          {t`Looking for a simulator`}
        </Text>
      </View>
    );
  }

  if (probe.found && url !== null) {
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
          onError={() => setProbe({ found: false, reason: 'unreachable' })}
        />
      </View>
    );
  }

  // `blocked` should not reach here: the entry that opens this is hidden on a
  // connection that fails the gate, because a control that can never work is
  // furniture. It is handled anyway rather than falling through to a port
  // field, which would invite the reader to fix something a number cannot fix.
  if (probe.found === false && probe.reason === 'blocked') {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <Text variant="caption" color={theme.colors.textMuted} style={styles.middle}>
          {t`A preview is only offered over Tailscale or HTTPS.`}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.centre,
        embedded ? styles.embeddedPad : styles.sheetPad,
        { backgroundColor: theme.colors.background },
      ]}>
      <Text variant="label" color={theme.colors.text} style={styles.middle}>
        {t`No simulator on port ${port}`}
      </Text>
      <Text variant="caption" color={theme.colors.textMuted} style={styles.middle}>
        {t`Run simfarm on that machine, or say which port it is on.`}
      </Text>
      <View style={styles.row}>
        <Input
          value={portText}
          onChangeText={setPortText}
          keyboardType="number-pad"
          returnKeyType="go"
          placeholder={String(SIMFARM_DEFAULT_PORT)}
          accessibilityLabel={t`simfarm port`}
          testID="simfarm-port"
          // `containerStyle`, not `style`: this Input hands `style` to the
          // TextInput inside its own full-width wrapper, so a width there sized
          // the text box and left the wrapper as wide as the screen. The row
          // then overflowed both edges -- the port lost its first digit on the
          // left and Look again was cut off on the right.
          containerStyle={styles.port}
          onSubmitEditing={() => {
            const parsed = parsePort(portText);
            if (parsed !== null) setPort(parsed);
          }}
        />
        <Button
          disabled={parsePort(portText) === null}
          onPress={() => {
            const parsed = parsePort(portText);
            if (parsed !== null) setPort(parsed);
          }}>
          {t`Look again`}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  middle: { textAlign: 'center' },
  sheetPad: { paddingHorizontal: 24 },
  embeddedPad: { paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, maxWidth: '100%' },
  port: { width: 104 },
});
