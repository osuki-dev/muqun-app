import { WorkTaskSection } from '@/components/work-task-scroll';
import { useWorkTaskFocus } from '@/hooks/use-work-task-focus';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { Text } from '@osuki-dev/ui';
import { Button } from '@/components/themed-button';
import { PressableScale } from '@/components/pressable-scale';
import { LADDER, SectionLabel } from '@/components/settings-chrome';

import type { WorkDetail, WorkFailureCode } from '@/lib/work-api';
import { workOperationBlocksExecution } from '@/lib/work-lifecycle';

export type WorkTaskDetailProps = {
  focusHeading?: boolean;
  detail: WorkDetail;
  serverLabel: string;
  connected: boolean;
  available: boolean;
  busy?: boolean;
  error?: string | null;
  selectedAttemptId: string | null;
  selectedResultId: string | null;
  /** Only identities freshly verified by the controller may navigate to a terminal. */
  currentAttemptIds: readonly string[];
  onSelectAttempt: (id: string) => void;
  onSelectResult: (id: string) => void;
  onCheckStatus: () => void;
  onOpenTerminal: (attemptId: string) => void;
  onAcceptResult: (resultId: string, expectedRevision: number) => void;
  onRequestChanges: (resultId: string, expectedRevision: number) => void;
  onPreviewArtifact?: (resultId: string, index: number) => void;
  reviewNote?: ReactNode;
  lifecycle?: ReactNode;
  /** Existing composer, explicitly addressed by its controller, never by browsing a worker. */
  composer?: ReactNode;
};

/** Inside the route's scroll container; no polling, implicit navigation, or mutation effects. */
export function WorkTaskDetail(props: WorkTaskDetailProps) {
  const { t } = useLingui();
  const { detail, selectedAttemptId, selectedResultId } = props;
  const headingRef = useWorkTaskFocus(Boolean(props.focusHeading), detail.task.id);
  const selectedAttempt = detail.attempts.find((attempt) => attempt.id === selectedAttemptId);
  const selectedResult = detail.results.find((result) => result.id === selectedResultId);
  const reviews = detail.reviews.filter((review) => review.submission_id === selectedResultId);
  const latestReview = reviews.at(-1);
  const unresolved = detail.operations.filter((operation) =>
    workOperationBlocksExecution(operation, detail.attempts)
  );
  const operationKinds = {
    create_task: t`Create task`,
    start_attempt: t`Start assistant`,
    deliver_prompt: t`Send instruction`,
    submit_result: t`Submit result`,
    review_result: t`Review result`,
    pause_task: t`Pause delegation`,
    reconcile_attempt: t`Check assistant lifecycle`,
    interrupt_attempt: t`Interrupt assistant`,
    configure_delegation: t`Configure delegation`,
    set_dependencies: t`Set task dependencies`,
  };
  const operationStates = {
    prepared: t`Prepared`,
    submitting: t`In progress`,
    acknowledged: t`Acknowledged, not proof of completion`,
    refused: t`Refused`,
    unconfirmed: t`Not confirmed`,
  };
  const failures: Record<WorkFailureCode, string> = {
    invalid_input: t`Check the task details before continuing.`,
    not_found: t`This task or assistant is no longer available.`,
    scope_mismatch: t`Return to the task's original server and session.`,
    revision_conflict: t`The task changed. Refresh and review the latest state.`,
    request_key_conflict: t`This request conflicts with an earlier operation. Check status.`,
    capability_unavailable: t`This session does not support this action. Check its Gateway capabilities.`,
    instance_changed: t`The assistant was replaced. Choose a current assistant.`,
    not_ready: t`The assistant is not ready for another instruction.`,
    approval_required: t`The assistant needs a decision. Inspect its terminal.`,
    delivery_unconfirmed: t`The instruction may already have arrived. Check status before sending again.`,
    artifact_changed: t`A submitted file changed. Ask for a new result submission.`,
    artifact_missing: t`A submitted file is unavailable. Ask for a new result submission.`,
    resource_limit: t`The task has reached its configured resource limit.`,
    storage_unavailable: t`The Gateway could not save task state. Check its storage and reconnect.`,
    input_expired: t`An attached input has expired. Select and upload the file again before sending.`,
  };
  const canAct = props.connected && props.available && !props.busy;
  const selectedIsCurrent = Boolean(
    selectedAttempt && props.currentAttemptIds.includes(selectedAttempt.id)
  );
  return (
    <View testID="work-task-detail" style={{ gap: LADDER.section }}>
      <View style={{ gap: LADDER.gap }}>
        <WorkTaskSection id={`task:${detail.task.id}`}>
          <View
            ref={headingRef}
            accessible
            accessibilityRole="header"
            accessibilityLabel={detail.task.title}>
            <Text testID="task-detail-heading" variant="heading">
              {detail.task.title}
            </Text>
          </View>
        </WorkTaskSection>
        <Text selectable variant="bodySmall">
          {props.serverLabel} · {detail.task.repo_path}
        </Text>
        <Text selectable variant="bodySmall">
          {detail.task.brief}
        </Text>
        {detail.task.paused ? (
          <Text variant="caption">{t`New delegation paused. Existing assistants may continue.`}</Text>
        ) : null}
        {!props.connected ? (
          <Text
            testID="task-offline"
            variant="caption">{t`Offline. Showing the last loaded task. Instructions are not sent automatically on reconnect.`}</Text>
        ) : null}
        {!props.available ? (
          <Text
            testID="task-capability-unavailable"
            variant="caption">{t`This session cannot manage tasks yet. Update or reconnect its Gateway, then check status.`}</Text>
        ) : null}
        {props.error ? (
          <Text selectable variant="bodySmall" colorKey="danger">
            {props.error}
          </Text>
        ) : null}
        <Button
          testID="task-operation-check"
          variant="ghost"
          disabled={!props.connected || props.busy}
          onPress={props.onCheckStatus}>{t`Check status`}</Button>
      </View>
      {unresolved.length ? (
        <View testID="task-recovery" style={{ gap: LADDER.gap }}>
          <SectionLabel title={t`Needs your attention`} />
          <Text variant="bodySmall">{t`An earlier operation may already have reached the assistant. Check status before taking another action.`}</Text>
          {unresolved.map((operation) => (
            <Text key={operation.id} testID={`task-operation-${operation.id}`} variant="caption">
              {operation.state === 'unconfirmed'
                ? operation.kind === 'interrupt_attempt'
                  ? t`Interruption not confirmed`
                  : operation.kind === 'start_attempt'
                    ? t`Start not confirmed`
                    : t`Operation not confirmed`
                : t`Operation in progress`}{' '}
              · {operation.attempt_id ?? detail.task.title}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ gap: LADDER.gap }}>
        <SectionLabel title={t`Assistants`} />
        {!detail.attempts.length ? (
          <Text variant="bodySmall">{t`No assistant has been started for this task.`}</Text>
        ) : null}
        {detail.attempts.map((attempt) => (
          <WorkTaskSection key={attempt.id} id={`attempt:${attempt.id}`}>
            <PressableScale
              testID={`task-attempt-${attempt.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: attempt.id === selectedAttemptId }}
              onPress={() => props.onSelectAttempt(attempt.id)}
              style={{ minHeight: 48, paddingVertical: LADDER.gap, gap: LADDER.tight }}>
              <Text variant="bodySmall">
                {attempt.id === selectedAttemptId ? '✓ ' : ''}
                {attempt.role === 'lead' ? t`Lead` : t`Worker`} · {attempt.agent_kind}
              </Text>
              <Text variant="caption" colorKey="textMuted">
                {props.currentAttemptIds.includes(attempt.id)
                  ? t`Current assistant`
                  : t`Earlier or unavailable assistant · read only`}
              </Text>
            </PressableScale>
          </WorkTaskSection>
        ))}
        {selectedAttempt ? (
          <View style={{ gap: LADDER.gap }}>
            <Text selectable variant="caption" colorKey="textMuted">
              {t`Attempt ID`}: {selectedAttempt.id}
            </Text>
            {selectedAttempt.instance_id ? (
              <Text selectable variant="caption" colorKey="textMuted">
                {t`Assistant instance`}: {selectedAttempt.instance_id}
              </Text>
            ) : null}
            <Button
              testID="task-attempt-terminal"
              variant="ghost"
              disabled={!canAct || !selectedIsCurrent}
              onPress={() => props.onOpenTerminal(selectedAttempt.id)}>{t`Open terminal`}</Button>
          </View>
        ) : null}
        {props.lifecycle}
      </View>
      <View style={{ gap: LADDER.gap }}>
        <SectionLabel title={t`Results`} />
        {selectedResultId && !selectedResult ? (
          <Text variant="bodySmall">{t`This result version is unavailable or changed. Refresh the task and review its submission details.`}</Text>
        ) : null}
        {!detail.results.length ? (
          <Text
            testID="task-no-result"
            variant="bodySmall">{t`No result submitted yet. An idle assistant does not mean the task is complete.`}</Text>
        ) : null}
        {detail.results.map((result) => (
          <WorkTaskSection key={result.id} id={`result:${result.id}`}>
            <PressableScale
              testID={`task-result-${result.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${t`Submission`}: ${result.id}`}
              accessibilityState={{ selected: result.id === selectedResultId }}
              onPress={() => props.onSelectResult(result.id)}
              style={{ minHeight: 48, paddingVertical: LADDER.gap }}>
              <Text variant="bodySmall">
                {result.id === selectedResultId ? '✓ ' : ''}
                {t`Submission`} {result.id.slice(0, 13)}
              </Text>
              <Text variant="caption" numberOfLines={2}>
                {result.summary}
              </Text>
            </PressableScale>
          </WorkTaskSection>
        ))}
        {selectedResult ? (
          <View testID="task-selected-result" style={{ gap: LADDER.gap }}>
            <Text selectable variant="caption" testID="task-selected-submission-id">
              {t`Submission`}: {selectedResult.id}
            </Text>
            <Text selectable variant="bodySmall">
              {selectedResult.summary}
            </Text>
            <Text selectable variant="caption" colorKey="textMuted">
              {t`Submitted by`}: {selectedResult.attempt_id}
            </Text>
            <Text
              variant="caption"
              colorKey="textMuted">{t`Verification reported by the assistant`}</Text>
            {selectedResult.evidence.length ? (
              selectedResult.evidence.map((item, index) => (
                <Text selectable key={`${selectedResult.id}-evidence-${index}`} variant="bodySmall">
                  {item}
                </Text>
              ))
            ) : (
              <Text variant="bodySmall">{t`No verification evidence supplied.`}</Text>
            )}
            {selectedResult.artifacts.map((artifact, index) => (
              <View key={artifact.path} style={{ gap: LADDER.tight }}>
                <Text selectable variant="bodySmall">
                  {artifact.path}
                </Text>
                <Text selectable variant="caption" colorKey="textMuted">
                  {t`SHA-256 checksum`}: {artifact.sha256}
                </Text>
                {props.onPreviewArtifact ? (
                  <Button
                    testID={`task-artifact-preview-${index}`}
                    variant="ghost"
                    disabled={!props.connected || props.busy}
                    onPress={() =>
                      props.onPreviewArtifact?.(selectedResult.id, index)
                    }>{t`Preview`}</Button>
                ) : null}
              </View>
            ))}
            {latestReview ? (
              <Text testID="task-result-review" variant="bodySmall">
                {latestReview.decision === 'accepted'
                  ? t`This submission was accepted.`
                  : t`Changes were requested for this submission.`}
              </Text>
            ) : (
              <Text variant="bodySmall">{t`This submission is awaiting review.`}</Text>
            )}
            {latestReview?.message ? (
              <Text selectable variant="bodySmall">
                {latestReview.message}
              </Text>
            ) : null}
            <Text
              variant="caption"
              colorKey="textMuted">{t`Accepting records a review of this submission. It does not merge, publish, or stop assistants.`}</Text>
            {props.reviewNote}
            <Button
              testID="task-result-accept"
              disabled={!canAct || latestReview?.decision === 'accepted'}
              onPress={() =>
                props.onAcceptResult(selectedResult.id, detail.task.revision)
              }>{t`Accept this result`}</Button>
            <Button
              testID="task-result-request-changes"
              variant="ghost"
              disabled={!canAct}
              onPress={() =>
                props.onRequestChanges(selectedResult.id, detail.task.revision)
              }>{t`Request changes`}</Button>
          </View>
        ) : null}
      </View>
      <View style={{ gap: LADDER.gap }}>
        <SectionLabel title={t`Operations`} />
        {detail.operations.map((operation) => (
          <WorkTaskSection key={operation.id} id={`operation:${operation.id}`}>
            <View style={{ gap: LADDER.tight }}>
              <Text variant="caption">
                {operationKinds[operation.kind]} · {operationStates[operation.state]}
              </Text>
              {operation.failure_code ? (
                <Text selectable variant="caption" colorKey="danger">
                  {failures[operation.failure_code]}
                </Text>
              ) : null}
              {operation.resources.pane_id ? (
                <Text selectable variant="caption">
                  {t`Terminal`}: {operation.resources.pane_id}
                </Text>
              ) : null}
              {operation.resources.worktree_path ? (
                <Text selectable variant="caption">
                  {operation.resources.worktree_path}
                </Text>
              ) : null}
            </View>
          </WorkTaskSection>
        ))}
      </View>
      {props.composer}
    </View>
  );
}
