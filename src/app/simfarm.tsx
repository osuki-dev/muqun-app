/**
 * The simulator preview's route.
 *
 * The route binds to its computer's paired record and checks that computer's
 * current Gateway health before offering the simulator service. A deep link
 * cannot grant access, and opening this screen never changes Home's selection.
 *
 * The port comes from the mirror when one has been found before and is otherwise
 * left to the preview's own default -- the probe is what decides, and it writes
 * back through `remember` so the second visit skips the look.
 *
 * ## Why this is a full-screen modal and not a sheet
 *
 * It was a form sheet, at the full detent with a grabber, and on a phone that
 * was wrong twice over. The sheet's own dismissal is a one-finger drag, and
 * one finger on the picture is the device's -- the two recognisers fought on
 * every downward swipe, so a scroll in the app under test was as likely to
 * start closing the preview as to scroll. And the sheet's content was
 * transparent so the system could draw its card, which on Android meant the
 * terminal underneath showed through everything the stage did not paint. A
 * full-screen modal has no drag to dismiss and no card to be transparent for:
 * the ground is the theme's background from the root options, every one-finger
 * gesture on the picture reaches the device, and the ways off the screen are
 * the close button and, on Android, the hardware back.
 *
 * ## The system bars
 *
 * Hidden while this is open, so the picture is the only thing on the phone --
 * the status bar through the component rather than a screen option, because
 * the app's status bar appearance is not view-controller based and the
 * component's prop stack is what restores the root's entry when this unmounts,
 * whichever way it was left: the close button, the hardware back, or the app
 * being torn down. `slide` matches the modal's own transition. Android's
 * navigation bar is hidden for the whole app already (see `_layout.tsx`); it
 * is re-asserted here on open and on every return to the foreground, because
 * a full-screen change is exactly the kind of exit after which the system
 * brings it back.
 *
 * ## Back on Android
 *
 * The hardware back closes the preview and is never sent to the emulator;
 * the emulator's own Back is an item in the floating button's menu. While
 * that menu is open the stage answers the key first and closes the menu
 * instead -- it subscribes when the menu opens, which makes it the newer
 * subscriber and the one React Native asks first (`simfarmBackPress` is the
 * rule). Predictive back is off for the app. What the left edge does was measured on the emulator with
 * gesture navigation and this screen's bars hidden: a swipe from the
 * system's own strip (the outermost ~24dp) never reaches the app -- Android
 * uses it to show the bars for a moment, and while they are showing a second
 * one is the back gesture -- and a swipe that begins past the strip is
 * delivered to the picture. The stage widens the device's edge band on
 * Android to cover the strip just inside the system's, so that swipe is sent
 * with the edge byte and the simulator treats it as its own edge gesture
 * (`simfarmEdgeBands`).
 */
import { useLingui } from '@lingui/react/macro';
import { Button, Spinner, Text } from '@osuki-dev/ui';
import * as NavigationBar from 'expo-navigation-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';
import { AppState, BackHandler, Platform } from 'react-native';

import { SimfarmNotice, SimfarmPreview } from '@/components/simfarm-preview';
import { DevicesIcon } from '@/icons';
import { useServerSimfarmAccess } from '@/hooks/use-server-simfarm-access';
import { useServerSimfarm } from '@/stores/server-simfarm';

export default function SimfarmScreen() {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  const { t } = useLingui();
  const params = useLocalSearchParams<{ serverId: string }>();
  const access = useServerSimfarmAccess(params.serverId);
  const { record } = access;

  const ports = useServerSimfarm((state) => state.byServer);
  const hydrate = useServerSimfarm((state) => state.hydrate);
  const remember = useServerSimfarm((state) => state.remember);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  // The hardware back is this screen's, so it is answered here and stops:
  // `true` keeps the navigator from also popping, and nothing forwards it.
  // The stage answers first while its menu is open; see the note above.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const hide = () => void NavigationBar.setVisibilityAsync('hidden');
    hide();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') hide();
    });
    return () => subscription.remove();
  }, []);

  const serverId = record?.serverId;
  const onPortFound = useCallback(
    (port: number) => {
      if (serverId) void remember(serverId, port);
    },
    [remember, serverId]
  );

  return (
    <>
      <StatusBar hidden animated hideTransitionAnimation="slide" />
      {access.status === 'loading' ? (
        <SimfarmNotice embedded={false} onClose={close} title={t`Connecting`}>
          <Spinner size="sm" />
        </SimfarmNotice>
      ) : access.status === 'unpaired' || !record ? (
        <SimfarmNotice
          embedded={false}
          onClose={close}
          icon={<DevicesIcon size={40} />}
          title={t`Pair a computer first`}>
          <Text selectable variant="bodySmall" style={{ textAlign: 'center' }}>
            {t`Pair the computer that runs your simulator, then return here to open its preview.`}
          </Text>
          <Button testID="simfarm-pair" onPress={() => router.push('/explore')}>
            {t`Pair a computer`}
          </Button>
        </SimfarmNotice>
      ) : access.status === 'offline' ? (
        <SimfarmNotice
          embedded={false}
          onClose={close}
          icon={<DevicesIcon size={40} />}
          title={t`Computer offline`}>
          <Text variant="bodySmall" style={{ textAlign: 'center' }}>
            {record.label}
          </Text>
          <Button testID="simfarm-gateway-retry" onPress={access.refresh}>{t`Reconnect`}</Button>
        </SimfarmNotice>
      ) : (
        <SimfarmPreview
          gatewayUrl={record.url}
          serverId={record.serverId}
          allowed={access.status === 'ready'}
          initialPort={ports[record.serverId]}
          onPortFound={onPortFound}
          // The modal is the only host with something to dismiss, so it is the
          // only one that gets a close button. The Pad column is part of the
          // workspace and is closed from the quick actions that opened it.
          onClose={close}
        />
      )}
    </>
  );
}
