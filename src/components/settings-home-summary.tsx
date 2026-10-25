import { useLingui } from '@lingui/react/macro';
import { useRouter } from 'expo-router';
import { SettingsNavRow } from './settings-chrome';
import { ComputerIcon, NextIcon } from '@/icons';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { useHomeSummary } from '@/stores/home-summary';

export function SettingsHomeSummary({ records }: { records: readonly GatewayRecord[] }) {
  const { t } = useLingui();
  const router = useRouter();
  const preferred = useHomeSummary((state) => state.config.preferred);
  const collectorId = useHomeSummary((state) => state.collectorId);
  const name = records.find((record) => record.serverId === (collectorId ?? preferred))?.label;
  return (
    <SettingsNavRow
      icon={ComputerIcon}
      label={t`Home connections`}
      detail={preferred && name ? t`Via ${name}` : t`Connect separately`}
      trailing={NextIcon}
      testID="home-summary-settings"
      onPress={() => router.push('/settings-home-connections')}
    />
  );
}
