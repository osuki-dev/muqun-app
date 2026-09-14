import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { SettingsSheet } from '@/components/settings-sheet';
import { WorkTaskWorkspace } from '@/components/work-task-workspace';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/** IDs only in route state; prompts and pending mutation keys never enter URLs. */
export default function WorkTasksScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const params = useLocalSearchParams<{ serverId: string; sessionId: string; cwd?: string }>();
  const record = useGatewayConnectionStore((state) =>
    state.record?.serverId === params.serverId ? state.record : null
  );
  if (!record || !params.sessionId)
    return (
      <SettingsSheet
        fullScreen
        title={t`Tasks`}
        caption={t`Return to this server to continue.`}
        closeLabel={t`Close`}
        onClose={() => router.back()}>
        <Text variant="bodySmall">{t`Return to the task's original server and session.`}</Text>
      </SettingsSheet>
    );
  return (
    <WorkTaskWorkspace
      key={`${params.serverId}:${params.sessionId}`}
      record={record}
      sessionId={params.sessionId}
      initialCwd={params.cwd}
      onClose={() => router.back()}
    />
  );
}
