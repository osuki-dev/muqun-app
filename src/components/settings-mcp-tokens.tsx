import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { LADDER, SettingsSection } from '@/components/settings-chrome';
import { Text } from '@/components/text';
import { Skeleton } from '@/components/themed-skeleton';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { settleAfter } from '@/lib/compiler-safe-control-flow';
import { feedback } from '@/lib/feedback';
import { fetchMcpTokens, hasMcpServer, revokeMcpToken, type McpToken } from '@/lib/mcp-tokens';
import { describeGatewayFailure } from '@/lib/network-error';
import { useServerCapabilities } from '@/stores/server-capabilities';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; tokens: McpToken[] };

/**
 * The tokens coding agents use to reach this gateway, with the revoke that
 * cuts one off. Absent entirely unless the gateway's MCP server is running.
 */
export function McpTokens({ serverId }: { serverId: string }) {
  const mcp = useServerCapabilities((state) => hasMcpServer(state.byServer[serverId]));
  if (!mcp) return null;
  return <McpTokensSection />;
}

function McpTokensSection() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    // Cleared by the cleanup, so an answer that lands after the row has closed
    // is dropped rather than set on an unmounted component.
    let live = true;
    void fetchMcpTokens()
      .catch(() => null)
      .then((tokens) => {
        if (!live) return;
        setLoad(tokens ? { status: 'ready', tokens } : { status: 'error' });
      });
    return () => {
      live = false;
    };
  }, []);

  function removeToken(id: string) {
    setLoad((current) =>
      current.status === 'ready'
        ? { status: 'ready', tokens: current.tokens.filter((token) => token.id !== id) }
        : current
    );
  }

  return (
    <View testID="mcp-tokens" style={styles.section}>
      <SettingsSection title={t`MCP tokens`}>
        {load.status === 'loading' ? (
          <View testID="mcp-tokens-loading" style={styles.note}>
            <Skeleton variant="text" width="55%" height={16} />
            <Skeleton variant="text" width="35%" height={16} />
          </View>
        ) : load.status === 'error' ? (
          <View testID="mcp-tokens-error" style={styles.note}>
            <Text variant="caption" color={theme.colors.textMuted}>
              {t`Could not load tokens`}
            </Text>
          </View>
        ) : load.tokens.length === 0 ? (
          <View testID="mcp-tokens-empty" style={styles.note}>
            <Text variant="caption" color={theme.colors.textMuted}>
              {t`No tokens`}
            </Text>
          </View>
        ) : (
          <TokenRows tokens={load.tokens} onRevoked={removeToken} />
        )}
      </SettingsSection>
      <Text variant="caption" color={theme.colors.textSubtle}>
        {t`Tokens coding agents use to reach this gateway from this computer.`}
      </Text>
    </View>
  );
}

function TokenRows({ tokens, onRevoked }: { tokens: McpToken[]; onRevoked: (id: string) => void }) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const { showToast } = useToast();
  const relative = useRelativeTime();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  function titleOf(token: McpToken): string {
    if (token.binding.kind === 'pane') {
      const paneId = token.binding.paneId;
      return t`Pane ${paneId}`;
    }
    const agentId = token.binding.agentId;
    return t`${agentId} service`;
  }

  function expiry(token: McpToken, nowMs: number): string {
    if (token.expiresMs === null) return t`Never expires`;
    const left = token.expiresMs - nowMs;
    if (left <= 0) return t`Expired`;
    if (left < HOUR_MS) {
      const minutes = Math.max(1, Math.floor(left / MINUTE_MS));
      return t`Expires in ${minutes}m`;
    }
    if (left < DAY_MS) {
      const hours = Math.floor(left / HOUR_MS);
      return t`Expires in ${hours}h`;
    }
    const days = Math.floor(left / DAY_MS);
    return t`Expires in ${days}d`;
  }

  function lastUsed(token: McpToken, nowMs: number): string {
    if (token.lastUsedMs === undefined) return t`Never used`;
    const when = relative(token.lastUsedMs, nowMs);
    return t`Last used ${when}`;
  }

  async function revoke(token: McpToken) {
    setConfirming(null);
    setRevoking(token.id);
    return settleAfter(
      async () => {
        try {
          // False means the gateway no longer knows it, which is what the
          // reader wanted anyway: the row goes either way.
          await revokeMcpToken(token.id);
          await feedback('success');
          onRevoked(token.id);
        } catch (error) {
          showToast({
            variant: 'danger',
            title: t`Could not revoke token`,
            message: describeGatewayFailure(error, t`Try again once the gateway responds.`).message,
          });
        }
      },
      () => {
        setRevoking(null);
      }
    );
  }

  // Read at render because both captions are relative to *now* and an open row
  // has to keep telling the truth about a timestamp ageing under it. Same call
  // and reason as `PairedDevices`.
  // oxlint-disable-next-line react/purity -- deliberate: see above.
  const nowMs = Date.now();

  return (
    <>
      {tokens.map((token) => {
        const title = titleOf(token);
        return (
          <View
            key={token.id}
            testID={`mcp-tokens-row-${token.id}`}
            style={[styles.row, { paddingVertical: profile.settingsRowPaddingVertical }]}>
            <View style={styles.copy}>
              <Text variant="bodySmall" numberOfLines={1}>
                {title}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {`${expiry(token, nowMs)} · ${lastUsed(token, nowMs)}`}
              </Text>
            </View>
            {confirming === token.id ? (
              <PressableScale
                testID={`mcp-tokens-revoke-${token.id}`}
                accessibilityRole="button"
                accessibilityLabel={t`Confirm revoke ${title}`}
                feedback="selection"
                disabled={revoking !== null}
                onPress={() => void revoke(token)}
                style={[
                  styles.revoke,
                  { borderRadius: profile.radius.sm },
                  { backgroundColor: surfaceBackground(theme.colors.danger) },
                ]}>
                {/* Semibold through the prop, as `PairedDevices` does. */}
                <Text variant="caption" weight="semibold" color={theme.colors.onPrimary}>
                  {t`Revoke`}
                </Text>
              </PressableScale>
            ) : (
              <PressableScale
                testID={`mcp-tokens-revoke-${token.id}`}
                accessibilityRole="button"
                accessibilityLabel={t`Revoke ${title}`}
                disabled={revoking !== null}
                onPress={() => setConfirming(token.id)}
                style={[styles.revoke, { borderRadius: profile.radius.sm }]}>
                <Text variant="caption" color={theme.colors.danger}>
                  {revoking === token.id ? t`Revoking…` : t`Revoke`}
                </Text>
              </PressableScale>
            )}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: LADDER.gap },
  note: { padding: LADDER.gutter, gap: LADDER.snug },
  row: {
    paddingHorizontal: LADDER.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  revoke: {
    minHeight: 32,
    paddingHorizontal: LADDER.snug,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
