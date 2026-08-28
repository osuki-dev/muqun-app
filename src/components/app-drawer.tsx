import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { PanelsTopLeft } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
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
import { responsiveWorkspaceLayout } from '@/lib/responsive-layout';

type AppDrawerProps = {
  children: ReactNode;
  /**
   * The server/agent navigator that replaces the phone's Back control when
   * the available window is wide enough for a real master-detail workspace.
   * The caller owns its data; this frame owns only where it is placed.
   */
  padRail?: ReactNode;
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
   * An extra control beside the panels button, in the same glass circle so it
   * reads as part of the header rather than as something floating over the
   * pane. The screen owns what goes in it.
   */
  detailAccessory?: ReactNode;
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

  const router = useRouter();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { record } = useGatewayRecord();
  const workspaceLayout = responsiveWorkspaceLayout(width);
  const showsPadRail = padRail !== undefined && workspaceLayout.mode === 'pad';
  // The back control is hidden only when a permanent drawer is already showing
  // the way out. With the drawer off (card #664) that is never, so a wide
  // screen keeps its back button rather than losing it to a panel that is not
  // there.
  const permanent = isDrawerPermanent(width);
  const serverDetail = detailTitle !== undefined;

  return (
    <View style={[styles.shell, { backgroundColor: theme.colors.background }]}>
      {showsPadRail ? (
        <View
          testID="pad-server-rail-container"
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
        </View>
      ) : null}
      <View style={styles.main}>
        {children}

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
              {detailAccessory ? <NavHeaderCircle>{detailAccessory}</NavHeaderCircle> : null}
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
      </View>
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
