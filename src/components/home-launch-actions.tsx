import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ArrowUpRight, ChevronDown, Link, Play, SquareTerminal } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';
import Animated, {
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { OpenCodeIcon } from '@/components/opencode-icon';
import { ScrollEdgeGlass } from '@/components/scroll-edge-glass';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { PRESS, timing } from '@/lib/motion';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { reachabilityDescription } from '@/i18n/labels';
import type { ServerReachability } from '@/lib/server-reachability';
import { useHomeTargetPicker } from '@/stores/home-target-picker';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';

/** Target choice is local to Home; a selection alone never switches a live connection. */
export function useHomeLaunchController({
  servers,
  selectedServerId,
  reachabilityByServer,
  onPair,
}: {
  servers: readonly GatewayRecord[];
  selectedServerId?: string;
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  onPair: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [pickerRequestId, setPickerRequestId] = useState<number | null>(null);
  // This is visual feedback only; the shared command controller owns the
  // operation guard across layouts, buttons, and unmounts.
  const [opening, setOpening] = useState(false);
  const reduceMotion = useReducedMotion();
  const pickerOpen = useSharedValue(0);
  const pickerOpenRequestId = useHomeTargetPicker((state) => state.openRequestId);
  const pickerCompletedRequestId = useHomeTargetPicker((state) => state.completedRequestId);
  const pickerCompletedServerId = useHomeTargetPicker((state) => state.completedServerId);
  const beginPicker = useHomeTargetPicker((state) => state.begin);
  const updatePickerReachability = useHomeTargetPicker((state) => state.updateReachability);
  const returnedServerId =
    pickerRequestId !== null && pickerCompletedRequestId === pickerRequestId
      ? pickerCompletedServerId
      : null;
  const chosen =
    servers.find((server) => server.serverId === (returnedServerId ?? chosenId)) ??
    servers.find((server) => server.serverId === selectedServerId) ??
    (servers.length === 1 ? servers[0] : undefined);
  const chosenReachability = chosen
    ? (reachabilityByServer[chosen.serverId] ?? 'unknown')
    : undefined;
  const chosenOffline = chosenReachability === 'offline';

  useEffect(() => {
    if (pickerRequestId === null || pickerCompletedRequestId !== pickerRequestId) return;
    if (pickerCompletedServerId) setChosenId(pickerCompletedServerId);
    setPickerRequestId(null);
  }, [pickerCompletedRequestId, pickerCompletedServerId, pickerRequestId]);
  useEffect(() => {
    if (pickerRequestId !== null && pickerRequestId === pickerOpenRequestId) {
      updatePickerReachability(pickerRequestId, reachabilityByServer);
    }
  }, [pickerOpenRequestId, pickerRequestId, reachabilityByServer, updatePickerReachability]);
  useEffect(() => {
    pickerOpen.set(
      withTiming(reduceMotion ? 0 : pickerOpenRequestId === null ? 0 : 1, timing('micro'))
    );
  }, [pickerOpen, pickerOpenRequestId, reduceMotion]);
  const pickerChevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${pickerOpen.get() * 180}deg` }],
  }));
  function openTargetPicker() {
    if (pickerOpenRequestId !== null) return;
    const requestId = beginPicker(chosen?.serverId, reachabilityByServer);
    setPickerRequestId(requestId);
    router.push({ pathname: '/home-target', params: { requestId: String(requestId) } });
  }

  async function launch(action: () => Promise<unknown>) {
    if (opening) return;
    setOpening(true);
    try {
      await action();
    } finally {
      setOpening(false);
    }
  }

  function launchOnChosen(action: (serverId: string) => Promise<unknown>) {
    if (chosen && !chosenOffline) void launch(() => action(chosen.serverId));
    else if (servers.length) openTargetPicker();
    else void launch(onPair);
  }

  return {
    chosen,
    chosenOffline,
    launchOnChosen,
    openTargetPicker,
    opening,
    pickerChevronStyle,
    pickerOpen: pickerOpenRequestId !== null,
    run: launch,
    servers,
  };
}

export type HomeLaunchController = ReturnType<typeof useHomeLaunchController>;

/** The Gateway selector lives in Home's masthead but owns no global connection state. */
export function HomeLaunchTarget({
  controller,
  loading = false,
  bare = false,
  onPair,
}: {
  controller: HomeLaunchController;
  loading?: boolean;
  bare?: boolean;
  onPair: () => Promise<unknown>;
}) {
  const profile = useAppearanceProfile();
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const { chosen, openTargetPicker, opening, pickerChevronStyle, pickerOpen, run, servers } =
    controller;
  const disabled = loading || opening;

  return (
    <PressableScale
      testID={servers.length === 0 ? 'home-pair-server' : 'home-launch-target'}
      accessibilityRole="button"
      accessibilityState={{ expanded: pickerOpen, disabled }}
      disabled={disabled}
      onPress={() => {
        if (servers.length === 0) void run(onPair);
        else openTargetPicker();
      }}
      style={[
        styles.target,
        bare && { minWidth: 0, paddingHorizontal: 4 },
        {
          borderRadius: profile.chrome.control,
          backgroundColor: bare ? 'transparent' : background(theme.colors.surface),
        },
      ]}>
      <Text variant="bodySmall" weight="semibold" style={styles.targetName}>
        {loading
          ? t`Loading servers`
          : chosen
            ? chosen.label
            : servers.length
              ? t`Choose a gateway`
              : t`Pair a gateway`}
      </Text>
      <Animated.View style={pickerChevronStyle}>
        <ChevronDown size={16} color={theme.colors.primary} />
      </Animated.View>
    </PressableScale>
  );
}

export function HomeLaunchActions({
  controller,
  onNewOpenCode,
  onOpenOpenCode,
  onNewTerminal,
  onOpenTerminal,
  onSsh,
  onDemo,
}: {
  controller: HomeLaunchController;
  onNewOpenCode: (serverId: string) => Promise<unknown>;
  onOpenOpenCode: (serverId: string) => Promise<unknown>;
  onNewTerminal: (serverId: string) => Promise<unknown>;
  onOpenTerminal: (serverId: string) => Promise<unknown>;
  onSsh: () => Promise<unknown>;
  onDemo?: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const { chosenOffline, launchOnChosen, opening, run } = controller;
  const [availableWidth, setAvailableWidth] = useState(0);
  const horizontal = availableWidth < 560;
  const blurTarget = useRef<View>(null);
  const railOffset = useSharedValue(0);
  const railExtent = useSharedValue(0);
  const onRailScroll = useAnimatedScrollHandler((event) => {
    railOffset.value = event.contentOffset.x;
    railExtent.value = Math.max(0, event.contentSize.width - event.layoutMeasurement.width);
  });

  return (
    <View
      testID="home-launch-actions"
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
      style={styles.root}>
      {chosenOffline ? (
        <Text
          testID="home-launch-unavailable"
          accessibilityLiveRegion="polite"
          variant="caption"
          color={theme.colors.textMuted}>
          {_(reachabilityDescription.offline)}
        </Text>
      ) : null}
      {onDemo ? (
        <PressableScale
          testID="home-try-demo"
          accessibilityRole="button"
          accessibilityLabel={t`Try the demo`}
          accessibilityState={{ disabled: opening }}
          disabled={opening}
          onPress={onDemo}
          style={styles.demoAction}>
          <Play size={14} color={theme.colors.textMuted} strokeWidth={2.2} />
          <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.demoLabel}>
            {t`Try the demo`}
          </Text>
        </PressableScale>
      ) : null}
      <View>
        <BlurTargetView ref={blurTarget}>
          <Animated.ScrollView
            onScroll={onRailScroll}
            scrollEventThrottle={16}
            onContentSizeChange={(width) => {
              railExtent.value = Math.max(0, width - availableWidth);
            }}
            horizontal={horizontal}
            scrollEnabled={horizontal}
            nestedScrollEnabled
            directionalLockEnabled
            showsHorizontalScrollIndicator={false}
            testID="home-launch-actions-scroll"
            contentContainerStyle={[styles.actions, horizontal && styles.horizontalActions]}>
            <LaunchTile
              horizontal={horizontal}
              testID="home-new-opencode"
              marker="01"
              primary
              title="OpenCode"
              caption={t`New session`}
              icon={<OpenCodeIcon size={24} color={theme.colors.onPrimary} />}
              disabled={opening || chosenOffline}
              onPress={() => launchOnChosen(onNewOpenCode)}
            />
            <View style={[styles.stackedActions, horizontal && styles.horizontalStack]}>
              <LaunchTile
                compact
                testID="home-open-opencode"
                marker="02"
                title={t`Sessions`}
                icon={<OpenCodeIcon size={16} color={theme.colors.primary} />}
                disabled={opening || chosenOffline}
                onPress={() => launchOnChosen(onOpenOpenCode)}
              />
              <LaunchTile
                compact
                testID="home-open-terminal"
                marker="03"
                title={t`Terminal`}
                icon={<SquareTerminal size={16} color={theme.colors.primary} />}
                disabled={opening || chosenOffline}
                onPress={() => launchOnChosen(onOpenTerminal)}
              />
            </View>
            <LaunchTile
              horizontal={horizontal}
              testID="home-new-terminal"
              marker="04"
              title={t`New terminal`}
              icon={<SquareTerminal size={22} color={theme.colors.primary} />}
              disabled={opening || chosenOffline}
              onPress={() => launchOnChosen(onNewTerminal)}
            />
            <LaunchTile
              horizontal={horizontal}
              testID="home-open-ssh"
              marker="05"
              title={t`SSH`}
              caption={t`SSH hosts`}
              icon={<Link size={22} color={theme.colors.primary} />}
              disabled={opening}
              onPress={() => {
                void run(onSsh);
              }}
            />
          </Animated.ScrollView>
        </BlurTargetView>
        {horizontal ? (
          <>
            <ScrollEdgeGlass
              side="left"
              target={blurTarget}
              offset={railOffset}
              extent={railExtent}
            />
            <ScrollEdgeGlass
              side="right"
              target={blurTarget}
              offset={railOffset}
              extent={railExtent}
            />
          </>
        ) : null}
      </View>
      {opening ? <Text variant="caption" color={theme.colors.textMuted}>{t`Opening…`}</Text> : null}
    </View>
  );
}

function LaunchTile({
  title,
  marker,
  caption,
  icon,
  onPress,
  primary = false,
  compact = false,
  horizontal = false,
  disabled,
  testID,
}: {
  title: string;
  marker: string;
  caption?: string;
  icon: ReactNode;
  onPress: () => void;
  primary?: boolean;
  compact?: boolean;
  horizontal?: boolean;
  disabled: boolean;
  testID: string;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const ink = primary ? theme.colors.onPrimary : theme.colors.text;
  const reduceMotion = useReducedMotion();
  const arrowTravel = useSharedValue(0);
  useEffect(() => {
    if (disabled || reduceMotion) arrowTravel.set(0);
  }, [arrowTravel, disabled, reduceMotion]);
  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: arrowTravel.get() }, { translateY: -arrowTravel.get() }],
  }));
  const moveArrow = (pressed: boolean) => {
    arrowTravel.set(
      withTiming(pressed && !reduceMotion ? 2 : 0, timing(pressed ? PRESS.in : PRESS.out))
    );
  };
  if (compact) {
    return (
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={caption ? `${title}, ${caption}` : title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPressIn={() => moveArrow(true)}
        onPressOut={() => moveArrow(false)}
        onPress={onPress}
        style={[
          styles.compactTile,
          { borderRadius: profile.chrome.control },
          {
            backgroundColor: background(theme.colors.surface),
            opacity: disabled ? 0.6 : 1,
          },
        ]}>
        <View style={styles.compactIcon}>{icon}</View>
        <View style={styles.compactCopy}>
          <Text variant="caption" weight="semibold" color={ink} style={styles.tileTitle}>
            {title}
          </Text>
          {caption ? (
            <Text variant="caption" color={theme.colors.textMuted} style={styles.tileCaption}>
              {caption}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" color={theme.colors.textMuted} style={styles.tileMarker}>
          {marker}
        </Text>
        <Animated.View style={arrowStyle}>
          <ArrowUpRight size={15} color={ink} />
        </Animated.View>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={caption ? `${title}, ${caption}` : title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPressIn={() => moveArrow(true)}
      onPressOut={() => moveArrow(false)}
      onPress={onPress}
      style={[
        styles.tile,
        {
          borderRadius: profile.chrome.control,
        },
        primary ? styles.primaryTile : styles.secondaryTile,
        horizontal && {
          flexGrow: 0,
          flexBasis: 'auto',
          width: primary ? 148 : 124,
          minHeight: 92,
          padding: 6,
        },
        {
          backgroundColor: background(primary ? theme.colors.primary : theme.colors.surface),
          opacity: disabled ? 0.6 : 1,
        },
      ]}>
      <View style={styles.tileTopRow}>
        <View style={styles.tileIcon}>{icon}</View>
        <View style={styles.tileMeta}>
          <Text variant="caption" color={ink} style={styles.tileMarker}>
            {marker}
          </Text>
          <Animated.View style={arrowStyle}>
            <ArrowUpRight size={16} color={ink} />
          </Animated.View>
        </View>
      </View>
      <View style={styles.tileCopy}>
        <Text
          variant={primary ? 'heading' : 'bodySmall'}
          weight="semibold"
          color={ink}
          style={[styles.tileTitle, primary ? styles.primaryTileTitle : styles.secondaryTileTitle]}>
          {title}
        </Text>
        {caption ? (
          <Text
            variant="caption"
            color={primary ? ink : theme.colors.textMuted}
            style={styles.tileCaption}>
            {caption}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, minWidth: 0 },
  target: {
    minWidth: 124,
    minHeight: 44,
    paddingVertical: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 3,
    gap: 8,
    paddingHorizontal: 12,
    maxWidth: '100%',
  },
  targetName: { minWidth: 0, flexShrink: 1 },
  demoAction: {
    minWidth: 44,
    minHeight: 44,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  demoLabel: { minWidth: 0, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 6 },
  horizontalActions: { flexWrap: 'nowrap', gap: 4, paddingRight: 2 },
  horizontalStack: { flexGrow: 0, flexBasis: 'auto', width: 152, minHeight: 92, gap: 4 },
  stackedActions: { flexGrow: 1, flexBasis: 152, minHeight: 104, gap: 6 },
  tile: {
    flexGrow: 1,
    flexBasis: 124,
    minHeight: 104,
    borderRadius: 3,
    padding: 6,
    gap: 3,
    justifyContent: 'space-between',
  },
  tileTopRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  tileIcon: { alignSelf: 'flex-start' },
  tileMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileMarker: { fontSize: 9, lineHeight: 12, letterSpacing: 0.8, opacity: 0.66 },
  tileCopy: { gap: 1 },
  tileTitle: { minWidth: 0, flexShrink: 1, letterSpacing: -0.25 },
  // The lead action is close to a golden rectangle at the rail's base height;
  // utility actions stay narrower so the row has hierarchy rather than clones.
  // 148 × 92 is approximately a golden rectangle and keeps the main action
  // distinct without making every item in the rail oversized.
  primaryTile: { flexBasis: 148, padding: 10 },
  secondaryTile: { padding: 10 },
  compactTile: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 3,
    gap: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  compactIcon: { width: 18, alignItems: 'center' },
  compactCopy: { flex: 1, minWidth: 0, gap: 1 },
  primaryTileTitle: { fontSize: 16, lineHeight: 20 },
  secondaryTileTitle: { fontSize: 14, lineHeight: 20 },
  tileCaption: { minWidth: 0, flexShrink: 1, fontSize: 11, lineHeight: 14 },
});
