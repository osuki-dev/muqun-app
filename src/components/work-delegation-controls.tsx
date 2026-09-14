import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Button } from './themed-button';
import { Input } from './themed-input';
import { PressableScale } from './pressable-scale';
import { LADDER } from './settings-chrome';
import type { WorkAttempt, WorkTask } from '@/lib/work-api';
import {
  captureWorkDelegationIntent,
  confirmedDelegationLead,
  delegationUnavailable,
  type WorkDelegationAvailability,
  type WorkDelegationIntent,
  type WorkDelegationLead,
  type WorkDelegationProblem,
  type WorkDelegationState,
  type WorkDependencyRequirement,
} from '@/lib/work-delegation';

export type WorkDelegationControlsProps = {
  serverId: string;
  serverLabel: string;
  task: WorkTask;
  attempts: readonly WorkAttempt[];
  committed: WorkDelegationState;
  availability: WorkDelegationAvailability;
  error?: string | null;
  onConfigure: (intent: WorkDelegationIntent) => Promise<void>;
};
/** Key by captured server/session/task when integrating. No transport or optimistic committed state. */
export function WorkDelegationControls(props: WorkDelegationControlsProps) {
  const { t } = useLingui();
  const [maxChildren, setMaxChildren] = useState(String(props.committed.policy.max_children));
  const [requirement, setRequirement] = useState<WorkDependencyRequirement>(
    props.committed.policy.dependency_requirement
  );
  const [selectedLead, setSelectedLead] = useState<WorkDelegationLead | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const availability = { ...props.availability, pending: props.availability.pending || submitting };
  const reason = delegationUnavailable(props.task, availability);
  const labels: Record<WorkDelegationProblem, string> = {
    child_task: t`This child task's lead runs its own work. Only the root task's coordinator can delegate.`,
    offline: t`Reconnect before changing delegation.`,
    unavailable: t`Update this Gateway and backend to configure delegation.`,
    pending: t`Check the pending operation before changing delegation.`,
    history_incomplete: t`Load the remaining assistant history before choosing a coordinator.`,
    invalid_limit: t`Enter a child task limit from 0 to 64.`,
    lead_required: t`Choose a confirmed lead assistant explicitly.`,
    lead_changed: t`The chosen lead changed. Choose its current instance again.`,
  };
  const committedLead = props.attempts.find(
    (attempt) => attempt.id === props.committed.coordinator_attempt_id
  );
  const args = {
    serverId: props.serverId,
    task: props.task,
    attempts: props.attempts,
    availability,
    maxChildren,
    requirement,
    selectedLead,
  };
  const enable = captureWorkDelegationIntent({ ...args, enabled: true });
  // Disabling uses the committed policy, so an unfinished draft cannot obstruct revocation.
  const disable = captureWorkDelegationIntent({
    ...args,
    enabled: false,
    maxChildren: String(props.committed.policy.max_children),
    requirement: props.committed.policy.dependency_requirement,
  });
  async function configure(enabled: boolean) {
    const captured = enabled ? enable : disable;
    if (!captured.ok || submitting) return;
    setSubmitting(true);
    setFailed(false);
    try {
      await props.onConfigure(captured.intent);
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <View testID="task-delegation-controls" style={{ gap: LADDER.gap }}>
      <Text>{t`Lead delegation`}</Text>
      <Text variant="caption">
        {props.serverLabel} · {props.task.title}
      </Text>
      <View testID="task-delegation-committed" style={{ gap: LADDER.tight }}>
        <Text>
          {props.committed.policy.enabled
            ? t`Saved policy: delegation enabled`
            : t`Saved policy: delegation disabled`}
        </Text>
        <Text variant="caption">
          {t`Saved child task limit`}: {props.committed.policy.max_children}
        </Text>
        <Text variant="caption">
          {props.committed.policy.dependency_requirement === 'human_accepted'
            ? t`Saved requirement: human acceptance`
            : t`Saved requirement: result available`}
        </Text>
        {props.committed.coordinator_attempt_id ? (
          <Text selectable variant="caption">
            {t`Saved coordinator`}:{' '}
            {committedLead
              ? `${committedLead.agent_kind} · ${committedLead.id.slice(-8)}`
              : props.committed.coordinator_attempt_id}
          </Text>
        ) : null}
      </View>
      <Text variant="caption">{t`Saved configuration does not prove the coordinator is currently authorized. Reconfirm the lead after a Gateway restart.`}</Text>
      <Text variant="caption">{t`Delegation permits direct child tasks within the existing task policy and assistant budget. Enabling it does not start an assistant or send an instruction.`}</Text>
      {reason ? (
        <Text testID="task-delegation-unavailable" variant="caption">
          {labels[reason]}
        </Text>
      ) : null}
      {props.task.parent_task_id === null ? (
        <>
          <Text>{t`Delegation draft`}</Text>
          {props.attempts.flatMap((attempt) => {
            const candidate = confirmedDelegationLead(props.task, attempt);
            if (!candidate) return [];
            const selected =
              selectedLead?.attemptId === candidate.attemptId &&
              selectedLead.instanceId === candidate.instanceId &&
              selectedLead.nativeOwnerEpoch === candidate.nativeOwnerEpoch;
            return [
              <PressableScale
                key={attempt.id}
                testID={`task-delegation-lead-${attempt.id}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, selected, disabled: Boolean(reason) }}
                disabled={Boolean(reason)}
                onPress={() => setSelectedLead(candidate)}
                style={{ minHeight: 48, gap: LADDER.tight }}>
                <Text>
                  {selected ? '✓ ' : ''}
                  {t`Lead`} · {attempt.agent_kind}
                </Text>
                <Text selectable variant="caption">
                  {candidate.attemptId}
                </Text>
                <Text selectable variant="caption">
                  {candidate.instanceId}
                </Text>
              </PressableScale>,
            ];
          })}
          <Input
            testID="task-delegation-limit"
            label={t`Maximum direct child tasks`}
            keyboardType="number-pad"
            value={maxChildren}
            editable={!reason}
            onChangeText={setMaxChildren}
          />
          {(['result_available', 'human_accepted'] as const).map((value) => (
            <PressableScale
              key={value}
              testID={`task-delegation-requirement-${value}`}
              accessibilityRole="radio"
              accessibilityState={{
                checked: requirement === value,
                selected: requirement === value,
                disabled: Boolean(reason),
              }}
              disabled={Boolean(reason)}
              onPress={() => setRequirement(value)}
              style={{ minHeight: 48, justifyContent: 'center' }}>
              <Text>
                {requirement === value ? '✓ ' : ''}
                {value === 'human_accepted'
                  ? t`Require human acceptance`
                  : t`Require a submitted result`}
              </Text>
            </PressableScale>
          ))}
          {!enable.ok && !reason ? <Text variant="caption">{labels[enable.problem]}</Text> : null}
          <Button
            testID="task-delegation-enable"
            disabled={!enable.ok}
            onPress={() => void configure(true)}>
            {props.committed.policy.enabled ? t`Apply delegation settings` : t`Enable delegation`}
          </Button>
          <Button
            testID="task-delegation-disable"
            variant="ghost"
            disabled={!props.committed.policy.enabled || !disable.ok}
            onPress={() => void configure(false)}>{t`Disable delegation`}</Button>
        </>
      ) : null}
      <Text variant="caption">{t`Disabling delegation removes coordinator authority. Existing child assistants keep running.`}</Text>
      {props.error || failed ? (
        <Text variant="caption" colorKey="danger">
          {props.error ?? t`Delegation was not confirmed. Check status before trying again.`}
        </Text>
      ) : null}
    </View>
  );
}
