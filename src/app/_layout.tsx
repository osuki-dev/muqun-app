import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
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
import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { AppLockGate } from '@/components/app-lock-gate';
import { UpdateStatusBanner } from '@/components/update-status-banner';
import { WhatsNewCard } from '@/components/whats-new-card';
import { buildTheme } from '@/constants/theme';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useThemePack } from '@/hooks/use-theme-pack';
import { AppI18nProvider } from '@/i18n/provider';
import { useGatewayPushRegistration, useNotificationObserver } from '@/lib/notifications';
import { useAppSettings } from '@/stores/app-settings';

SplashScreen.preventAutoHideAsync();

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

  // The product's wide workspace is a landscape-only tablet surface. Expo's
  // static `orientation` setting is app-wide, so using it would rotate phones
  // too; choose the native lock from the actual device class instead. iPad's
  // supported orientations are also declared in app.json so the launch frame
  // starts in the right shape before JavaScript is ready.
  useEffect(() => {
    let mounted = true;
    void Device.getDeviceTypeAsync()
      .then((deviceType) => {
        if (!mounted) return;
        const lock = deviceType === Device.DeviceType.TABLET
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
  // palette. Until settings hydrate this is the default, so the first frame is
  // Osuki and the chosen theme lands a tick later -- behind the splash overlay,
  // which is why the splash colours stay pinned to the default pack.
  const pack = useThemePack();
  const theme = useMemo(() => buildTheme(pack), [pack]);

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
  const { record } = useGatewayRecord();
  useNotificationObserver();
  useGatewayPushRegistration(record);

  // Paints every screen and the transition container with the theme background
  // up front, so switching mode -- or sliding into a server -- never flashes the
  // default white through for a frame. Read from the tokens rather than restated
  // as a literal: a second copy is a second thing to forget when the spec moves.
  const screenBackground = colors.background;

  return (
    <ThemeProvider value={resolvedMode === 'dark' ? DarkTheme : DefaultTheme}>
      <ToastProvider maxWidth={480}>
        <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />
        <AnimatedSplashOverlay />
        <AppLockGate>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: screenBackground },
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
            <Stack.Screen
              name="servers/[serverId]"
              options={{ animation: 'slide_from_bottom' }}
            />
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
              Full height, and for a plainer reason than the artifacts sheet's:
              what is inside is a simulator drawn at 1:1. A partial detent would
              crop the device it exists to show, and a phone is already the
              smaller screen of the two.
            */}
            <Stack.Screen
              name="simfarm"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: 'transparent' },
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
        </AppLockGate>
        <UpdateStatusBanner />
        <WhatsNewCard />
      </ToastProvider>
    </ThemeProvider>
  );
}
