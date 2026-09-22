import { RouteScene } from '@/components/route-scene';
import {
  sheetPresentationOptions,
  sheetRouteOptions as resolveSheetRouteOptions,
  sheetRoutePresentations,
} from '@/lib/route-presentation';
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
import { AppState, LogBox, Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useReducedMotion } from 'react-native-reanimated';

import { SplashScreen } from '@osuki-dev/react-native-splash';

import { LaunchOverlay } from '@/components/launch-overlay';
import { ReskinSurface, ReskinTransitionProvider } from '@/components/reskin-transition';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import {
  AppearanceProfileProvider,
  useAppearanceProfile,
} from '@/components/appearance-profile-provider';
import { profileNavigationOptions } from '@/lib/appearance-profile';
import { AppLockGate } from '@/components/app-lock-gate';
import { HugSlackProvider } from '@/components/text';
import { SshConnectPromptGate } from '@/components/ssh-connect-prompt-gate';
import { UpdateStatusBanner } from '@/components/update-status-banner';
import { InAppNotificationHost } from '@/components/in-app-notification-host';
import { useNotificationSurfaceStyle } from '@/components/notification-surface';
import { WhatsNewCard } from '@/components/whats-new-card';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useLaunchImageSync } from '@/hooks/use-launch-image-sync';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useThemePack, useThemePalette } from '@/hooks/use-theme-pack';
import { useUserFontsReady } from '@/hooks/use-user-fonts';
import { useThemeLibrary } from '@/stores/theme-library';
import { AppI18nProvider } from '@/i18n/provider';
import { useGatewayPushRegistration, useNotificationObserver } from '@/lib/notifications';
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
  /**
   * The settings are read and the reader's fonts are registered before this
   * returns true, and the router below does not mount until it does.
   *
   * Holding the tree rather than letting it paint and swapping the font in is
   * the whole point, and on Android it is not a preference. A markdown view
   * that asks `ReactFontManager` for `MuqunUserMono` before `Font.loadAsync`
   * has run gets the system font, and `enriched-markdown` memoises that answer
   * in a process-global cache with no invalidation -- so every code block in
   * the app stays in the wrong face until the process is killed. See
   * `use-user-fonts.ts`, which also caps the wait: a font that will not
   * register opens the app on the system font rather than on a splash screen
   * nobody can get past.
   *
   * Nothing is lost by waiting. `LaunchOverlay` is what the reader is looking
   * at either way, and it holds for longer than the registration takes.
   */
  const fontsReady = useUserFontsReady();

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
            Outside the error boundary because the boundary's own fallback is
            reader-facing copy like any other, and it is drawn in the reader's
            face: the slack an oblique needs on its trailing edge is not a
            thing to lose on the one screen that appears when something has
            already gone wrong. It publishes a context and nothing else, so
            there is no state here that could be the fault.
          */}
          <AppearanceProfileProvider>
            <HugSlackProvider>
              {/*
              Wraps everything except the theme provider the fallback's <Text>
              needs, so a render throw in the toast host, lock gate, nav theme,
              or update banner is caught too -- not just faults inside the
              router.
            */}
              <AppErrorBoundary>
                {/*
              Inside the error boundary so a fault in locale resolution shows
              the fallback screen rather than a blank app, and outside
              everything else so the boundary's own copy is the only string in
              the tree that cannot be translated.
            */}
                <AppI18nProvider>
                  {/*
                `null` until the fonts are registered, which keeps the native
                launch screen up: `SplashScreen.preventAutoHide()` at module
                scope holds it until `LaunchOverlay` paints, and the overlay is
                inside `RootContent`. So the app's first painted frame is
                already wearing the reader's typography -- there is no frame in
                the system font for anything to cache.
              */}
                  {fontsReady ? <RootContent /> : null}
                </AppI18nProvider>
              </AppErrorBoundary>
            </HugSlackProvider>
          </AppearanceProfileProvider>
        </OsukiThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function RootContent() {
  const reduceMotion = useReducedMotion();
  const profile = useAppearanceProfile();
  const notificationSurfaceStyle = useNotificationSurfaceStyle();
  const pageOptions = profileNavigationOptions(profile, reduceMotion);
  const modalOptions = profileNavigationOptions(profile, reduceMotion, true);
  const sheetRouteOptions = (route: string) =>
    resolveSheetRouteOptions(route, profile, reduceMotion);
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
        defaultDurationMs={2000}
        toastStyle={[
          notificationSurfaceStyle,
          {
            backgroundColor: surfaceBackground(colors.surface),
            borderWidth: StyleSheet.hairlineWidth,
          },
        ]}>
        {/*
          The re-skin transitions live here, inside the toast provider and
          around everything the reader can see, because a theme or a font
          change repaints all of it at once and the photograph that hides the
          repaint has to be a photograph of all of it. The surface is the root
          window's; the font sheet mounts a second one of its own, for the
          reason set out in `reskin-transition.tsx`.
        */}
        <ReskinTransitionProvider>
          <ReskinSurface id="root">
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
                  ...pageOptions,
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
                    ...pageOptions,
                  }}
                />
                {/* Native options change in place; sheets retain their measurement contract. */}
                <Stack.Screen
                  name="agent"
                  options={{
                    ...pageOptions,
                  }}
                />
                <Stack.Screen
                  name="settings"
                  options={{
                    ...pageOptions,
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
                    ...pageOptions,
                  }}
                />
                <Stack.Screen
                  name="ssh"
                  options={{
                    ...pageOptions,
                  }}
                />
                <Stack.Screen
                  name="ssh/[hostId]"
                  options={{
                    gestureEnabled: false,
                    ...pageOptions,
                  }}
                />
                <Stack.Screen name="commands" options={sheetRouteOptions('commands')} />
                <Stack.Screen name="panels" options={sheetRouteOptions('panels')} />
                <Stack.Screen name="sessions" options={sheetRouteOptions('sessions')} />
                <Stack.Screen name="artifacts" options={sheetRouteOptions('artifacts')} />
                <Stack.Screen name="git-diff" options={sheetRouteOptions('git-diff')} />
                <Stack.Screen name="settings-theme" options={sheetRouteOptions('settings-theme')} />
                <Stack.Screen
                  name="settings-theme-browse"
                  options={sheetRouteOptions('settings-theme-browse')}
                />
                <Stack.Screen name="settings-font" options={sheetRouteOptions('settings-font')} />
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
                    ...modalOptions,
                  }}
                />
                <Stack.Screen
                  name="settings-language"
                  options={sheetRouteOptions('settings-language')}
                />
                <Stack.Screen
                  name="settings-home-layout"
                  options={sheetRouteOptions('settings-home-layout')}
                />
                <Stack.Screen name="new-task" options={sheetRouteOptions('new-task')} />
                <Stack.Screen name="home-target" options={sheetRouteOptions('home-target')} />
                <Stack.Screen name="web-service" options={sheetRouteOptions('web-service')} />
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
                    ...modalOptions,
                  }}
                />
                <Stack.Screen name="explore" options={sheetRouteOptions('explore')} />
                {/*
              The agent surface's pickers. They were `<Modal transparent>`
              components mounted inside the workbench, each with its own
              backdrop, its own hand-drawn grabber and its own corner radius;
              as routes they get the one sheet ground, the hardware back
              button, a real dismissal gesture and `freezeOnBlur` for free.
              How tall each one opens, and why, is in `sheetRouteDetents`.
            */}
                <Stack.Screen name="agent-sessions" options={sheetRouteOptions('agent-sessions')} />
                <Stack.Screen
                  name="agent-session-tree"
                  options={sheetRouteOptions('agent-session-tree')}
                />
                <Stack.Screen
                  name="agent-subagent-detail"
                  dangerouslySingular
                  options={sheetRouteOptions('agent-subagent-detail')}
                />
                <Stack.Screen name="agent-model" options={sheetRouteOptions('agent-model')} />
                <Stack.Screen name="agent-mode" options={sheetRouteOptions('agent-mode')} />
                <Stack.Screen
                  name="agent-workspace"
                  options={sheetRouteOptions('agent-workspace')}
                />
                <Stack.Screen name="agent-worktree" options={sheetRouteOptions('agent-worktree')} />
                <Stack.Screen name="agent-context" options={sheetRouteOptions('agent-context')} />
                <Stack.Screen name="agent-vcs-diff" options={sheetRouteOptions('agent-vcs-diff')} />
                <Stack.Screen name="agent-tasks" options={sheetRouteOptions('agent-tasks')} />
                <Stack.Screen name="agent-shells" options={sheetRouteOptions('agent-shells')} />
                <Stack.Screen name="opencode-guide" options={sheetRouteOptions('opencode-guide')} />
              </Stack>
              <InAppNotificationHost />
            </AppLockGate>
            <SshConnectPromptGate />
            <UpdateStatusBanner />
            <WhatsNewCard />
          </ReskinSurface>
        </ReskinTransitionProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
