import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';
import { useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { Text } from '@osuki-dev/ui';
import { SettingsBlock, SettingsChoiceRow, SettingsToggleRow } from './settings-chrome';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { provisionHomeSummary, revokeHomeSummary } from '@/lib/home-summary-setup';
import { useHomeSummary } from '@/stores/home-summary';

/** Mounted only for a multi-computer installation. */
export function SettingsHomeSummary({ records }: { records: readonly GatewayRecord[] }) {
  const { t } = useLingui();
  const config = useHomeSummary((state) => state.config);
  const collectorId = useHomeSummary((state) => state.collectorId);
  const configure = useHomeSummary((state) => state.configure);
  const [backups, setBackups] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function choose(serverId: string | null) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    await settleAfter(
      () =>
        recoverWith(
          async () => {
            if (
              serverId &&
              config.preferred &&
              config.collectors.some((entry) => entry.serverId === serverId)
            ) {
              configure({ ...config, preferred: serverId });
              return;
            }
            configure({ ...config, preferred: null });
            const remaining = await revokeHomeSummary(records, config);
            configure(remaining);
            if (remaining.collectors.length) {
              setMessage(
                t`Collection stopped. Some computers are unavailable; retry to remove their summary access.`
              );
              return;
            }
            if (!serverId) return;
            const next = await provisionHomeSummary(records, serverId, backups, configure);
            configure(next);
            if (
              next.collectors.some(
                (entry) => Object.keys(entry.sources).length < records.length - 1
              )
            ) {
              setMessage(
                t`Some computers remain directly connected. Check their Gateway support and computer links.`
              );
            }
          },
          () => {
            setMessage(
              t`Could not enable summaries. Check that the selected Gateway supports this feature and the computers are linked.`
            );
          }
        ),
      () => setBusy(false)
    );
  }
  return (
    <SettingsBlock
      label={t`Multi-computer summaries`}
      caption={
        <Text variant="caption">{t`Share read-only task titles, progress, status and default folders with the selected computer. Terminals and conversations stay directly connected.`}</Text>
      }>
      <SettingsChoiceRow
        label={t`Direct connections`}
        value={!config.preferred ? t`Selected` : ''}
        accessibilityLabel={t`Use direct connections`}
        testID="home-summary-direct"
        onPress={() => void choose(null)}
      />
      {!config.preferred ? (
        <SettingsToggleRow
          label={t`Allow backup computers`}
          detail={t`Allow the other paired computers to read task summaries and take over if the preferred computer disconnects.`}
          value={backups}
          onValueChange={setBackups}
        />
      ) : null}
      {records
        .filter((record) => !record.sshTunnel)
        .map((record) => (
          <SettingsChoiceRow
            key={record.serverId}
            label={record.label}
            value={
              record.serverId === config.preferred
                ? t`Preferred`
                : record.serverId === collectorId
                  ? t`Active`
                  : ''
            }
            detail={busy ? t`Updating summary access…` : undefined}
            accessibilityLabel={t`Use ${record.label} for summaries`}
            testID={`home-summary-prefer-${record.serverId}`}
            onPress={() => void choose(record.serverId)}
          />
        ))}
      {message ? <Text variant="caption">{message}</Text> : null}
      {collectorId ? (
        <Text variant="caption">{t`Summaries via ${records.find((record) => record.serverId === collectorId)?.label ?? collectorId}`}</Text>
      ) : null}
    </SettingsBlock>
  );
}
