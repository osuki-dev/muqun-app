import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { PanelsTopLeft } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  NavHeaderBackButton,
  NavHeaderCircle,
  NavHeaderSpacer,
  NavHeaderTitlePill,
  navHeaderBarStyle,
  navHeaderButtonStyle,
  navHeaderRowStyle,
  navHeaderTitlePillStyle,
  navHeaderTitleTextStyle,
} from '@/components/nav-header';
import { PressableScale } from '@/components/pressable-scale';
import { EdgeFade } from '@/components/edge-fade';
import { appChrome } from '@/constants/appearance';
import { isDrawerPermanent } from '@/constants/navigation';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { fadeIn, fadeInLeft, fadeOut, fadeOutLeft, listLayout } from '@/lib/motion';
import { responsiveWorkspaceLayout } from '@/lib/responsive-layout';

type AppDrawerProps = {
  children: ReactNode;
  /**
   * The server/agent navigator that replaces the phone's Back control when
   * the available window is wide enough for a real master-detail workspace.
   * The caller owns its data; this frame owns only where it is placed.
   */
  padRail?: ReactNode;
  /**
   * Whether the rail should stand down and give its column to the workspace.
   *
   * Set while the simulator preview is up: two columns the reader is looking at
   * beat three where one is a list of names they are not. It is never a way to
   * make the rail unreachable -- collapsed, it comes back as an overlay from
   * the edge handle, and returns to its column on its own when the caller stops
   * asking for this.
   */
  padRailCollapsed?: boolean;
  detailTitle?: string;
  onDetailAction?: () => void;
  /**
   * Replaces what the back button does, for a screen that has something to
   * close down before it leaves. It still has to leave -- this is a hook, not
   * a veto -- and a screen with nothing to do omits it and gets the ordinary
   * pop.
   */
  onDetailBack?: () => void;
  detailFadeColor?: string;
  /**
   * Extra controls beside the panels button, each in its own glass circle so
   * they read as part of the header rather than as something floating over the
   * pane. The screen owns what goes in them.
   *
   * A list rather than a single node because two of them can be earned at once
   * -- the way out of the simulator split, and the gateway's session switcher
   * -- and putting both inside one circle would draw them as one control.
   * Entries that are `null` are not slots held open: a header only spends width
   * on a circle it has something to put in.
   */
  detailAccessory?: ReactNode | ReactNode[];
  /**
   * Replaces the title pill outright, for a screen that needs the title to do
   * something -- carry a gesture, or show something beside itself that the
   * pill's own clipping would cut off. Whatever goes here is expected to use
   * `detailTitlePillStyle` so the header still reads as one row.
   */
  detailTitleSlot?: ReactNode;
};

export default function AppDrawer({
  children,
  padRail,
  padRailCollapsed = false,
  detailTitle,
  onDetailAction,
  onDetailBack,
  detailFadeColor,
  detailAccessory,
  detailTitleSlot,
}: AppDrawerProps) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();

  const detailAccessories = (
    Array.isArray(detailAccessory) ? detailAccessory : [detailAccessory]
  ).filter(Boolean);

  const router = useRouter();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { record } = useGatewayRecord();
  const workspaceLayout = responsiveWorkspaceLayout(width);
  const hasPadRail = padRail !== undefined && workspaceLayout.mode === 'pad';
  // Peeking is per-visit, not remembered: the reader opened it to reach one
  // server, and a rail that stayed out would have taken back the width the
  // preview was opened for.
  const [railPeeked, setRailPeeked] = useState(false);
  const showsPadRail = hasPadRail && !padRailCollapsed;
  const peeksPadRail = hasPadRail && padRailCollapsed && railPeeked;
  // A rail that is not in the layout must not keep a stale peek alive: closing
  // the preview puts it back in its own column, and it would otherwise return
  // as an overlay over itself the next time the preview opened.
  useEffect(() => {
    if (!padRailCollapsed) setRailPeeked(false);
  }, [padRailCollapsed]);
  // The back control is hidden only when a permanent drawer is already showing
  // the way out. With the drawer off (card #664) that is never, so a wide
  // screen keeps its back button rather than losing it to a panel that is not
  // there.
  const permanent = isDrawerPermanent(width);
  const serverDetail = detailTitle !== undefined;

  return (
    <View style={[styles.shell, { backgroundColor: theme.colors.background }]}>
      {/*
        Entering and exiting rather than a width animated to nothing: the rail
        carries a shadow, and clipping a column down to zero would have meant
        `overflow: hidden` on the layer drawing it, which on iOS removes the
        shadow outright. Sliding the whole column out and letting the workspace
        beside it take the space with a layout transition costs no clipping and
        is the motion this repo already uses for a panel that leaves sideways.
      */}
      {showsPadRail ? (
        <Animated.View
          testID="pad-server-rail-container"
          entering={fadeInLeft()}
          exiting={fadeOutLeft()}
          style={[
            styles.padRail,
            {
              width: workspaceLayout.railWidth,
              backgroundColor: theme.colors.surface,
              // The rail is an opaque surface, so its own top edge -- not only
              // its first child -- has to clear the status bar. PadServerRail
              // consequently applies only the bottom safe-area inset.
              marginTop: insets.top + appChrome.layout.padWorkspaceGutter,
            },
          ]}>
          {padRail}
        </Animated.View>
      ) : null}
      {peeksPadRail ? (
        <>
          {/* Under the rail and over everything else, so anywhere the reader
              was aiming that is not the rail puts the width back. */}
          <Animated.View
            entering={fadeIn()}
            exiting={fadeOut()}
            style={styles.railScrim}
            pointerEvents="auto">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t`Hide the server list`}
              onPress={() => setRailPeeked(false)}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            testID="pad-server-rail-peek"
            entering={fadeInLeft()}
            exiting={fadeOutLeft()}
            style={[
              styles.padRail,
              styles.padRailPeek,
              {
                width: workspaceLayout.railWidth,
                backgroundColor: theme.colors.surface,
                marginTop: insets.top + appChrome.layout.padWorkspaceGutter,
              },
            ]}>
            {padRail}
          </Animated.View>
        </>
      ) : null}
      {/* The layout transition is what makes the rail leaving read as the
          workspace widening, rather than as a column blinking out and the rest
          jumping sideways to fill the hole. */}
      <Animated.View style={styles.main} layout={listLayout()}>
        {children}

        {/*
          The way back to a rail that stood down for the preview. A handle
          rather than an edge swipe alone: the terminal beside it pans
          horizontally, and an invisible gesture on its edge would be competing
          with the thing the reader is actually driving.
        */}
        {hasPadRail && padRailCollapsed && !railPeeked ? (
          <Animated.View
            entering={fadeIn()}
            exiting={fadeOut()}
            pointerEvents="box-none"
            style={styles.railHandleSlot}>
            <SafeAreaView edges={['top']} pointerEvents="box-none">
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Show the server list`}
                onPress={() => setRailPeeked(true)}
                style={[
                  styles.railHandle,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}>
                <PanelsTopLeft size={18} color={theme.colors.textMuted} />
              </PressableScale>
            </SafeAreaView>
          </Animated.View>
        ) : null}

        {serverDetail ? (
          <SafeAreaView
            edges={['top']}
            pointerEvents="box-none"
            style={[styles.detailHeaderOverlay, navHeaderBarStyle]}>
            <EdgeFade
              edge="top"
              color={detailFadeColor ?? theme.colors.background}
              style={styles.detailHeaderFade}
            />
            {/*
              Separate pills rather than one bar: the title is the only part
              that needs the full width, and a single bar makes the buttons read
              as part of the label rather than as controls.
            */}
            <View style={navHeaderRowStyle}>
              {!permanent && !showsPadRail ? (
                <NavHeaderBackButton
                  accessibilityLabel={t`Back to servers`}
                  onPress={
                    onDetailBack ??
                    (() => (router.canGoBack() ? router.back() : router.replace('/')))
                  }
                />
              ) : !showsPadRail ? (
                <NavHeaderSpacer />
              ) : null}
              {detailTitleSlot ?? (
                <NavHeaderTitlePill
                  title={detailTitle ?? record?.label ?? t`Server`}
                  style={styles.detailHeaderTitleMeasure}
                />
              )}
              {detailAccessories.map((accessory, index) => (
                // Positional, because that is what the circle is: a slot in a
                // fixed order, not one of a collection of identified things.
                <NavHeaderCircle key={index}>{accessory}</NavHeaderCircle>
              ))}
              {onDetailAction ? (
                <NavHeaderCircle>
                  <PressableScale
                    accessibilityLabel={t`Show what is running`}
                    onPress={onDetailAction}
                    style={navHeaderButtonStyle}>
                    <PanelsTopLeft size={18} color={theme.colors.text} strokeWidth={2} />
                  </PressableScale>
                </NavHeaderCircle>
              ) : (
                <NavHeaderSpacer />
              )}
            </View>
          </SafeAreaView>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: 'row',
  },
  padRail: {
    zIndex: 30,
    flexShrink: 0,
    marginBottom: appChrome.layout.padWorkspaceGutter,
    marginLeft: appChrome.layout.padWorkspaceGutter,
    marginRight: appChrome.layout.padWorkspaceGutter,
    borderRadius: appChrome.radius.workspaceRail,
    borderCurve: 'continuous',
    boxShadow: appChrome.shadow.workspaceRail,
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  /**
   * The peeked rail floats over the workspace instead of taking a column back.
   * Reclaiming the column would undo the width the preview was opened for, for
   * as long as the reader was looking at a list of names.
   */
  padRailPeek: {
    position: 'absolute',
    zIndex: 40,
    top: 0,
    bottom: 0,
    left: 0,
  },
  railScrim: {
    position: 'absolute',
    zIndex: 35,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(3, 8, 14, 0.5)',
  },
  railHandleSlot: {
    position: 'absolute',
    zIndex: 20,
    top: 0,
    left: 0,
  },
  railHandle: {
    marginTop: appChrome.layout.padWorkspaceGutter,
    marginLeft: appChrome.layout.padWorkspaceGutter,
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    borderCurve: 'continuous',
    boxShadow: appChrome.shadow.workspaceRail,
  },
  detailHeaderOverlay: {
    position: 'absolute',
    zIndex: 20,
    elevation: 20,
    top: 0,
    left: 0,
    right: 0,
  },
  detailHeaderFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: -30,
  },
  /**
   * How wide the pane's name may grow, which is this screen's question and not
   * the nav bar's. The terminal runs the full width of a landscape tablet and a
   * title set across all of it stops being a label; Settings has the opposite
   * need -- its bar is already inside a 760pt reading column that the sections
   * below share a left edge with, so a cap there would pull the back button off
   * that edge. On a phone the two circles take the row below this either way.
   */
  detailHeaderTitleMeasure: {
    maxWidth: 360,
  },
});

/**
 * The title pill's shape and its text, shared with whatever a screen puts in
 * `detailTitleSlot`, so a replacement cannot drift from the header it sits in.
 */
export const detailTitlePillStyle = [navHeaderTitlePillStyle, styles.detailHeaderTitleMeasure];
export const detailTitleTextStyle = navHeaderTitleTextStyle;
