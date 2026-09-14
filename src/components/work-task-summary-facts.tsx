import { View } from 'react-native';
import { Text } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { workSummaryAttention, type WorkTaskSummary } from '@/lib/work-summaries';
export function WorkTaskSummaryFacts({ summary }: { summary: WorkTaskSummary | undefined }) {
  const { t } = useLingui();
  if (!summary) return null;
  const labels = {
    operation_unconfirmed: t`Operation needs checking`,
    result_unreviewed: t`Result awaiting review`,
    latest_result_accepted: t`Latest result accepted`,
    latest_result_changes_requested: t`Changes requested for latest result`,
  };
  const events: Record<string, string> = {
    task_created: t`Task created`,
    result_submitted: t`Result submitted`,
    result_reviewed: t`Review recorded`,
    delegation_policy_changed: t`Delegation configuration recorded`,
  };
  return (
    <View testID={`task-summary-${summary.task_id}`}>
      {workSummaryAttention(summary).map((fact) => (
        <Text key={fact} variant="caption" testID={`task-summary-${summary.task_id}-${fact}`}>
          {labels[fact]}
        </Text>
      ))}
      {summary.last_activity ? (
        <Text variant="caption" colorKey="textMuted">
          {events[summary.last_activity.kind] ?? t`Activity recorded`}
        </Text>
      ) : null}
    </View>
  );
}
