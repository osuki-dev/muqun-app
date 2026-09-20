import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ArrowUpRight, ChevronDown, Link, Play, SquareTerminal } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';

import { OpenCodeIcon } from '@/components/opencode-icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { reachabilityDescription } from '@/i18n/labels';
import type { ServerReachability } from '@/lib/server-reachability';
import { useHomeTargetPicker } from '@/stores/home-target-picker';

/** Target choice is local to Home; a selection alone never switches a live connection. */
export function HomeLaunchActions({
  servers,
  selectedServerId,
  reachabilityByServer,
  onNewOpenCode,
  onNewTerminal,
  onSsh,
  onPair,
  onDemo,
}: {
  servers: readonly GatewayRecord[];
  selectedServerId?: string;
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  onNewOpenCode: (serverId: string) => Promise<unknown>;
  onNewTerminal: (serverId: string) => Promise<unknown>;
  onSsh: () => Promise<unknown>;
  onPair: () => Promise<unknown>;
  onDemo?: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const router = useRouter();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const { fontScale } = useWindowDimensions();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [pickerRequestId, setPickerRequestId] = useState<number | null>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  // This is visual feedback only; the shared command controller owns the
  // operation guard across layouts, buttons, and unmounts.
  const [opening, setOpening] = useState(false);
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
  const chosenCaption = chosen ? chosen.label : t`Choose a gateway first`;

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
  const wideActions =
    chosen !== undefined &&
    availableWidth !== null &&
    availableWidth >= WIDE_ACTIONS_MIN_WIDTH * Math.max(1, fontScale);

  function handleActionsLayout(event: LayoutChangeEvent) {
    const width = event.nativeEvent.layout.width;
    setAvailableWidth((current) =>
      current === null || Math.abs(current - width) > 0.5 ? width : current
    );
  }

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

  return (
    <View testID="home-launch-actions" style={styles.root}>
      <PressableScale
        testID={servers.length === 0 ? 'home-pair-server' : 'home-launch-target'}
        accessibilityRole="button"
        accessibilityState={{ expanded: pickerOpenRequestId !== null, disabled: opening }}
        disabled={opening}
        onPress={() => {
          if (servers.length === 0) void launch(onPair);
          else openTargetPicker();
        }}
        style={[
          styles.target,
          {
            borderColor: theme.colors.borderStrong,
            backgroundColor: background(theme.colors.surface),
          },
        ]}>
        <Text variant="bodySmall" weight="semibold" style={styles.targetName}>
          {chosen ? chosen.label : servers.length ? t`Choose a gateway` : t`Pair a gateway`}
        </Text>
        <ChevronDown size={16} color={theme.colors.primary} />
      </PressableScale>
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
      <View
        onLayout={handleActionsLayout}
        style={[styles.actions, wideActions ? styles.actionsWide : styles.actionsCompact]}>
        <View style={wideActions ? styles.primarySlotWide : styles.primarySlotCompact}>
          <LaunchTile
            testID="home-new-opencode"
            primary
            title={t`New OpenCode`}
            caption={chosenCaption}
            icon={<OpenCodeIcon size={26} color={theme.colors.onPrimary} />}
            disabled={opening || chosenOffline}
            onPress={() => {
              if (chosen && !chosenOffline) void launch(() => onNewOpenCode(chosen.serverId));
              else if (servers.length) openTargetPicker();
              else void launch(onPair);
            }}
          />
        </View>
        <View style={wideActions ? styles.secondaryGroupWide : styles.secondaryGroupCompact}>
          <View style={styles.secondarySlot}>
            <LaunchTile
              testID="home-new-terminal"
              title={t`Terminal`}
              accessibilityTitle={t`New terminal`}
              caption={chosenCaption}
              icon={<SquareTerminal size={22} color={theme.colors.primary} />}
              disabled={opening || chosenOffline}
              onPress={() => {
                if (chosen && !chosenOffline) void launch(() => onNewTerminal(chosen.serverId));
                else if (servers.length) openTargetPicker();
                else void launch(onPair);
              }}
            />
          </View>
          <View style={styles.secondarySlot}>
            <LaunchTile
              testID="home-open-ssh"
              title={t`SSH`}
              caption={t`SSH hosts`}
              icon={<Link size={22} color={theme.colors.primary} />}
              disabled={opening}
              onPress={() => {
                void launch(onSsh);
              }}
            />
          </View>
        </View>
      </View>
      {opening ? <Text variant="caption" color={theme.colors.textMuted}>{t`Opening…`}</Text> : null}
    </View>
  );
}

function LaunchTile({
  title,
  accessibilityTitle,
  caption,
  icon,
  onPress,
  primary = false,
  disabled,
  testID,
}: {
  title: string;
  accessibilityTitle?: string;
  caption: string;
  icon: ReactNode;
  onPress: () => void;
  primary?: boolean;
  disabled: boolean;
  testID: string;
}) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const ink = primary ? theme.colors.onPrimary : theme.colors.text;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityTitle ?? title}, ${caption}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.tile,
        primary ? styles.primaryTile : styles.secondaryTile,
        {
          backgroundColor: background(primary ? theme.colors.primary : theme.colors.surface),
          borderColor: primary ? background(theme.colors.primary) : theme.colors.borderStrong,
          opacity: disabled ? 0.6 : 1,
        },
      ]}>
      <View style={styles.tileIcon}>{icon}</View>
      <Text
        variant={primary ? 'heading' : 'bodySmall'}
        weight="semibold"
        color={ink}
        style={[styles.tileTitle, primary ? styles.primaryTileTitle : styles.secondaryTileTitle]}>
        {title}
      </Text>
      <Text
        variant="caption"
        color={primary ? ink : theme.colors.textMuted}
        style={styles.tileCaption}>
        {caption}
      </Text>
      <ArrowUpRight size={18} color={ink} style={styles.tileArrow} />
    </PressableScale>
  );
}

const WIDE_ACTIONS_MIN_WIDTH = 340;

const styles = StyleSheet.create({
  root: { gap: 16, minWidth: 0 },
  target: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  targetName: { flexShrink: 1 },
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
  actions: { width: '100%', minWidth: 0, gap: 6 },
  actionsWide: { flexDirection: 'row' },
  actionsCompact: { flexDirection: 'column' },
  primarySlotWide: { flex: 1.6, minWidth: 0 },
  primarySlotCompact: { width: '100%', minWidth: 0 },
  secondaryGroupWide: { flex: 2, minWidth: 0, flexDirection: 'row', gap: 6 },
  secondaryGroupCompact: { minWidth: 0, flexDirection: 'row', gap: 6 },
  secondarySlot: { flex: 1, minWidth: 0 },
  tile: {
    flex: 1,
    width: '100%',
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    padding: 10,
    gap: 8,
    justifyContent: 'flex-start',
  },
  tileIcon: { alignSelf: 'flex-start' },
  tileTitle: { minWidth: 0, flexShrink: 1 },
  primaryTile: { padding: 16 },
  secondaryTile: { padding: 10 },
  primaryTileTitle: { fontSize: 18, lineHeight: 24 },
  secondaryTileTitle: { fontSize: 14, lineHeight: 20 },
  tileCaption: { minWidth: 0, flexShrink: 1 },
  tileArrow: { alignSelf: 'flex-end', marginTop: 'auto' },
});
