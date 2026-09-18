import { RouteScene } from '@/components/route-scene';
import { sheetPresentationOptions, sheetRoutePresentations } from '@/lib/route-presentation';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import {
  ThemeProvider as OsukiThemeProvider,
  ToastProvider,
  useThemeMode,
  useThemeTokens,
} from '@osuki-dev/ui';
import * as NavigationBar from 'expo-navigation-bar';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { AppState, LogBox, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useReducedMotion } from 'react-native-reanimated';
import { NAVIGATION_MOTION } from '@/lib/motion';

import { SplashScreen } from '@osuki-dev/react-native-splash';

import { LaunchOverlay } from '@/components/launch-overlay';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { AppLockGate } from '@/components/app-lock-gate';
import { SshConnectPromptGate } from '@/components/ssh-connect-prompt-gate';
import { UpdateStatusBanner } from '@/components/update-status-banner';
import { InAppNotificationHost } from '@/components/in-app-notification-host';
import { WhatsNewCard } from '@/components/whats-new-card';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useLaunchImageSync } from '@/hooks/use-launch-image-sync';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useThemePack, useThemePalette } from '@/hooks/use-theme-pack';
import { useThemeLibrary } from '@/stores/theme-library';
import { AppI18nProvider } from '@/i18n/provider';
import { useGatewayPushRegistration, useNotificationObserver } from '@/lib/notifications';
import { useAppSettings } from '@/stores/app-settings';
import { useSshTunnelsStore } from '@/stores/ssh-tunnels';
import { useThemeFileOpen } from '@/hooks/use-theme-file-open';

/**
 * One library warning, silenced, because LogBox answers it by covering the
 * composer.
 *
 * reanimated 4.6 warns on native -- per render, `__DEV__` only -- whenever a
 * dependency list is passed to one of its hooks, and it arrives several hundred
 * times in a session. Every remaining source is a library:
 * react-native-keyboard-controller's `useHandler` and its scroll views,
 * gesture-handler's `ReanimatedSwipeable` and `ReanimatedDrawerLayout`. This
 * app's own call sites have none left, and
 * `src/components/__tests__/reanimated-dependencies.test.ts` is what keeps it
 * that way, so nothing of ours is being hidden here.
 *
 * Silenced rather than tolerated because LogBox does not merely log it. The
 * warning notification is pinned across the bottom of the screen, which is
 * where a terminal dock is: on the SSH shell it landed exactly on
 * `ssh-composer-input`, so the first tap on the field went to the notification
 * and dismissed it and only the second reached the field. Ignored by its exact
 * text and nothing else, so every other warning still raises the notification
 * the way it always did.
 */
LogBox.ignoreLogs(['[Reanimated] dependencies should only be used in web implementation.']);

/*
 * Keep the native launch screen up until `LaunchOverlay` has painted its copy
 * of it. Module scope, because React content can appear -- and the native
 * side would auto-hide on it -- before any effect runs.
 */
SplashScreen.preventAutoHide();

/**
 * The theme library is read here, at module scope, and not in an effect.
 *
 * It used to run in `RootLayout`'s mount effect, which meant the first frame
 * was always the default pack and the reader's theme arrived a tick later --
 * harmless while the only thing above the router was a splash overlay pinned
 * to the default colours anyway. It stopped being harmless when the overlay
 * and the lock screen started wearing the pack: both of them render on that
 * first frame, so a theme that lands after it is a theme they cannot see.
 *
 * Affordable because the read is not asynchronous in the first place.
 * `hydrate` is a synchronous MMKV `getString` and a parse, on a value bounded
 * at 16 MiB and in practice a few kilobytes; there is no await to hoist and no
 * network to wait for. It is also safe to call where nothing can catch it: the
 * store's `hydrate` swallows its own failures and publishes an empty library,
 * which is what a platform without MMKV -- web -- gets, and it is idempotent,
 * because the repository behind it is constructed once and memoised.
 */
useThemeLibrary.getState().hydrate();

/**
 * Listens for a theme file handed to the app from outside it.
 *
 * A component rather than a call in `RootLayout` so the listener mounts with
 * the tree it navigates into, and renders nothing of its own.
 */
function ThemeFileOpener() {
  useThemeFileOpen();
  return null;
}

export default function RootLayout() {
  const hydrateSettings = useAppSettings((state) => state.hydrate);

  // The system bar overlays the app under edge-to-edge (targetSdk 36) and its
  // strip swallows every touch in it -- on a three-button device that strip sat
  // exactly on the on-screen keyboard's bottom row. Hidden at build time by the
  // config plugin; re-asserted here because the system restores the bar after
  // some full-screen exits, and a swipe still summons it transiently.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void NavigationBar.setVisibilityAsync('hidden');
  }, []);

  // iPad follows its resizable window instead of enforcing a landscape lock.
  // Keep the existing phone and Android tablet policies separate: an app-wide
  // unlock would also rotate phones. Native iPad orientations are declared in
  // app.json so launch and split-view frames work before JavaScript is ready.
  useEffect(() => {
    let mounted = true;
    void Device.getDeviceTypeAsync()
      .then((deviceType) => {
        if (!mounted) return;
        if (Platform.OS === 'ios' && deviceType === Device.DeviceType.TABLET) {
          return ScreenOrientation.unlockAsync();
        }
        const lock =
          deviceType === Device.DeviceType.TABLET
            ? ScreenOrientation.OrientationLock.LANDSCAPE
            : ScreenOrientation.OrientationLock.PORTRAIT;
        return ScreenOrientation.lockAsync(lock);
      })
      .catch(() => {
        // A platform that cannot answer keeps its manifest-supported shape.
      });
    return () => {
      mounted = false;
    };
  }, []);
  // The pack has to be resolved above the provider, since it *is* the provider's
  // palette. A custom pack is already here -- the library hydrated at module
  // scope, above -- so the first frame carries it, and the splash overlay and
  // the lock screen can be dressed in it rather than in the default. A built-in
  // choice still arrives with `useAppSettings`, a tick later and behind the
  // overlay, since it only ever changes colours that the overlay resolves for
  // itself.
  const pack = useThemePack();
  const theme = useThemePalette(pack);

  useEffect(() => {
    void hydrateSettings();
  }, [hydrateSettings]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <OsukiThemeProvider
          defaultMode="system"
          storageAdapter={{
            getItem: (key) => SecureStore.getItemAsync(key),
            setItem: (key, value) => SecureStore.setItemAsync(key, value),
          }}
          theme={theme}>
          {/*
            Wraps everything except the theme provider the fallback's <Text>
            needs, so a render throw in the toast host, lock gate, nav theme, or
            update banner is caught too -- not just faults inside the router.
          */}
          <AppErrorBoundary>
            {/*
              Inside the error boundary so a fault in locale resolution shows
              the fallback screen rather than a blank app, and outside
              everything else so the boundary's own copy is the only string in
              the tree that cannot be translated.
            */}
            <AppI18nProvider>
              <RootContent />
            </AppI18nProvider>
          </AppErrorBoundary>
        </OsukiThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function RootContent() {
  const reduceMotion = useReducedMotion();
  const { resolvedMode } = useThemeMode();
  const { colors } = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const { record } = useGatewayRecord();
  useNotificationObserver();
  useGatewayPushRegistration(record);
  // The applied pack's picture becomes the native launch screen's, from the
  // next cold start on. See the hook for why this is not JavaScript's job.
  useLaunchImageSync();

  // A backgrounded app with an idle gateway session has its SSH tunnel
  // forwards closed, shrinking the window the loopback port exists in; coming
  // back reopens whatever a screen still holds. See `stores/ssh-tunnels.ts`.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      useSshTunnelsStore.getState().setBackgroundedIdle(state !== 'active');
    });
    return () => subscription.remove();
  }, []);

  // Paints every screen and the transition container with the theme background
  // up front, so switching mode -- or sliding into a server -- never flashes the
  // default white through for a frame. Read from the tokens rather than restated
  // as a literal: a second copy is a second thing to forget when the spec moves.
  const screenBackground = colors.background;

  return (
    <ThemeProvider
      value={{
        ...(resolvedMode === 'dark' ? DarkTheme : DefaultTheme),
        colors: {
          ...(resolvedMode === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
          primary: colors.primary,
          background: colors.background,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
          notification: colors.danger,
        },
      }}>
      {/*
        The toast card is a colored plane over whatever screen raised it, so it
        answers the pack's background opacity like every other surface. Stated
        once here rather than per call: kit 1.1.0 fills all four variants with
        the `surface` token and separates them by icon and accent instead, so a
        single `toastStyle` changes no variant's colour. The reader's slider is
        the applied theme's, not a candidate's -- this sits above the router and
        outside `CandidateThemeProvider`, which is where a toast belongs.
      */}
      <ToastProvider
        maxWidth={480}
        toastStyle={{ backgroundColor: surfaceBackground(colors.surface) }}>
        <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />
        <LaunchOverlay />
        <ThemeFileOpener />
        <AppLockGate>
          <Stack
            screenLayout={({ children, options, route }) =>
              options.presentation === 'formSheet' ? (
                <>{children}</>
              ) : (
                <RouteScene
                  modal={options.presentation === 'fullScreenModal'}
                  sceneType={
                    options.presentation === 'fullScreenModal'
                      ? 'modal'
                      : route.name === 'agent'
                        ? 'agent'
                        : route.name.startsWith('servers') || route.name.startsWith('ssh')
                          ? 'terminal'
                          : 'plain'
                  }
                  animated={route.name !== 'index'}>
                  {children}
                </RouteScene>
              )
            }
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              animationDuration: reduceMotion ? 0 : NAVIGATION_MOTION.pageMs,
              contentStyle: { backgroundColor: screenBackground },
              // A screen nobody is looking at should not be rendering. Home
              // sits under the terminal for as long as the terminal is open,
              // and without this its artwork layers and its one pulse per live
              // server card keep the UI thread at vsync the whole time. Work
              // that must outlive a blur already lives in a store rather than
              // in a screen, so nothing here depends on rendering while hidden.
              freezeOnBlur: true,
            }}>
            <Stack.Screen
              name="index"
              options={{
                animation: 'fade',
                animationDuration: reduceMotion ? 0 : NAVIGATION_MOTION.pageMs,
              }}
            />
            {/* Pages share a depth reveal; native sheets retain their layout contract. */}
            <Stack.Screen
              name="agent"
              options={{
                animation: 'fade',
                animationDuration: reduceMotion ? 0 : NAVIGATION_MOTION.pageMs,
              }}
            />
            <Stack.Screen
              name="settings"
              options={{
                animation: 'fade',
                animationDuration: reduceMotion ? 0 : NAVIGATION_MOTION.pageMs,
              }}
            />
            {/*
              The terminal lives on the root stack rather than in the drawer:
              drawer screens swap without a transition, and its edge-swipe
              gesture fights the terminal's own horizontal panning.
            */}
            <Stack.Screen
              name="servers/[serverId]"
              options={{
                gestureEnabled: false,
                animation: 'fade',
                animationDuration: reduceMotion ? 0 : NAVIGATION_MOTION.pageMs,
              }}
            />
            <Stack.Screen
              name="ssh"
              options={{
                animation: 'fade',
                animationDuration: reduceMotion ? 0 : NAVIGATION_MOTION.pageMs,
              }}
            />
            <Stack.Screen
              name="ssh/[hostId]"
              options={{
                gestureEnabled: false,
                animation: 'fade',
                animationDuration: reduceMotion ? 0 : NAVIGATION_MOTION.pageMs,
              }}
            />
            <Stack.Screen
              name="commands"
              options={sheetPresentationOptions(sheetRoutePresentations['commands'], 'expandable')}
            />
            <Stack.Screen
              name="panels"
              options={sheetPresentationOptions(sheetRoutePresentations['panels'], 'expandable')}
            />
            {/* Machine/session results can grow asynchronously. Give the scroll
                root a bounded viewport instead of circular fit-to-content sizing. */}
            <Stack.Screen
              name="sessions"
              options={sheetPresentationOptions('sheet', [0.65, 0.9])}
            />
            <Stack.Screen
              name="artifacts"
              options={sheetPresentationOptions(sheetRoutePresentations['artifacts'], 'expandable')}
            />
            <Stack.Screen
              name="git-diff"
              options={sheetPresentationOptions(sheetRoutePresentations['git-diff'], 'expandable')}
            />
            {/* Both are lists the reader scrolls -- thirty-two packs, or a
                catalogue -- so both take the expandable window every other list
                sheet has rather than the whole screen. */}
            <Stack.Screen
              name="settings-theme"
              options={sheetPresentationOptions(
                sheetRoutePresentations['settings-theme'],
                'expandable'
              )}
            />
            <Stack.Screen
              name="settings-theme-browse"
              options={sheetPresentationOptions(
                sheetRoutePresentations['settings-theme-browse'],
                'expandable'
              )}
            />
            {/*
              The one route that is a whole screen wearing a theme rather than a
              panel over one. See `sheetRoutePresentations` for why it stays
              full-screen; the way out is the header's back arrow and the
              pinned Done, not a grabber.
            */}
            <Stack.Screen
              name="custom-theme"
              options={{
                ...sheetPresentationOptions(sheetRoutePresentations['custom-theme']),
                animationDuration: reduceMotion ? 0 : NAVIGATION_MOTION.modalMs,
              }}
            />
            <Stack.Screen
              name="settings-language"
              options={sheetPresentationOptions(
                sheetRoutePresentations['settings-language'],
                'fitToContents'
              )}
            />
            {/* Full height leaves room for the composer and keyboard. */}
            <Stack.Screen
              name="new-task"
              options={sheetPresentationOptions(sheetRoutePresentations['new-task'], 'expandable')}
            />
            {/*
              Open a web service (card #829). Content-sized, and
              for less reason than any of them: this is one field with a row of
              shortcuts over it. A full-height sheet for a port number would be
              the app implying the task is bigger than typing four digits.
            */}
            <Stack.Screen
              name="web-service"
              options={sheetPresentationOptions(
                sheetRoutePresentations['web-service'],
                'fitToContents'
              )}
            />
            {/*
              A full-screen modal, not a sheet, and the route file says why at
              length: a sheet's one-finger dismiss fought the device's
              one-finger drags, and its transparent content let the terminal
              show through on Android. `fullScreenModal` is edge to edge with
              no grabber on both platforms and cannot be swiped away on iOS;
              the ground is the theme background from the options above. On
              Android the hardware back is the way off and the route handles
              it; `gestureEnabled: false` is for iOS, where the close button is
              the only way and a swipe is the device's.
            */}
            <Stack.Screen
              name="simfarm"
              options={{
                ...sheetPresentationOptions(sheetRoutePresentations['simfarm']),
                animationDuration: reduceMotion ? 0 : NAVIGATION_MOTION.modalMs,
              }}
            />
            {/* Pairing: a viewfinder, two fields and a way in, on the sheet
                every other form in this app is on. */}
            <Stack.Screen
              name="explore"
              options={sheetPresentationOptions(sheetRoutePresentations['explore'], 'expandable')}
            />
            {/*
              The agent surface's pickers. They were `<Modal transparent>`
              components mounted inside the workbench, each with its own
              backdrop, its own hand-drawn grabber and its own corner radius;
              as routes they get the one sheet ground, the hardware back
              button, a real dismissal gesture and `freezeOnBlur` for free.
              Detents follow the content: a list gets a bounded, expandable
              viewport, and the one sheet with no scroller of its own is sized
              to what it holds.
            */}
            <Stack.Screen
              name="agent-sessions"
              options={sheetPresentationOptions(
                sheetRoutePresentations['agent-sessions'],
                'expandable'
              )}
            />
            {/* A model list is usually browsed and sometimes filtered to two
                rows. At the expandable detent those two rows sat at the top of
                a sheet that was 82% of the screen, and the rest was ground. It
                opens at just over half and drags to full, which is the same
                two shapes with far less void under a short list. */}
            <Stack.Screen
              name="agent-model"
              options={sheetPresentationOptions(sheetRoutePresentations['agent-model'], [0.6, 1])}
            />
            <Stack.Screen
              name="agent-mode"
              options={sheetPresentationOptions(
                sheetRoutePresentations['agent-mode'],
                'expandable'
              )}
            />
            <Stack.Screen
              name="agent-workspace"
              options={sheetPresentationOptions(
                sheetRoutePresentations['agent-workspace'],
                'expandable'
              )}
            />
            {/* The project's checkouts: a short list, a create form under
                it, and a keyboard over both while the name is being typed.
                Expandable, so the fields have somewhere to come up to. */}
            <Stack.Screen
              name="agent-worktree"
              options={sheetPresentationOptions(
                sheetRoutePresentations['agent-worktree'],
                'expandable'
              )}
            />
            <Stack.Screen
              name="agent-context"
              options={sheetPresentationOptions(
                sheetRoutePresentations['agent-context'],
                'expandable'
              )}
            />
            <Stack.Screen
              name="agent-vcs-diff"
              options={sheetPresentationOptions(
                sheetRoutePresentations['agent-vcs-diff'],
                'expandable'
              )}
            />
            {/* A short list, and its own scroll root, so it takes a bounded
                viewport rather than circular fit-to-content sizing. */}
            <Stack.Screen
              name="agent-tasks"
              options={sheetPresentationOptions(
                sheetRoutePresentations['agent-tasks'],
                [0.65, 0.9]
              )}
            />
            {/* What is still running after the agent moved on: a short list
                with one expandable output box, so it takes a bounded viewport
                rather than fit-to-content sizing. */}
            <Stack.Screen
              name="agent-shells"
              options={sheetPresentationOptions(
                sheetRoutePresentations['agent-shells'],
                [0.65, 0.9]
              )}
            />
            {/* One banner, one command and one button: content-sized, for the
                reason `web-service` is. */}
            <Stack.Screen
              name="opencode-guide"
              options={sheetPresentationOptions(
                sheetRoutePresentations['opencode-guide'],
                'fitToContents'
              )}
            />
          </Stack>
          <InAppNotificationHost />
        </AppLockGate>
        <SshConnectPromptGate />
        <UpdateStatusBanner />
        <WhatsNewCard />
      </ToastProvider>
    </ThemeProvider>
  );
}
