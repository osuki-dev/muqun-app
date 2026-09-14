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
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: screenBackground },
              // A screen nobody is looking at should not be rendering. Home
              // sits under the terminal for as long as the terminal is open,
              // and without this its artwork layers and its one pulse per live
              // server card keep the UI thread at vsync the whole time. Work
              // that must outlive a blur already lives in a store rather than
              // in a screen, so nothing here depends on rendering while hidden.
              freezeOnBlur: true,
            }}>
            <Stack.Screen name="(drawer)" />
            {/* Settings rises from the bottom like the terminal, over the home
                screen rather than inside the drawer navigator: the drawer is
                switched off, so a screen that lived in it arrived with a
                sideways swap and no material of its own. */}
            <Stack.Screen name="settings" options={{ animation: 'slide_from_bottom' }} />
            {/*
              The terminal lives on the root stack rather than in the drawer:
              drawer screens swap without a transition, and its edge-swipe
              gesture fights the terminal's own horizontal panning.
            */}
            <Stack.Screen name="servers/[serverId]" options={{ animation: 'slide_from_bottom' }} />
            {/*
              SSH: the host list and one host's shell, both on the root stack
              and both rising from the bottom for the same reasons as the
              terminal above -- the shell screen reuses its canvas and its
              horizontal panning, and the list is the door to it.
            */}
            <Stack.Screen name="ssh" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="ssh/[hostId]" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen
              name="commands"
              options={{
                presentation: 'formSheet',
                // Quick actions carries the sheet's own verbs, the saved
                // shortcuts and the agent's own commands -- against a real
                // gateway the last of those alone is twenty-odd rows, which is
                // more than a partial detent can show without constant
                // scrolling.
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/*
              0.82 rather than 0.65 (card #693).

              A fraction here is a fraction of the sheet's own maximum height,
              not of the screen: measured on an iPhone 17 Pro, 0.65 put the
              sheet's top edge at 354pt and made it 520pt tall, which puts that
              maximum at about 800pt of the 874pt screen.

              520pt could not hold what the sheet is for. Five panels under
              three tabs -- what the demo carries, and about what a working
              session looks like -- is nearly 380pt of groups on its own, and
              the header, the workspace rail and `New panel` want another 270pt
              around them. So the sheet opened already scrolled past its own
              last group, and how many tabs a session had was something you had
              to scroll to find out.

              0.82 measures 645pt: the whole five-panel workspace and the button
              under it in one look, 80pt still to spare below it, and the
              terminal still visible above. Still one partial stop and one full
              one, so the gesture is unchanged.
            */}
            <Stack.Screen
              name="panels"
              options={{
                presentation: 'formSheet',
                // Full height, like quick actions and files: three sheets that
                // open from the same row should not each pick their own size,
                // and a workspace with more panels than a partial detent shows
                // is the ordinary case rather than the exception (Ellen).
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/*
              The session switcher. Content-sized like the language
              picker, and for the same reason: it is a short closed list, one
              row per backend the gateway runs, and a full-height sheet for two
              rows would be the app implying the question is bigger than it is.
              It is also only ever reachable from a gateway that has more than
              one session to offer.
            */}
            <Stack.Screen
              name="sessions"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen
              name="artifacts"
              options={{
                presentation: 'formSheet',
                // Full height only, unlike panels: this one carries a search
                // field, and a partial detent puts the keyboard over the results
                // it is filtering.
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen
              name="git-diff"
              options={{
                presentation: 'formSheet',
                // Full height only, and for the plainest reason of the three:
                // a diff is read a line at a time, and a partial detent would
                // halve the number of lines on screen at once.
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/*
              The two Appearance pickers (card #683) started as content-sized
              closed lists. Language still fits that model; themes no longer
              do now that thirty-two paired packs are available. The theme picker
              gets the full-height detent and scrolls, while language remains
              exactly as tall as its nine choices.
            */}
            <Stack.Screen
              name="settings-theme"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/*
              The catalogue, opened from the theme sheet and presented over it.
              The same options, because it is the same place as far as a reader
              is concerned; full height for the reason `artifacts` and
              `git-diff` are, which is that a list read by scrolling is halved
              by a partial detent.
            */}
            <Stack.Screen
              name="settings-theme-browse"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen name="custom-theme" options={{ presentation: 'fullScreenModal' }} />
            <Stack.Screen
              name="settings-language"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/*
              New Task (card #690). Content-sized for the same reason as the
              two above: three closed questions -- an agent, a directory, a
              prompt -- that have to be answerable in one look. A full-height
              sheet would put the Go button an inch above the home indicator
              with nothing between it and the prompt, which reads as a form that
              is still loading. The keyboard is handled inside, so the detent
              does not have to leave room for it.
            */}
            <Stack.Screen
              name="new-task"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            {/*
              Open a web service (card #829). Content-sized like New Task, and
              for less reason than any of them: this is one field with a row of
              shortcuts over it. A full-height sheet for a port number would be
              the app implying the task is bigger than typing four digits.
            */}
            <Stack.Screen
              name="web-service"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
              }}
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
                presentation: 'fullScreenModal',
                animation: 'slide_from_bottom',
                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="explore"
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
                gestureEnabled: true,
              }}
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
