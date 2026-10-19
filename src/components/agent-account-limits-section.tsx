import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { DisclosureDownIcon, DisclosureUpIcon, RefreshIcon } from '@/icons';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useAgentFeatures } from '@/hooks/use-agent-features';
import { useServerCapabilities } from '@/stores/server-capabilities';
import {
  canReadAgentAccountLimits,
  accountCreditState,
  hasAccountLimitValues,
  ACCOUNT_LIMIT_STALE_MS,
  type AccountLimitBucket,
  type AgentAccountLimits,
  type AccountLimitWindow,
} from '@/lib/agent-account-limits';
import { readAgentAccountLimits } from '@/lib/agent-account-limits-client';
import {
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneQuietControl,
  SHEET_LADDER,
} from './sheet-scene';

export function AgentAccountLimitsSection({
  serverId,
  agentId,
}: {
  serverId?: string;
  agentId?: string;
}) {
  const features = useAgentFeatures(serverId, agentId);
  const capabilities = useServerCapabilities((state) =>
    serverId ? state.byServer[serverId] : undefined
  );
  if (!serverId || !agentId || !canReadAgentAccountLimits(capabilities, features)) return null;
  // Remount on either identity changing: no previous account snapshot may flash in the new sheet.
  return (
    <AccountLimits
      key={JSON.stringify([serverId, agentId])}
      serverId={serverId}
      agentId={agentId}
    />
  );
}

function AccountLimits({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [revision, setRevision] = useState(0);
  const [details, setDetails] = useState(false);
  const [result, setResult] = useState<AgentAccountLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    setStale(false);
    if (!result) return;
    const delay = result.observed_at_ms + ACCOUNT_LIMIT_STALE_MS - Date.now();
    if (delay <= 0) {
      setStale(true);
      return;
    }
    const timer = setTimeout(() => setStale(true), Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [result]);
  const buckets = result?.limits.filter(hasAccountLimitValues) ?? [];
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setFailed(false);
    setResult(null);
    void readAgentAccountLimits(serverId, agentId, controller.signal)
      .then((value) => {
        if (active) setResult(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [serverId, agentId, revision]);
  const plan = buckets.length === 1 ? buckets[0]?.plan_type : null;
  return (
    <>
      <SheetSceneGroupHeading
        title={t`Account limits`}
        meta={
          <View style={styles.headerMeta}>
            {plan ? (
              <Text variant="caption" color={theme.colors.textMuted}>
                {plan}
              </Text>
            ) : null}
            <SheetSceneQuietControl
              testID="agent-account-limits-refresh"
              accessibilityLabel={t`Refresh account limits`}
              busy={loading}
              onPress={() => {
                if (!loading) setRevision((value) => value + 1);
              }}>
              <RefreshIcon size={16} color={theme.colors.textMuted} />
            </SheetSceneQuietControl>
          </View>
        }
      />
      {stale ? <CompactNotice text={t`Usage snapshot is stale`} /> : null}
      {failed ? <CompactNotice text={t`Could not read account limits`} /> : null}
      {result?.status === 'unavailable' ? (
        <CompactNotice
          text={
            result.reason === 'not_authenticated'
              ? t`Not signed in on the host`
              : t`Account limits temporarily unavailable`
          }
        />
      ) : null}
      {result?.status === 'available' ? (
        <>
          {result.ordinary_usage_allowed === false ? (
            <CompactNotice
              text={t`Included usage is restricted. Paid or alternative usage may still be available.`}
            />
          ) : null}
          {buckets.length === 0 ? <CompactNotice text={t`No quota values reported`} /> : null}
          {buckets.map((bucket, index) => (
            <QuotaBucket
              key={bucket.id}
              bucket={bucket}
              heading={bucket.name || (buckets.length > 1 ? t`Quota ${index + 1}` : null)}
              showPlan={buckets.length > 1}
              resetCount={index === 0 ? result.reset_credits?.available_count : undefined}
            />
          ))}
        </>
      ) : null}
      {result ? (
        <>
          <PressableScale
            testID="agent-account-limits-details"
            accessibilityRole="button"
            accessibilityState={{ expanded: details }}
            onPress={() => setDetails((value) => !value)}
            style={styles.detailsButton}>
            <Text variant="caption" color={theme.colors.textMuted}>{t`Details`}</Text>
            {details ? (
              <DisclosureUpIcon size={14} color={theme.colors.textMuted} />
            ) : (
              <DisclosureDownIcon size={14} color={theme.colors.textMuted} />
            )}
          </PressableScale>
          {details ? (
            <View style={styles.details}>
              <CompactNotice text={t`Shared across sessions. Refresh to update.`} />
              <CompactRow
                label={t`Last checked`}
                value={new Date(result.observed_at_ms).toLocaleString()}
              />
              {result.status === 'available' ? (
                <>
                  <CompactRow
                    label={t`Included usage`}
                    value={
                      result.ordinary_usage_allowed === true
                        ? t`Available`
                        : result.ordinary_usage_allowed === false
                          ? t`Limit reached`
                          : t`Not reported`
                    }
                  />
                  {result.reset_credits ? (
                    <>
                      <CompactRow
                        label={t`Available resets`}
                        value={
                          result.reset_credits.available_count === null
                            ? t`Not reported`
                            : String(result.reset_credits.available_count)
                        }
                      />
                      {result.reset_credits.credits?.map((credit, index) => (
                        <View key={index} style={styles.detailItem}>
                          <CompactRow
                            label={credit.title || t`Reset credit`}
                            value={credit.status === 'available' ? t`Available` : t`Not reported`}
                          />
                          {credit.expires_at_ms === null ? null : (
                            <CompactNotice
                              text={t`Expires at ${new Date(credit.expires_at_ms).toLocaleString()}`}
                            />
                          )}
                        </View>
                      ))}
                    </>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
      <SheetSceneGroupRule />
    </>
  );
}

function CompactNotice({ text }: { text: string }) {
  const theme = useThemeTokens();
  return (
    <Text variant="caption" color={theme.colors.textMuted} style={styles.notice}>
      {text}
    </Text>
  );
}

function CompactRow({ label, value }: { label: string; value: string }) {
  const theme = useThemeTokens();
  return (
    <View style={styles.row}>
      <Text variant="caption" color={theme.colors.textMuted} style={styles.label}>
        {label}
      </Text>
      <Text variant="caption" weight="semibold" color={theme.colors.text} style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

function RemainingBar({ remaining }: { remaining: number }) {
  const theme = useThemeTokens();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.max(0, Math.min(100, remaining)) }}
      style={[styles.track, { backgroundColor: theme.colors.primarySubtle }]}>
      <View
        style={[
          styles.fill,
          {
            width: `${Math.max(0, Math.min(100, remaining))}%`,
            backgroundColor: theme.colors.primary,
          },
        ]}
      />
    </View>
  );
}

function QuotaWindow({ window }: { window: AccountLimitWindow }) {
  const { t } = useLingui();
  const minutes = window.window_duration_minutes;
  const duration =
    minutes === null
      ? t`Period not reported`
      : minutes % 10080 === 0
        ? plural(minutes / 10080, { one: '# week', other: '# weeks' })
        : minutes % 1440 === 0
          ? plural(minutes / 1440, { one: '# day', other: '# days' })
          : minutes % 60 === 0
            ? plural(minutes / 60, { one: '# hour', other: '# hours' })
            : plural(minutes, { one: '# minute', other: '# minutes' });
  const amount =
    window.remaining === null
      ? null
      : `${window.remaining.toLocaleString()}${window.unit === 'percent' ? '%' : ` ${window.unit}`}`;
  const reset =
    window.resets_at_ms === null
      ? t`Reset time not reported`
      : t`Resets at ${new Date(window.resets_at_ms).toLocaleString()}`;
  return (
    <View style={styles.window}>
      <CompactRow
        label={window.label || duration}
        value={amount === null ? t`Remaining unknown` : t`${amount} remaining`}
      />
      {window.unit === 'percent' && window.remaining !== null ? (
        <RemainingBar remaining={window.remaining} />
      ) : null}
      <CompactNotice text={window.label ? `${duration} · ${reset}` : reset} />
    </View>
  );
}

function QuotaBucket({
  bucket,
  heading,
  showPlan,
  resetCount,
}: {
  bucket: AccountLimitBucket;
  heading: string | null;
  showPlan: boolean;
  resetCount?: number | null;
}) {
  const { t } = useLingui();
  const credit = bucket.credits;
  const creditState = credit ? accountCreditState(credit) : null;
  const monthly = bucket.individual_limit;
  const remaining =
    monthly?.remaining_percent == null ? null : `${monthly.remaining_percent.toLocaleString()}%`;
  return (
    <View style={styles.bucket}>
      {heading || (showPlan && bucket.plan_type) ? (
        <CompactRow label={heading || t`Plan`} value={showPlan ? bucket.plan_type || '' : ''} />
      ) : null}
      {bucket.model_id ? <CompactRow label={t`Model`} value={bucket.model_id} /> : null}
      {bucket.windows.map((window) => (
        <QuotaWindow key={window.id} window={window} />
      ))}
      <View style={styles.summary}>
        {credit ? (
          <View style={styles.summaryMetric}>
            <CompactRow
              label={t`Credits`}
              value={
                creditState === 'unlimited'
                  ? t`Unlimited`
                  : creditState === 'balance'
                    ? formatCredits(credit.balance!)
                    : creditState === 'available'
                      ? t`Available`
                      : creditState === 'unavailable'
                        ? t`Not available`
                        : t`Not reported`
              }
            />
          </View>
        ) : null}
        {resetCount != null ? (
          <View style={styles.summaryMetric}>
            <CompactRow label={t`Available resets`} value={String(resetCount)} />
          </View>
        ) : null}
      </View>
      {monthly ? (
        <View style={styles.window}>
          <CompactRow
            label={t`Monthly credit limit`}
            value={remaining === null ? t`Remaining unknown` : t`${remaining} remaining`}
          />
          {monthly.remaining_percent !== null ? (
            <RemainingBar remaining={monthly.remaining_percent} />
          ) : null}
          <CompactRow
            label={t`Credits used`}
            value={`${monthly.used == null ? t`Not reported` : formatCredits(monthly.used)} / ${monthly.limit == null ? t`Not reported` : formatCredits(monthly.limit)}`}
          />
          {monthly.resets_at_ms !== null ? (
            <CompactNotice text={t`Resets at ${new Date(monthly.resets_at_ms).toLocaleString()}`} />
          ) : null}
        </View>
      ) : null}
      {bucket.spend_control_reached === true ? (
        <CompactRow label={t`Spend control`} value={t`Limit reached`} />
      ) : null}
    </View>
  );
}

/** Display grouping only: never convert exact decimal credit evidence to a floating-point number. */
function formatCredits(value: string): string {
  const [integer, fraction = ''] = value.split('.');
  const grouped = (integer === '' ? '0' : integer === '-' ? '-0' : integer!).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ','
  );
  const significant = fraction.replace(/0+$/, '');
  return significant ? `${grouped}.${significant}` : grouped;
}

const styles = StyleSheet.create({
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: SHEET_LADDER.gap },
  summary: { flexDirection: 'row', flexWrap: 'wrap', columnGap: SHEET_LADDER.snug },
  summaryMetric: { flexGrow: 1 },
  bucket: { gap: SHEET_LADDER.tight },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SHEET_LADDER.snug,
    paddingVertical: 3,
  },
  label: { flexShrink: 1 },
  value: { flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  window: { gap: 3, paddingVertical: SHEET_LADDER.gap },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  notice: { paddingVertical: 2 },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    minHeight: 36,
    alignSelf: 'flex-start',
  },
  details: { paddingBottom: SHEET_LADDER.gap, gap: SHEET_LADDER.tight },
  detailItem: { paddingTop: SHEET_LADDER.gap },
});
