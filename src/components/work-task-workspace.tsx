import { WorkDelegationControls } from '@/components/work-delegation-controls';
import { WorkDependencyControls } from '@/components/work-dependency-controls';
import { parseWorkDelegationState } from '@/lib/work-delegation';
import { useEffect, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { BackHandler, Keyboard, View } from 'react-native';
import { Text } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { WorkTaskLayout } from '@/components/work-task-layout';
import { WorkTaskSection, type WorkScrollBinding } from '@/components/work-task-scroll';
import { Button } from '@/components/themed-button';
import { Input } from '@/components/themed-input';
import { TaskAttachmentComposer } from '@/components/task-attachment-composer';
import { TaskInputDetails } from '@/components/task-input-details';
import { ProjectDirectoryPicker } from '@/components/project-directory-picker';
import { useTaskInputAttachments } from '@/hooks/use-task-input-attachments';
import { loadBoundRecentCwds } from '@/lib/gateway-client';
import type { WorkInputPreparation } from '@/lib/work-controller';
import { WorkTaskList } from '@/components/work-task-list';
import { WorkTaskDetail } from '@/components/work-task-detail';
import { LADDER } from '@/components/settings-chrome';
import { useWorkController } from '@/hooks/use-work-controller';
import { useWorkOutput } from '@/hooks/use-work-output';
import { useWorkArtifactPreview } from '@/hooks/use-work-artifact-preview';
import { ImagePreviewModal } from '@/components/image-preview-modal';
import { AgentAssignmentBar } from '@/components/agent-assignment-bar';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { workExecutionRecordsComplete } from '@/lib/work-pagination';
import { canReplaceWorkAttempt, workAttemptReleased } from '@/lib/work-lifecycle';

export function WorkTaskWorkspace({
  record,
  sessionId,
  initialCwd,
  onClose,
}: {
  record: GatewayRecord;
  sessionId: string;
  initialCwd?: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const router = useRouter();
  const { controller, state } = useWorkController(record, sessionId);
  const creating = state.view === 'create';
  const { title, project, goal, agents, maxWorkers } = state.creationDraft;
  const setTitle = (title: string) => controller.updateCreationDraft({ title });
  const setProject = (project: string) => controller.updateCreationDraft({ project });
  const setGoal = (goal: string) => controller.updateCreationDraft({ goal });
  const setAgents = (agents: string) => controller.updateCreationDraft({ agents });
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const reviewKey = `${state.detail?.task.id ?? ''}:${state.selectedResultId ?? ''}`;
  const reviewMessage = reviewNotes[reviewKey] ?? '';
  const setReviewMessage = (text: string) =>
    setReviewNotes((notes) => ({ ...notes, [reviewKey]: text }));
  useEffect(() => {
    if (initialCwd && !controller.getSnapshot().creationDraft.project)
      controller.updateCreationDraft({ project: initialCwd });
  }, [controller, initialCwd]);
  const locked = !state.hydrated || state.busy || Boolean(state.pending);
  useEffect(() => {
    if (creating) void controller.refreshProfiles();
  }, [controller, creating]);
  const detail = state.detail;
  const executionHistoryComplete = !detail || workExecutionRecordsComplete(detail);
  const recipient = detail?.attempts.find((attempt) => attempt.id === state.recipientId);
  const selectedAttempt = detail?.attempts.find(
    (attempt) => attempt.id === state.selectedAttemptId
  );
  const [recentDirectories, setRecentDirectories] = useState<string[]>([]);
  const [inputSelection, setInputSelection] = useState<{ creation: boolean; id: string } | null>(
    null
  );
  const creationAttachments = useTaskInputAttachments(
    record,
    state.capabilities.inputs && creating && project.trim().startsWith('/')
      ? { sessionId, project: project.trim(), draftId: 'new-task' }
      : null
  );
  const instructionAttachments = useTaskInputAttachments(
    record,
    state.capabilities.inputs && detail && recipient
      ? {
          sessionId,
          project: detail.task.repo_path,
          draftId: `instruction:${detail.task.id}:${recipient.id}`,
          taskId: detail.task.id,
          attemptId: recipient.id,
        }
      : null
  );
  function prepareInputs(
    attachments: typeof creationAttachments
  ): WorkInputPreparation | undefined {
    if (!state.capabilities.inputs) return undefined;
    const ticket = attachments.captureCommit();
    return async (context) => {
      const prepared = await ticket.settle();
      return {
        inputRefs: prepared.inputRefs,
        isCurrent: () => context.isCurrent() && prepared.isCurrent(),
        onAcknowledged: () => attachments.clearSubmitted(prepared.snapshots),
      };
    };
  }
  useEffect(() => {
    if (!creating) return;
    const abort = new AbortController();
    setRecentDirectories([]);
    void loadBoundRecentCwds(record, sessionId, {
      signal: abort.signal,
      isCurrent: () => !abort.signal.aborted,
    })
      .then((paths) => {
        if (!abort.signal.aborted) setRecentDirectories(paths);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [record, sessionId, creating]);
  const lifecycleObservation =
    state.lifecycleObservation?.attempt_id === selectedAttempt?.id
      ? state.lifecycleObservation
      : null;
  const interruption = state.interruption;
  const selectedInterruption =
    interruption.operation?.attempt_id === selectedAttempt?.id &&
    interruption.operation?.task_id === detail?.task.id
      ? interruption.operation
      : null;
  const selectedInterruptPending =
    interruption.pending?.attemptId === selectedAttempt?.id &&
    interruption.pending?.taskId === detail?.task.id;
  const interruptionErrors = {
    unavailable: t`Update this Gateway and backend to interrupt the exact assistant safely.`,
    offline: t`Reconnect to check or interrupt this assistant.`,
    identity_changed: t`Assistant changed`,
    conflict: t`The task changed. Check status before requesting interruption.`,
    unconfirmed: t`Interruption not confirmed`,
    journal_unavailable: t`Could not save interruption recovery information. Nothing was sent.`,
    failed: t`The interruption request was refused. Check the assistant before trying again.`,
  };
  const output = useWorkOutput(
    record,
    sessionId,
    selectedAttempt,
    state.view === 'detail' && state.capabilities.execution,
    controller.viewMemory
  );
  const artifact = useWorkArtifactPreview(record, sessionId, detail, state.selectedResultId);
  async function openTerminal() {
    const paneId = await output.verifiedPane();
    if (paneId)
      router.push({
        pathname: '/servers/[serverId]',
        params: { serverId: record.serverId, sessionId, paneId },
      } as Href);
  }
  async function createTask() {
    const preparation = prepareInputs(creationAttachments);
    const input = {
      repo_path: project.trim(),
      title: title.trim(),
      brief: goal,
      parent_task_id: null,
      policy: {
        allowed_agents: [agents],
        max_workers: Number(maxWorkers),
      },
    };
    const saved = state.capabilities.execution
      ? await controller.startGoal(input, preparation)
      : await controller.create(input, preparation);
    if (saved) {
      if (controller.getSnapshot().creationDraft.title === title) setTitle('');
      if (controller.getSnapshot().creationDraft.goal === goal) setGoal('');
    }
  }
  const errors = {
    unavailable: t`This session cannot manage tasks yet. Update or reconnect its Gateway, then refresh.`,
    execution_unavailable: t`This session cannot safely start or message managed assistants yet. Update its Gateway and backend, then check status. Ordinary terminal collaboration remains available.`,
    offline: t`Offline. Your draft has not been sent.`,
    conflict: t`The task changed. Refresh and review the latest state.`,
    unconfirmed: t`An earlier operation may already have reached the assistant. Check status before taking another action.`,
    invalid: t`Check the task details before continuing.`,
    failed: t`Could not update this task. Check status before continuing.`,
    journal_unavailable: t`Could not safely save the operation on this device. No further action will be sent. Check device storage and try checking status again.`,
    lifecycle_unavailable: t`This session cannot safely check assistant lifecycle yet. Update its Gateway and backend, then check status.`,
    catalog_unavailable: t`The selected assistant is unavailable. Refresh assistants and choose an installed assistant. Your draft is preserved.`,
    inputs_unavailable: t`This session cannot accept task attachments. Update its Gateway and refresh. Your draft is preserved.`,
    input_expired: t`An attachment expired. Explicitly upload it again before sending.`,
  };

  function scrollBinding(region: 'list' | 'detail', taskId?: string): WorkScrollBinding {
    return {
      read: () => {
        const anchor = controller.getViewAnchor(region, taskId);
        return anchor
          ? { id: anchor.itemId ?? '', offset: anchor.relativeOffset, raw: anchor.rawOffset }
          : null;
      },
      save: (anchor) =>
        controller.saveViewAnchor(
          region,
          {
            itemId: anchor.id || null,
            relativeOffset: anchor.offset,
            rawOffset: anchor.raw,
            ...(anchor.id.startsWith('output:') && output.snapshotId
              ? { snapshotId: output.snapshotId }
              : {}),
          },
          taskId
        ),
    };
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      if (inputSelection) {
        setInputSelection(null);
        return true;
      }
      if (state.view !== 'list') {
        controller.showList();
        return true;
      }
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [controller, inputSelection, onClose, state.view]);
  return (
    <WorkTaskLayout
      title={
        creating ? t`New task` : state.view === 'detail' && detail ? detail.task.title : t`Tasks`
      }
      caption={`${record.label} · ${sessionId}`}
      closeLabel={t`Close`}
      onClose={onClose}
      view={state.view}
      detailKey={`${detail?.task.id ?? ''}:${output.snapshotId ?? ''}`}
      listBinding={scrollBinding('list')}
      detailBinding={scrollBinding('detail', detail?.task.id)}
      notice={
        state.error &&
        !(!creating && ['unavailable', 'offline'].includes(state.error)) &&
        !(detail && state.error === 'execution_unavailable') ? (
          <>
            <Text
              testID="task-action-error"
              accessibilityLiveRegion="polite"
              variant="bodySmall"
              colorKey="danger">
              {errors[state.error]}
            </Text>
            <Button
              testID="task-action-recovery"
              variant="ghost"
              disabled={state.busy || state.loading || !state.capabilities.connected}
              onPress={() =>
                void (state.error === 'catalog_unavailable'
                  ? controller.refreshProfiles()
                  : controller.refresh())
              }>
              {state.error === 'catalog_unavailable' ? t`Refresh assistants` : t`Check status`}
            </Button>
          </>
        ) : null
      }
      list={
        <>
          <WorkTaskList
            focusTaskId={state.view === 'list' ? detail?.task.id : null}
            tasks={state.tasks}
            selectedTaskId={state.view === 'detail' ? (detail?.task.id ?? null) : null}
            connected={state.capabilities.connected}
            available={state.capabilities.records}
            loading={state.loading || state.busy}
            hasUpdates={state.hasUpdates}
            onSelect={(id) => void controller.selectTask(id)}
            onCreate={() => controller.showCreate()}
            onRefresh={() => void controller.refresh()}
          />
          {state.nextAfterId ? (
            <Button
              testID="task-load-more"
              variant="ghost"
              disabled={state.loading || state.busy}
              onPress={() => void controller.loadMore()}>{t`Load more`}</Button>
          ) : null}
        </>
      }
      creation={
        <View testID="task-create-form" style={{ gap: LADDER.gap }}>
          {creating ? (
            <>
              <TaskInputDetails
                key={`${inputSelection?.creation}:${inputSelection?.id}`}
                attachments={
                  inputSelection?.creation ? creationAttachments : instructionAttachments
                }
                attachmentId={inputSelection?.id ?? null}
                onClose={() => setInputSelection(null)}
                disabled={locked}
              />
              {state.pending ? (
                <View testID="task-pending-operation" style={{ gap: LADDER.gap }}>
                  <Text variant="bodySmall">
                    {state.pending.state === 'unconfirmed'
                      ? t`Operation not confirmed`
                      : state.pending.state === 'acknowledged'
                        ? t`Task saved. Open the existing task before continuing.`
                        : t`Operation in progress`}
                  </Text>
                  <Text variant="caption">{t`Check status before taking another action. Reopening this screen does not resend the request.`}</Text>
                  <Button
                    variant="ghost"
                    disabled={state.busy || state.loading}
                    onPress={() => void controller.refresh()}>{t`Check status`}</Button>
                </View>
              ) : null}
            </>
          ) : null}
          <Button
            variant="ghost"
            disabled={state.busy}
            onPress={() => controller.showList()}>{t`Back`}</Button>
          <Input
            testID="task-title"
            label={t`Title`}
            value={title}
            onChangeText={setTitle}
            editable={!locked}
            maxLength={240}
          />
          <ProjectDirectoryPicker
            testID="task-project"
            recentDirectories={recentDirectories}
            label={t`Project directory`}
            value={project}
            onChange={setProject}
            editable={!locked}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {creationAttachments.projectResolution ? (
            <View style={{ gap: LADDER.gap }}>
              <Text variant="bodySmall">{t`The Gateway resolved a different project directory. Confirm it and select the attachments again.`}</Text>
              <Text selectable>{creationAttachments.projectResolution.canonicalProject}</Text>
              <Button
                disabled={locked}
                onPress={() =>
                  setProject(creationAttachments.projectResolution!.canonicalProject)
                }>{t`Use resolved project`}</Button>
            </View>
          ) : null}
          <AgentAssignmentBar
            candidates={[]}
            kinds={state.profiles}
            target={agents ? { type: 'new', kind: agents } : null}
            onChoose={(target) => {
              if (target.type === 'new') setAgents(target.kind);
            }}
            onClose={() => {
              if (!locked) setAgents('');
            }}
            disabled={locked}
          />
          <Text>
            {t`Assistant`}: {agents || t`Choose an assistant`}
          </Text>
          <Button
            disabled={locked}
            onPress={() => void controller.refreshProfiles()}>{t`Refresh assistants`}</Button>
          <Input
            testID="task-worker-limit"
            label={t`Additional assistants`}
            helper={t`Zero keeps this task with one assistant. The limit does not grant approvals or broader permissions.`}
            value={maxWorkers}
            onChangeText={(maxWorkers) => controller.updateCreationDraft({ maxWorkers })}
            keyboardType="number-pad"
            editable={!locked}
            maxLength={2}
          />
        </View>
      }
      composer={
        detail ? (
          <View style={{ gap: LADDER.gap }}>
            {recipient ? (
              <>
                <Text testID="task-recipient" variant="bodySmall">
                  {t`To`}: {recipient.role === 'lead' ? t`Lead` : t`Worker`} ·{' '}
                  {recipient.agent_kind}
                </Text>
                {state.selectedAttemptId && state.selectedAttemptId !== state.recipientId ? (
                  <Button
                    testID="task-message-worker"
                    variant="ghost"
                    disabled={
                      locked || Boolean(selectedAttempt && workAttemptReleased(selectedAttempt))
                    }
                    onPress={() => {
                      if (state.selectedAttemptId)
                        controller.addressAttempt(state.selectedAttemptId);
                    }}>{t`Message this assistant`}</Button>
                ) : null}
                <TaskAttachmentComposer
                  attachments={instructionAttachments}
                  available={Boolean(state.capabilities.inputs)}
                  onPreview={(id) => setInputSelection({ creation: false, id })}
                  inputProps={{
                    testID: 'task-instruction',
                    scrollEnabled: true,
                    style: { maxHeight: 120 },
                    value: state.draft,
                    onChangeText: (text) => controller.setDraft(text),
                    placeholder: t`Add instructions…`,
                    editable: !state.busy,
                  }}
                  send={{
                    accessibilityLabel: t`Send instruction`,
                    armed: Boolean(state.draft.trim()),
                    sending: state.busy,
                    disabled:
                      locked ||
                      !executionHistoryComplete ||
                      !state.capabilities.execution ||
                      state.requiresRefresh ||
                      !recipient.instance_id ||
                      workAttemptReleased(recipient) ||
                      !state.draft.trim(),
                    onPress: () => void controller.deliver(prepareInputs(instructionAttachments)),
                  }}
                />
              </>
            ) : (
              <View style={{ gap: LADDER.gap }}>
                <Text variant="bodySmall">
                  {t`Assistant`}: {detail.task.policy.allowed_agents[0]}
                </Text>
                <Button
                  testID="task-start-assistant"
                  disabled={
                    locked ||
                    detail.attempts.some((attempt) => attempt.role === 'lead') ||
                    !executionHistoryComplete ||
                    !state.capabilities.execution ||
                    detail.task.paused ||
                    state.requiresRefresh
                  }
                  onPress={() =>
                    void controller.start(detail.task.policy.allowed_agents[0])
                  }>{t`Start assistant`}</Button>
              </View>
            )}
          </View>
        ) : null
      }
      creationComposer={
        <TaskAttachmentComposer
          attachments={creationAttachments}
          available={Boolean(state.capabilities.inputs)}
          onPreview={(id) => setInputSelection({ creation: true, id })}
          inputProps={{
            testID: 'task-goal',
            scrollEnabled: true,
            style: { maxHeight: 120 },
            value: goal,
            onChangeText: setGoal,
            placeholder: t`What would you like done?`,
            editable: !locked,
          }}
          send={{
            accessibilityLabel: state.capabilities.execution ? t`Start task` : t`Create task`,
            armed: Boolean(goal.trim()),
            sending: state.busy,
            disabled:
              locked ||
              !state.capabilities.records ||
              !goal.trim() ||
              !title.trim() ||
              !project.startsWith('/') ||
              !/^(?:[0-9]|1[0-6])$/.test(maxWorkers) ||
              !state.profiles.some((profile) => profile.kind === agents),
            onPress: () => void createTask(),
          }}
        />
      }>
      <View style={{ gap: LADDER.section }}>
        {!creating ? (
          <>
            <TaskInputDetails
              key={`${inputSelection?.creation}:${inputSelection?.id}`}
              attachments={inputSelection?.creation ? creationAttachments : instructionAttachments}
              attachmentId={inputSelection?.id ?? null}
              onClose={() => setInputSelection(null)}
              disabled={locked}
            />
            {state.pending ? (
              <View testID="task-pending-operation" style={{ gap: LADDER.gap }}>
                <Text variant="bodySmall">
                  {state.pending.state === 'unconfirmed'
                    ? t`Operation not confirmed`
                    : state.pending.state === 'acknowledged'
                      ? t`Task saved. Open the existing task before continuing.`
                      : t`Operation in progress`}
                </Text>
                <Text variant="caption">{t`Check status before taking another action. Reopening this screen does not resend the request.`}</Text>
                <Button
                  variant="ghost"
                  disabled={state.busy || state.loading}
                  onPress={() => void controller.refresh()}>{t`Check status`}</Button>
              </View>
            ) : null}
          </>
        ) : null}
        {state.loading && detail ? (
          <Text accessibilityLiveRegion="polite" variant="caption">{t`Loading…`}</Text>
        ) : null}
        {detail ? (
          <>
            {detail.task.input_refs?.length ? (
              <View style={{ gap: LADDER.gap }}>
                <Text variant="bodySmall">{t`Task reference files`}</Text>
                {detail.task.input_refs.map((input) => (
                  <View key={input.input_id}>
                    <Text selectable>{input.name}</Text>
                    <Text variant="caption">
                      {input.use === 'may-include' ? t`May include in output` : t`Reference only`}
                    </Text>
                    {input.caption ? (
                      <Text selectable variant="bodySmall">
                        {input.caption}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
            <Button
              testID="task-back-list"
              variant="ghost"
              disabled={state.busy}
              onPress={() => controller.showList()}>{t`Tasks`}</Button>
            {state.hasUpdates ? (
              <Button
                testID="task-refresh-updates"
                variant="ghost"
                disabled={state.loading || state.busy}
                onPress={() => void controller.refresh()}>{t`Updates available · refresh`}</Button>
            ) : null}
            {!executionHistoryComplete ? (
              <Text variant="bodySmall">{t`Load remaining history before starting or messaging an assistant.`}</Text>
            ) : null}
            {(['attempt', 'operation', 'result', 'review'] as const).map((kind) => {
              const field = {
                attempt: 'attempts',
                operation: 'operations',
                result: 'results',
                review: 'reviews',
              } as const;
              const labels = {
                attempt: t`Load more assistants`,
                operation: t`Load more operations`,
                result: t`Load more results`,
                review: t`Load more reviews`,
              };
              return detail.pages?.[field[kind]].has_more ? (
                <Button
                  key={kind}
                  disabled={state.loading || state.busy}
                  variant="ghost"
                  onPress={() => void controller.loadRecords(kind)}>
                  {labels[kind]}
                </Button>
              ) : null;
            })}
            <WorkTaskDetail
              focusHeading={state.view === 'detail'}
              detail={detail}
              serverLabel={record.label}
              connected={state.capabilities.connected}
              available={state.capabilities.records}
              busy={locked || state.loading}
              selectedAttemptId={state.selectedAttemptId}
              selectedResultId={state.selectedResultId}
              currentAttemptIds={
                output.current && selectedAttempt && !workAttemptReleased(selectedAttempt)
                  ? [selectedAttempt.id]
                  : []
              }
              lifecycle={
                selectedAttempt ? (
                  <View style={{ gap: LADDER.gap }}>
                    <View testID="task-interruption-controls" style={{ gap: LADDER.gap }}>
                      <Text testID="task-interruption-target" variant="caption">
                        {record.label} · {selectedAttempt.role === 'lead' ? t`Lead` : t`Worker`} ·{' '}
                        {selectedAttempt.agent_kind}
                      </Text>
                      <Text selectable variant="caption">
                        {selectedAttempt.id}
                      </Text>
                      <Text
                        testID="task-interruption-status"
                        variant="bodySmall"
                        style={{ minHeight: 48 }}>
                        {selectedInterruptPending || selectedInterruption?.state === 'unconfirmed'
                          ? t`Interruption not confirmed`
                          : selectedInterruption?.state === 'acknowledged'
                            ? t`Interrupt requested`
                            : t`No interruption requested`}
                      </Text>
                      <Text variant="caption">{t`Interruption requests do not prove the assistant stopped or the task finished. Check its output and lifecycle separately.`}</Text>
                      {!state.capabilities.interruption ? (
                        <Text variant="caption">{interruptionErrors.unavailable}</Text>
                      ) : null}
                      {interruption.error ? (
                        <Text variant="caption" colorKey="danger">
                          {interruptionErrors[interruption.error]}
                        </Text>
                      ) : null}
                      <Button
                        testID="task-interrupt-assistant"
                        variant="ghost"
                        disabled={
                          !state.hydrated ||
                          !state.capabilities.connected ||
                          !state.capabilities.interruption ||
                          interruption.busy ||
                          Boolean(interruption.pending) ||
                          !selectedAttempt.instance_id ||
                          !selectedAttempt.lifecycle?.native_owner_epoch ||
                          workAttemptReleased(selectedAttempt)
                        }
                        onPress={() =>
                          void controller.interruptAttempt(selectedAttempt.id)
                        }>{t`Interrupt assistant`}</Button>
                      {interruption.pending ? (
                        <>
                          <Text selectable variant="caption">
                            {interruption.pending.attemptId}
                          </Text>
                          <Button
                            testID="task-interruption-check"
                            variant="ghost"
                            disabled={interruption.busy || !state.capabilities.connected}
                            onPress={() =>
                              void controller.checkInterruptionStatus()
                            }>{t`Check interruption status`}</Button>
                        </>
                      ) : null}
                    </View>
                    <Text variant="caption">{t`This checks whether a replacement can safely start. It does not stop the assistant or delete its resources.`}</Text>
                    {!state.capabilities.reconciliation ? (
                      <Text variant="caption">{errors.lifecycle_unavailable}</Text>
                    ) : null}
                    <Text testID="task-lifecycle-observation" variant="bodySmall">
                      {workAttemptReleased(selectedAttempt)
                        ? t`Replacement reservation released`
                        : lifecycleObservation?.observation === 'live'
                          ? t`Assistant still running`
                          : lifecycleObservation?.observation === 'unknown'
                            ? t`Could not verify assistant exit`
                            : t`Replacement remains blocked until lifecycle is verified`}
                    </Text>
                    {selectedAttempt.lifecycle?.release ? (
                      <Text variant="caption">
                        {selectedAttempt.lifecycle.release.reason === 'owned_process_exited'
                          ? t`The native owner recorded this assistant's process exit. This does not prove task completion.`
                          : selectedAttempt.lifecycle.release.reason === 'startup_not_dispatched'
                            ? t`Gateway evidence confirms startup was never dispatched.`
                            : t`The native owner confirmed that startup created no assistant process.`}
                      </Text>
                    ) : null}
                    <Button
                      testID="task-lifecycle-check"
                      variant="ghost"
                      disabled={locked || state.loading || !state.capabilities.reconciliation}
                      onPress={() =>
                        void controller.checkLifecycle(selectedAttempt.id)
                      }>{t`Check assistant lifecycle`}</Button>
                    <Text variant="caption">
                      {t`Assistant`}: {selectedAttempt.agent_kind}
                    </Text>
                    <Button
                      testID="task-start-replacement"
                      disabled={
                        locked ||
                        state.loading ||
                        state.requiresRefresh ||
                        !state.capabilities.execution ||
                        !state.capabilities.reconciliation ||
                        !canReplaceWorkAttempt(detail, selectedAttempt.id)
                      }
                      onPress={() =>
                        void controller.startReplacement(
                          selectedAttempt.id,
                          selectedAttempt.agent_kind
                        )
                      }>{t`Start replacement`}</Button>
                    <Text variant="caption">{t`A replacement starts separately. Previous instructions are not sent again; address any new instruction explicitly.`}</Text>
                  </View>
                ) : null
              }
              onSelectAttempt={(id) => controller.selectAttempt(id)}
              onSelectResult={(id) => controller.selectResult(id)}
              onCheckStatus={() => void controller.refresh()}
              onOpenTerminal={() => void openTerminal()}
              onPreviewArtifact={(id, index) => void artifact.open(id, index)}
              reviewNote={
                <View style={{ gap: LADDER.gap }}>
                  <Input
                    testID="task-review-message"
                    label={t`Review note`}
                    value={reviewMessage}
                    onChangeText={setReviewMessage}
                    multiline
                    editable={!locked}
                  />
                  {detail.reviews
                    .filter(
                      (review) =>
                        review.submission_id === state.selectedResultId &&
                        review.decision === 'changes_requested'
                    )
                    .slice(-1)
                    .map((review) => (
                      <Button
                        key={review.id}
                        testID="task-prepare-review-followup"
                        disabled={
                          locked ||
                          Boolean(state.draft.trim()) ||
                          instructionAttachments.attachments.length > 0 ||
                          !executionHistoryComplete ||
                          !detail.attempts.some(
                            (attempt) => attempt.role === 'lead' && !workAttemptReleased(attempt)
                          )
                        }
                        onPress={() =>
                          controller.prepareReviewFollowup(review.id)
                        }>{t`Prepare follow-up for lead assistant`}</Button>
                    ))}
                  <Text variant="caption">{t`Requested changes are saved as a review. Preparing a follow-up keeps it as a draft until you explicitly send it.`}</Text>
                </View>
              }
              onAcceptResult={(id, revision) =>
                void controller.review(id, revision, 'accepted', reviewMessage.trim() || null)
              }
              onRequestChanges={(id, revision) => {
                const originalDraft = state.draft;
                const hadAttachments = instructionAttachments.captureEntries().length > 0;
                void controller
                  .review(id, revision, 'changes_requested', reviewMessage.trim() || null)
                  .then((review) => {
                    if (
                      review &&
                      !hadAttachments &&
                      instructionAttachments.captureEntries().length === 0 &&
                      !originalDraft.trim() &&
                      controller.getSnapshot().draft === originalDraft
                    )
                      controller.prepareReviewFollowup(review.id);
                  });
              }}
              composer={
                <View style={{ gap: LADDER.gap }}>
                  {selectedAttempt ? (
                    <WorkTaskSection id={`output:${selectedAttempt.id}`}>
                      <View style={{ gap: LADDER.gap }}>
                        <Button
                          testID="task-output-refresh"
                          variant="ghost"
                          disabled={!state.capabilities.execution || output.loading}
                          onPress={output.refresh}>
                          {output.snapshot?.hasNewOutput
                            ? t`New output available`
                            : t`Refresh output`}
                        </Button>
                        {output.snapshot ? (
                          <Text testID="task-output-snapshot" selectable variant="bodySmall">
                            {output.snapshot.text}
                          </Text>
                        ) : null}
                        {!output.current ? (
                          <Text variant="caption">{t`Earlier or unavailable assistant · read only`}</Text>
                        ) : null}
                      </View>
                    </WorkTaskSection>
                  ) : null}
                  {artifact.loading ? <Text variant="caption">{t`Loading…`}</Text> : null}
                  {artifact.failed ? (
                    <Text
                      variant="bodySmall"
                      colorKey="danger">{t`This result version is unavailable or changed. Refresh the task and review its submission details.`}</Text>
                  ) : null}
                  {artifact.preview?.kind === 'unsupported' ? (
                    <Text variant="caption">{t`This file cannot be previewed safely in the app.`}</Text>
                  ) : null}
                  {artifact.preview?.kind === 'text' ? (
                    <View style={{ gap: LADDER.gap }}>
                      <Text testID="task-artifact-text" selectable variant="bodySmall">
                        {artifact.preview.text}
                      </Text>
                      <Button variant="ghost" onPress={artifact.close}>{t`Close preview`}</Button>
                    </View>
                  ) : null}
                  {artifact.preview?.kind === 'image' ? (
                    <ImagePreviewModal
                      images={[
                        {
                          id: artifact.preview.cacheKey,
                          uri: artifact.preview.uri,
                          cacheKey: artifact.preview.cacheKey,
                        },
                      ]}
                      initialIndex={0}
                      onClose={artifact.close}
                    />
                  ) : null}
                  {!state.capabilities.execution ? (
                    <Text testID="task-execution-unavailable" variant="bodySmall">
                      {errors.execution_unavailable}
                    </Text>
                  ) : null}
                  <Text variant="caption">{t`Pausing applies to new assistants started through Muqun. Existing assistants and independent shell commands may continue.`}</Text>
                  <Button
                    testID="task-delegation-pause"
                    variant="ghost"
                    disabled={locked || !state.capabilities.records}
                    onPress={() => void controller.setPaused(!detail.task.paused)}>
                    {detail.task.paused ? t`Resume delegation` : t`Pause delegation`}
                  </Button>
                </View>
              }
            />
            <WorkDelegationControls
              key={`delegation:${record.serverId}:${sessionId}:${detail.task.id}`}
              serverId={record.serverId}
              serverLabel={record.label}
              task={detail.task}
              attempts={detail.attempts}
              committed={parseWorkDelegationState(detail.task.delegation)}
              availability={{
                connected: state.capabilities.connected,
                capable: Boolean(state.capabilities.delegation),
                pending: locked || Boolean(state.interruption.pending) || state.interruption.busy,
                historyComplete: executionHistoryComplete,
              }}
              onConfigure={(intent) => controller.configureDelegation(intent)}
            />
            {state.tasks.filter((task) => task.parent_task_id === detail.task.id).length ? (
              <View testID="task-direct-children" style={{ gap: LADDER.gap }}>
                <Text>{t`Direct child tasks`}</Text>
                <Text variant="caption">{t`Each child task has its own lead assistant. Opening it does not start work or change the parent coordinator.`}</Text>
                {state.tasks
                  .filter((task) => task.parent_task_id === detail.task.id)
                  .map((task) => (
                    <Button
                      key={task.id}
                      testID={`task-open-child-${task.id}`}
                      variant="ghost"
                      disabled={locked}
                      onPress={() => void controller.selectTask(task.id)}>
                      {task.title}
                    </Button>
                  ))}
              </View>
            ) : null}
            {state.nextAfterId ? (
              <Button
                testID="task-related-load-more"
                variant="ghost"
                disabled={locked || state.loading}
                onPress={() => void controller.loadMore()}>{t`Load more related tasks`}</Button>
            ) : null}
            <WorkDependencyControls
              key={`dependencies:${record.serverId}:${sessionId}:${detail.task.id}`}
              serverId={record.serverId}
              task={detail.task}
              tasks={state.tasks}
              connected={state.capabilities.connected}
              capable={Boolean(state.capabilities.delegation)}
              pending={locked || Boolean(state.interruption.pending) || state.interruption.busy}
              onInspect={(id) => controller.inspectRelatedTask(id)}
              onMoreResults={(id, revision, afterId) =>
                controller.inspectRelatedResults(id, revision, afterId)
              }
              onSave={(intent) => controller.setDependencies(intent)}
            />
          </>
        ) : null}
      </View>
    </WorkTaskLayout>
  );
}
