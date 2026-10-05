import { useSurfaceBackground } from '@/hooks/use-surface-background';
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
import { KeyboardToolbar, useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import {
  SheetScene,
  SheetSceneAction,
  SheetSceneField,
  contentSizedBottomPadding,
  SHEET_LADDER,
  sheetSceneStyles,
  useSheetSceneInputStyle,
} from '@/components/sheet-scene';
import { appChrome } from '@/constants/appearance';
import { fadeIn, fadeOut, listLayout, riseIn, STAGGER } from '@/lib/motion';
import { isSafeExternalLink } from '@/lib/safe-link';
import { describeWebServiceUrl, parsePort, webServiceUrl } from '@/lib/web-service';
import { probeWebService } from '@/lib/web-service-probe';
import { useRenderTally } from '@/lib/render-tally';
import { useServerWebPorts } from '@/stores/server-web-ports';
import { FontedTextInput } from '@/components/fonted-text-input';

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
  const surfaceBackground = useSurfaceBackground();
  const inputStyle = useSheetSceneInputStyle();
  const insets = useSafeAreaInsets();
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
      {/*
        The scene is the route's root, with no scroller around it -- the shape
        every other content-sized sheet has. This one used to sit in a
        `KeyboardAwareScrollView` with `flex: 1`, which inside a
        `fitToContents` sheet is a viewport sized by its own content: the
        sheet measured one height and drew the column taller, so the action
        hung off the bottom edge, and on Android a vertical scroller under the
        grabber that is not a nested-scrolling child takes the downward drag
        the sheet needs to close (see `SheetScene`). One field needs no
        scrolling, and the native sheet already rides up with the keyboard.
      */}
      <SheetScene
        testID="open-web-service-sheet"
        title={t`Open in your browser`}
        caption={label}
        contentSized>
        {/* The bottom room `agent-guide-sheet.tsx` gives its content-sized
            column: the home indicator, or the ladder's section where there is
            none. Not `SheetSceneFooter`, whose keyboard strip is for a
            scroller -- here the native sheet rides the keyboard itself. */}
        <View
          style={[
            sheetSceneStyles.column,
            { paddingBottom: contentSizedBottomPadding(insets.bottom) },
          ]}>
          <SheetSceneField
            label={t`Port`}
            hint={target ? describeWebServiceUrl(target) : undefined}
            error={error ?? undefined}>
            <FontedTextInput
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
              // Not translated: a port is a number, and 3000 is the one a
              // reader is most likely to already have running.
              placeholder="3000"
              placeholderTextColor={theme.colors.textSubtle}
              returnKeyType="go"
              onSubmitEditing={() => {
                if (port !== null) void open(port);
              }}
              style={inputStyle}
            />
          </SheetSceneField>

          {/* Under the field, not instead of it: the remembered ports are a
              shortcut, and a shortcut that hides the long way round is a trap
              the first time it does not have the port that was meant. */}
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
                      // The field follows the tap so the address line above
                      // still describes what is about to open.
                      setPortText(String(recent));
                      void open(recent);
                    }}
                    style={[
                      styles.chip,
                      {
                        borderColor: theme.colors.border,
                        backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                      },
                    ]}>
                    <Text variant="data">{String(recent)}</Text>
                  </PressableScale>
                </Animated.View>
              ))}
            </View>
          ) : null}

          {wasSilent ? (
            <Animated.View
              entering={fadeIn('micro')}
              exiting={fadeOut('micro')}
              layout={listLayout('short')}>
              {/* Both readings, because from this phone they are the same
                  event: a refused connection, a loopback-bound server and an
                  empty port are indistinguishable here. Naming the one that
                  is fixable is the most useful thing this sheet can do;
                  claiming to know which one happened would be a guess. */}
              <Text variant="caption" color={theme.colors.warning}>
                <Trans>
                  Nothing answered on port {port}. Either nothing is listening, or it is bound to
                  localhost only — restart it with --host 0.0.0.0 to reach it from here.
                </Trans>
              </Text>
            </Animated.View>
          ) : null}

          <SheetSceneAction
            testID="open-web-service-submit"
            label={checking ? t`Checking…` : wasSilent ? t`Open anyway` : t`Open`}
            busy={checking}
            disabled={target === null}
            onPress={() => {
              if (port !== null) void open(port);
            }}
          />
        </View>
      </SheetScene>
      {/* One field here, so the arrows would only ever point at themselves.
        Opaque on purpose: see the same toolbar in `new-task-sheet.tsx` for why
        kit 1.1.0's `backgroundColor` is not the pack's surface opacity here.
        Android only. In an iOS form sheet the sticky toolbar is laid out
        against the sheet, not the window: with the keyboard up it landed over
        the Port field, and with it down it peeked out under the sheet. iOS
        has its own bar there anyway -- React Native gives a number pad with a
        return key type an accessory with that key, here Go. */}
      {Platform.OS === 'ios' ? null : <KeyboardToolbar showArrows={false} doneText={t`Done`} />}
    </>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SHEET_LADDER.gap,
    paddingTop: SHEET_LADDER.gap,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: SHEET_LADDER.snug,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
