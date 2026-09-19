import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ArrowUpRight, ChevronDown, Link, Play, SquareTerminal } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { OpenCodeIcon } from '@/components/opencode-icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { GatewayRecord } from '@/lib/gateway-storage';

/** Target choice is local; a selection alone never switches a live connection. */
export function HomeLaunchActions({
  servers,
  selectedServerId,
  onNewOpenCode,
  onNewTerminal,
  onSsh,
  onPair,
  onDemo,
}: {
  servers: readonly GatewayRecord[];
  selectedServerId?: string;
  onNewOpenCode: (serverId: string) => Promise<unknown>;
  onNewTerminal: (serverId: string) => Promise<unknown>;
  onSsh: () => Promise<unknown>;
  onPair: () => Promise<unknown>;
  onDemo?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  // This is visual feedback only; the shared command controller owns the
  // operation guard across layouts, buttons, and unmounts.
  const [opening, setOpening] = useState(false);
  const chosen =
    servers.find((server) => server.serverId === chosenId) ??
    servers.find((server) => server.serverId === selectedServerId) ??
    (servers.length === 1 ? servers[0] : undefined);

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
        accessibilityState={{ expanded: choosing, disabled: opening }}
        disabled={opening}
        onPress={() => {
          if (servers.length === 0) void launch(onPair);
          else setChoosing(!choosing);
        }}
        style={[styles.target, { borderColor: theme.colors.borderStrong }]}>
        <Text variant="bodySmall" weight="semibold" style={styles.targetName}>
          {chosen ? chosen.label : servers.length ? t`Choose a gateway` : t`Pair a gateway`}
        </Text>
        <ChevronDown size={16} color={theme.colors.primary} />
      </PressableScale>
      {choosing ? (
        <View style={[styles.targets, { backgroundColor: background(theme.colors.surfaceRaised) }]}>
          {servers.map((server) => (
            <PressableScale
              key={server.serverId}
              accessibilityRole="radio"
              accessibilityState={{ checked: server.serverId === chosen?.serverId }}
              onPress={() => {
                setChosenId(server.serverId);
                setChoosing(false);
              }}
              style={styles.targetOption}>
              <Text variant="bodySmall">{server.label}</Text>
            </PressableScale>
          ))}
        </View>
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
      <View style={styles.actions}>
        <LaunchTile
          testID="home-new-opencode"
          primary
          title={t`New OpenCode`}
          caption={chosen ? chosen.label : t`Choose a gateway first`}
          icon={<OpenCodeIcon size={24} color={theme.colors.onPrimary} />}
          disabled={opening}
          onPress={() => {
            if (chosen) void launch(() => onNewOpenCode(chosen.serverId));
            else if (servers.length) setChoosing(true);
            else void launch(onPair);
          }}
        />
        <LaunchTile
          testID="home-new-terminal"
          title={t`New terminal`}
          caption={chosen ? chosen.label : t`Choose a gateway first`}
          icon={<SquareTerminal size={24} color={theme.colors.primary} />}
          disabled={opening}
          onPress={() => {
            if (chosen) void launch(() => onNewTerminal(chosen.serverId));
            else if (servers.length) setChoosing(true);
            else void launch(onPair);
          }}
        />
        <LaunchTile
          testID="home-open-ssh"
          title={t`SSH connection`}
          caption={t`Choose a saved host`}
          icon={<Link size={24} color={theme.colors.primary} />}
          disabled={opening}
          onPress={() => {
            void launch(onSsh);
          }}
        />
      </View>
      {opening ? <Text variant="caption" color={theme.colors.textMuted}>{t`Opening…`}</Text> : null}
    </View>
  );
}

function LaunchTile({
  title,
  caption,
  icon,
  onPress,
  primary = false,
  disabled,
  testID,
}: {
  title: string;
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
      accessibilityLabel={`${title}, ${caption}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.tile,
        {
          backgroundColor: primary ? theme.colors.primary : background(theme.colors.surface),
          borderColor: primary ? theme.colors.primary : theme.colors.borderStrong,
          opacity: disabled ? 0.6 : 1,
        },
      ]}>
      <View style={styles.tileHeader}>
        {icon}
        <ArrowUpRight size={18} color={ink} />
      </View>
      <Text variant="bodySmall" weight="semibold" color={ink}>
        {title}
      </Text>
      <Text variant="caption" color={primary ? ink : theme.colors.textMuted}>
        {caption}
      </Text>
    </PressableScale>
  );
}

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
  targets: { borderRadius: 8, padding: 8 },
  targetOption: { minHeight: 44, padding: 12, justifyContent: 'center' },
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexGrow: 1,
    flexBasis: 152,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
});
