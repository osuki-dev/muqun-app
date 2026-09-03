/**
 * Open a web service that is running on the machine this phone is paired to.
 *
 * The shape is argued from what the reader actually knows. They are not
 * browsing -- they started a dev server a minute ago and they know its port. So
 * there is no list to choose from and nothing is enumerated: the ports they have
 * opened before are chips, and under them is the field for the one they have
 * not. Same order as the New task sheet's directories, for the same reason --
 * typing on a phone is the fallback, not the interface.
 *
 * The one thing worth remembering about this sheet is the line under the field.
 * It assembles the address as the port is typed, so before anything is opened
 * the reader can see the machine's own name with their number on the end. That
 * line is the feature explaining itself: no forwarding is being set up, nothing
 * is being exposed, the phone is simply already on the same network as that
 * host and is about to ask it for a page.
 *
 * Nothing here is a promise that the service exists. The probe runs from this
 * device because this device is what opens the URL, and when it hears nothing
 * back the sheet says so and still offers the open -- a server can answer on a
 * path and not on `/`, and a check that blocked would be wrong more often than
 * it was right.
 */
import { Button, Input, KeyboardToolbar, Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { LADDER } from '@/components/settings-chrome';
import { fadeIn, fadeOut, listLayout, riseIn, STAGGER } from '@/lib/motion';
import { isSafeExternalLink } from '@/lib/safe-link';
import { describeWebServiceUrl, parsePort, webServiceUrl } from '@/lib/web-service';
import { probeWebService } from '@/lib/web-service-probe';
import { useRenderTally } from '@/lib/render-tally';
import { useServerWebPorts } from '@/stores/server-web-ports';

/** The focused field's clearance above the keyboard and its toolbar. */
const KEYBOARD_BOTTOM_OFFSET = 88;

export function OpenWebServiceSheet({
  serverId,
  label,
  gatewayUrl,
  onClose,
}: {
  /** The local record id, which is what the remembered ports are keyed by. */
  serverId: string;
  /** The server's name, for saying whose machine this is. */
  label: string;
  /**
   * The address this device reaches the gateway on.
   *
   * Only its scheme and host are used; the port is replaced by the typed one.
   * See `webServiceUrl` for why nothing else is carried across.
   */
  gatewayUrl: string;
  onClose: () => void;
}) {
  // `t` from the hook, never the global `t` from `@lingui/core/macro`: React
  // Compiler memoizes a global `t` call whose arguments have not changed and
  // has no way to know the result also depends on the active locale.
  const { t } = useLingui();
  const theme = useThemeTokens();
  useRenderTally('OpenWebServiceSheet');

  const hydrate = useServerWebPorts((state) => state.hydrate);
  const remember = useServerWebPorts((state) => state.remember);
  const recentPorts = useServerWebPorts((state) => state.byServer[serverId]);

  const [portText, setPortText] = useState('');
  const [checking, setChecking] = useState(false);
  /**
   * The port the last probe heard nothing on.
   *
   * Held as the port rather than a boolean so that editing the field clears the
   * warning by itself: a note about 3000 must not still be on screen under a
   * field that now says 8080.
   */
  const [silentPort, setSilentPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydrated from the leaf that needs it, the way every per-server mirror in
  // this app is, so no screen has to know this one exists to open the sheet.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // The sheet can be dismissed while a probe is still out; nothing that comes
  // back after that may set state on a screen the reader has left.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const port = parsePort(portText);
  const target = port === null ? null : webServiceUrl(gatewayUrl, port);
  const wasSilent = port !== null && silentPort === port;

  async function open(port: number) {
    const url = webServiceUrl(gatewayUrl, port);
    if (!url) return;
    setError(null);

    // Asked once per port. A reader who has already been told nothing answered
    // and pressed the button again is not asking to be checked a second time,
    // they are overriding -- so the second press opens.
    if (silentPort !== port) {
      setChecking(true);
      const heard = await probeWebService(url);
      if (!live.current) return;
      setChecking(false);
      if (heard === 'silent') {
        setSilentPort(port);
        return;
      }
    }

    // Written down before the browser takes over: this app is about to go to
    // the background, and a shortcut that only survived a graceful return would
    // be missing exactly when the reader came back for it.
    await remember(serverId, port);
    if (!isSafeExternalLink(url)) return;
    try {
      await Linking.openURL(url);
    } catch {
      if (!live.current) return;
      setError(t`No app on this phone opens web pages.`);
      return;
    }
    onClose();
  }

  return (
    <>
      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        keyboardShouldPersistTaps="handled"
        style={[styles.sheet, { backgroundColor: theme.colors.surface }]}
        contentContainerStyle={styles.content}>
        {/* iOS draws the grabber itself; Android's form sheet does not, and a
            sheet with no handle reads as a screen that arrived from the wrong
            direction. Every sheet in this app carries the same two lines. */}
        {process.env.EXPO_OS === 'android' ? <View style={styles.handle} /> : null}

        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text variant="bodySmall" style={styles.title}>
              <Trans>Open in your browser</Trans>
            </Text>
            <Text variant="caption" color={theme.colors.textMuted}>
              <Trans>
                Anything {label} is serving on a port — a dev server, a preview, a dashboard.
              </Trans>
            </Text>
          </View>
          <GlassChrome face="sheet" style={styles.closeButton}>
            <PressableScale accessibilityLabel={t`Close`} onPress={onClose} style={styles.closeHit}>
              <X size={18} color={theme.colors.text} />
            </PressableScale>
          </GlassChrome>
        </View>

        <View style={styles.section}>
          <Text variant="caption" color={theme.colors.textMuted} style={styles.sectionLabel}>
            <Trans>PORT</Trans>
          </Text>

          {recentPorts && recentPorts.length > 0 ? (
            <View style={styles.chips}>
              {recentPorts.map((recent, index) => (
                <Animated.View
                  key={recent}
                  entering={riseIn(index * STAGGER.row)}
                  layout={listLayout('short')}>
                  <PressableScale
                    accessibilityLabel={t`Open port ${recent}`}
                    testID={`open-web-service-recent-${recent}`}
                    disabled={checking}
                    onPress={() => {
                      // The field follows the tap so the address line below
                      // still describes what is about to open.
                      setPortText(String(recent));
                      void open(recent);
                    }}
                    style={[
                      styles.chip,
                      {
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surfaceRaised,
                      },
                    ]}>
                    <Text variant="data">{String(recent)}</Text>
                  </PressableScale>
                </Animated.View>
              ))}
            </View>
          ) : null}

          {/* Under the chips, not instead of them: the remembered ports are a
              shortcut, and a shortcut that hides the long way round is a trap
              the first time it does not have the port that was meant. */}
          {/* No `label`: the design system draws one uppercased, which is the
              same word as the section eyebrow above and printed "PORT" twice.
              The prompt field in the New task sheet is bare for the same
              reason -- the eyebrow is the label. The accessible name has to be
              said explicitly once the visible one belongs to the section. */}
          <Input
            accessibilityLabel={t`Port`}
            testID="open-web-service-port"
            value={portText}
            onChangeText={(value) => {
              setPortText(value);
              setError(null);
            }}
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            // Not translated: a port is a number, and 3000 is the one a reader
            // is most likely to already have running.
            placeholder="3000"
            variant="outline"
            returnKeyType="go"
            onSubmitEditing={() => {
              if (port !== null) void open(port);
            }}
          />

          {/* The address, assembled as it is typed. This is what makes the
              feature legible: the machine's own name with the reader's number
              on the end, and nothing in between that anyone had to configure. */}
          {target ? (
            <Animated.View entering={fadeIn('micro')} exiting={fadeOut('micro')}>
              <Text variant="data" color={theme.colors.textMuted} style={styles.address}>
                {describeWebServiceUrl(target)}
              </Text>
            </Animated.View>
          ) : null}
        </View>

        {wasSilent ? (
          <Animated.View
            entering={fadeIn('micro')}
            exiting={fadeOut('micro')}
            layout={listLayout('short')}>
            {/* Both readings, because from this phone they are the same event:
                a refused connection, a loopback-bound server and an empty port
                are indistinguishable here. Naming the one that is fixable is
                the most useful thing this sheet can do; claiming to know which
                one happened would be a guess. */}
            <Text variant="caption" color={theme.colors.warning}>
              <Trans>
                Nothing answered on port {port}. Either nothing is listening, or it is bound to
                localhost only — restart it with --host 0.0.0.0 to reach it from here.
              </Trans>
            </Text>
          </Animated.View>
        ) : null}

        <Button
          testID="open-web-service-submit"
          onPress={() => {
            if (port !== null) void open(port);
          }}
          disabled={checking || target === null}>
          {checking ? t`Checking…` : wasSilent ? t`Open anyway` : t`Open`}
        </Button>

        {error ? (
          <Animated.View
            entering={fadeIn('micro')}
            exiting={fadeOut('micro')}
            layout={listLayout('short')}>
            <Text selectable variant="caption" color={theme.colors.danger}>
              {error}
            </Text>
          </Animated.View>
        ) : null}
      </KeyboardAwareScrollView>
      {/* One field here, so the arrows would only ever point at themselves. */}
      <KeyboardToolbar showArrows={false} doneText={t`Done`} />
    </>
  );
}

const styles = StyleSheet.create({
  // `flex: 1`, not `height: '100%'`: inside a native form sheet the container's
  // height is not resolved when a percentage is measured and the sheet renders
  // empty. Every other sheet in this app fills the same way.
  sheet: { flex: 1 },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap,
    paddingBottom: LADDER.section,
    gap: LADDER.gutter,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: LADDER.tight / 2 },
  // The panels sheet's title size, so every sheet agrees on how one announces
  // itself.
  title: { fontSize: 20, lineHeight: 25, includeFontPadding: false },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeHit: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: LADDER.gap },
  sectionLabel: { marginLeft: LADDER.tight },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: LADDER.gap },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: LADDER.snug,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  address: { marginLeft: LADDER.tight, includeFontPadding: false },
});
