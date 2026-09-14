import { DeliveryOwnership, assertDeliveryCurrent } from './bound-delivery';
import { WorkViewMemory, type WorkViewAnchor } from './work-view-memory';
import type { AgentProfile } from './agent-spawn';
import { mergeWorkPage, workExecutionRecordsComplete } from './work-pagination';
import {
  canReplaceWorkAttempt,
  workAttemptReleased,
  workOperationBlocksExecution,
} from './work-lifecycle';
import type { PendingWorkIntent, PendingWorkInterruption, WorkJournalPort } from './work-journal';
import type { TaskInputRef } from './task-inputs';
import { workSummaryRow, mergeWorkSummaryRows, type WorkTaskRow } from './work-summaries';
import {
  confirmedDelegationLead,
  parseWorkDelegationState,
  type WorkDelegationIntent,
} from './work-delegation';
import {
  WorkApiError,
  type WorkCreateTask,
  type WorkDetail,
  type WorkOperation,
  type WorkRequestContext,
  type WorkTask,
  type WorkReconciliation,
  type WorkReview,
  type WorkDependencyIntent,
  parseWorkDependencies,
  type createWorkApi,
} from './work-api';

export const WORK_TASKS_CAPABILITY = 'work_tasks_v1';
export const WORK_EXECUTION_CAPABILITY = 'work_execution_v1';
export type WorkCapabilities = {
  connected: boolean;
  records: boolean;
  execution: boolean;
  reconciliation?: boolean;
  inputs?: boolean;
  interruption?: boolean;
  delegation?: boolean;
  summaries?: boolean;
};
const unavailable: WorkCapabilities = { connected: false, records: false, execution: false };

/** Select the actual session, never a capability belonging to a neighbouring backend. */
export function workCapabilities(
  value: unknown,
  serverId: string,
  sessionId: string
): WorkCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable;
  const health = value as Record<string, unknown>;
  if (health.serverId !== serverId || !Array.isArray(health.backends)) return unavailable;
  const matches = health.backends.filter((entry): entry is Record<string, unknown> =>
    Boolean(
      entry && typeof entry === 'object' && !Array.isArray(entry) && entry.sessionId === sessionId
    )
  );
  if (matches.length !== 1) return unavailable;
  const backend = matches[0];
  const connected = true;
  const capabilities = Array.isArray(backend.capabilities) ? backend.capabilities : [];
  const records = capabilities.includes(WORK_TASKS_CAPABILITY);
  return {
    connected,
    records,
    ...(records && capabilities.includes('work_task_summaries_v1') ? { summaries: true } : {}),
    ...(records && capabilities.includes('work_delegation_v1') ? { delegation: true } : {}),
    ...(records && backend.connected === true && capabilities.includes('work_interrupt_v1')
      ? { interruption: true }
      : {}),
    ...(records && capabilities.includes('work_inputs_v1') ? { inputs: true } : {}),
    ...(records && capabilities.includes('work_attempt_reconciliation_v1')
      ? { reconciliation: true }
      : {}),
    execution:
      records && backend.connected === true && capabilities.includes(WORK_EXECUTION_CAPABILITY),
  };
}

type WorkClient = ReturnType<typeof createWorkApi>;
export type WorkPreparedInputs = {
  inputRefs: TaskInputRef[];
  isCurrent: () => boolean;
  onAcknowledged: () => void;
};
export type WorkInputPreparation = (context: WorkRequestContext) => Promise<WorkPreparedInputs>;
export type PendingWorkAction = PendingWorkIntent;
export type WorkControllerSnapshot = {
  view: 'list' | 'detail' | 'create';
  interruption: {
    pending: PendingWorkInterruption | null;
    busy: boolean;
    operation: WorkOperation | null;
    error:
      | null
      | 'unavailable'
      | 'offline'
      | 'identity_changed'
      | 'conflict'
      | 'unconfirmed'
      | 'journal_unavailable'
      | 'failed';
  };
  hydrated: boolean;
  lifecycleObservation: WorkReconciliation | null;
  creationDraft: {
    title: string;
    project: string;
    goal: string;
    agents: string;
    maxWorkers: string;
  };
  profiles: readonly AgentProfile[];
  capabilities: WorkCapabilities;
  tasks: readonly WorkTaskRow[];
  summaryCursor: number | null;
  nextAfterId: string | null;
  detail: WorkDetail | null;
  selectedAttemptId: string | null;
  selectedResultId: string | null;
  recipientId: string | null;
  draft: string;
  busy: boolean;
  loading: boolean;
  hasUpdates: boolean;
  requiresRefresh: boolean;
  error:
    | 'unavailable'
    | 'execution_unavailable'
    | 'offline'
    | 'conflict'
    | 'unconfirmed'
    | 'invalid'
    | 'catalog_unavailable'
    | 'journal_unavailable'
    | 'lifecycle_unavailable'
    | 'inputs_unavailable'
    | 'input_expired'
    | 'failed'
    | null;
  pending: PendingWorkAction | null;
};

/** Owns snapshots and explicit actions, not agent scheduling or a second assignment store. */
export class WorkController {
  private state: WorkControllerSnapshot = {
    view: 'list',
    interruption: { pending: null, busy: false, operation: null, error: null },
    hydrated: false,
    lifecycleObservation: null,
    creationDraft: { title: '', project: '', goal: '', agents: '', maxWorkers: '0' },
    profiles: [],
    capabilities: unavailable,
    tasks: [],
    summaryCursor: null,
    nextAfterId: null,
    detail: null,
    selectedAttemptId: null,
    selectedResultId: null,
    recipientId: null,
    draft: '',
    busy: false,
    loading: false,
    hasUpdates: false,
    requiresRefresh: false,
    error: null,
    pending: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly ownership = new DeliveryOwnership();
  private readSequence = 0;
  private profileSequence = 0;
  private active = false;
  private retired = false;
  private readonly drafts = new Map<string, string>();
  readonly viewMemory = new WorkViewMemory();
  private readonly acknowledgedCreations = new Map<string, string>();
  private hydration: Promise<boolean> | null = null;
  constructor(
    private readonly api: WorkClient,
    private readonly readCapabilities: (context: WorkRequestContext) => Promise<WorkCapabilities>,
    private readonly newKey: () => string,
    private readonly readProfiles: (
      context: WorkRequestContext
    ) => Promise<readonly AgentProfile[]> = async () => [],
    private readonly journal: WorkJournalPort = { load: async () => null, save: async () => {} }
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Partial<WorkControllerSnapshot>) {
    this.state = { ...this.state, ...next };
    this.viewMemory.protect([
      this.state.detail?.task.id,
      this.state.pending?.taskId,
      this.state.interruption.pending?.taskId,
    ]);
    if (this.state.detail) {
      this.drafts.set(this.state.detail.task.id, this.state.draft);
      this.viewMemory.remember({
        detail: this.state.detail,
        selectedAttemptId: this.state.selectedAttemptId,
        selectedResultId: this.state.selectedResultId,
        recipientId: this.state.recipientId,
        requiresRefresh: this.state.requiresRefresh,
        hasUpdates: this.state.hasUpdates,
        lifecycleObservation: this.state.lifecycleObservation,
      });
    }
    for (const listener of this.listeners) listener();
  }
  activate() {
    if (this.retired) return;
    this.active = true;
    void this.hydrate();
  }
  private hydrate(): Promise<boolean> {
    if (this.state.hydrated) return Promise.resolve(true);
    if (this.hydration) return this.hydration;
    this.hydration = Promise.all([
      this.journal.load(),
      this.journal.loadInterruption?.() ?? Promise.resolve(null),
    ])
      .then(([pending, interruption]) => {
        this.publish({
          hydrated: true,
          interruption: {
            ...this.state.interruption,
            pending: interruption
              ? {
                  ...interruption,
                  state: interruption.state === 'acknowledged' ? 'acknowledged' : 'unconfirmed',
                }
              : null,
          },
          pending: pending
            ? {
                ...pending,
                state: pending.state === 'acknowledged' ? 'acknowledged' : 'unconfirmed',
              }
            : null,
        });
        return true;
      })
      .catch(() => {
        this.publish({ error: 'journal_unavailable' });
        return false;
      })
      .finally(() => {
        this.hydration = null;
      });
    return this.hydration;
  }
  private async savePending(pending: PendingWorkAction | null) {
    if (pending) this.publish({ pending });
    try {
      await this.journal.save(pending);
    } catch {
      throw new WorkApiError('refused', 'journal_unavailable');
    }
    this.publish({ pending });
  }
  private publishInterruption(patch: Partial<WorkControllerSnapshot['interruption']>) {
    this.publish({ interruption: { ...this.state.interruption, ...patch } });
  }
  private async saveInterruption(pending: PendingWorkInterruption | null) {
    if (pending) this.publishInterruption({ pending });
    try {
      if (!this.journal.saveInterruption) throw new Error('Interruption journal unavailable');
      await this.journal.saveInterruption(pending);
    } catch {
      throw new WorkApiError('refused', 'journal_unavailable');
    }
    this.publishInterruption({ pending });
  }
  private validateInterruption(operation: WorkOperation, pending: PendingWorkInterruption) {
    if (
      operation.kind !== 'interrupt_attempt' ||
      operation.task_id !== pending.taskId ||
      operation.attempt_id !== pending.attemptId ||
      operation.resources.instance_id !== pending.expectedInstanceId ||
      (pending.operationId && operation.id !== pending.operationId) ||
      (operation.interruption_receipt &&
        operation.interruption_receipt.owner_epoch !== pending.expectedNativeOwnerEpoch)
    )
      throw new WorkApiError('unconfirmed', 'instance_changed', pending.requestKey);
  }
  private async acceptInterruption(operation: WorkOperation, pending: PendingWorkInterruption) {
    this.validateInterruption(operation, pending);
    const terminal = operation.state === 'acknowledged' || operation.state === 'refused';
    await this.saveInterruption({
      ...pending,
      operationId: operation.id,
      state: terminal ? 'acknowledged' : 'unconfirmed',
    });
    this.publishInterruption({
      operation,
      error: terminal
        ? operation.state === 'refused'
          ? operation.failure_code === 'instance_changed'
            ? 'identity_changed'
            : 'failed'
          : null
        : 'unconfirmed',
    });
    this.mergeOperation(operation);
    if (terminal) await this.saveInterruption(null);
  }
  /** One explicit exact-instance interruption; it never consumes the primary delivery journal. */
  async interruptAttempt(attemptId: string): Promise<void> {
    if (this.state.interruption.busy || this.state.interruption.pending || !this.active) return;
    this.publishInterruption({ busy: true, error: null });
    let intent: PendingWorkInterruption | null = null;
    try {
      if (!(await this.hydrate())) throw new WorkApiError('refused', 'journal_unavailable');
      if (this.state.interruption.pending) return;
      const detail = this.state.detail;
      const selected = detail?.attempts.find((attempt) => attempt.id === attemptId);
      if (
        !detail ||
        this.state.selectedAttemptId !== attemptId ||
        !selected?.instance_id ||
        !selected.lifecycle?.native_owner_epoch ||
        workAttemptReleased(selected)
      )
        throw new WorkApiError('refused', 'instance_changed');
      const base = this.context();
      const context = {
        isCurrent: () =>
          base.isCurrent() &&
          this.state.detail?.task.id === detail.task.id &&
          this.state.selectedAttemptId === attemptId,
      };
      const capability = await this.capabilities(context);
      if (!capability.connected || !capability.records || !capability.interruption) {
        this.publishInterruption({ error: !capability.connected ? 'offline' : 'unavailable' });
        return;
      }
      const primary = this.state.pending;
      if (primary && (primary.kind !== 'deliver' || primary.taskId !== detail.task.id))
        throw new WorkApiError('refused', 'revision_conflict');
      if (this.state.busy && !primary) throw new WorkApiError('refused', 'revision_conflict');
      if (primary?.attemptId) {
        if (
          primary.attemptId !== attemptId ||
          primary.expectedInstanceId !== selected.instance_id ||
          (primary.expectedNativeOwnerEpoch &&
            primary.expectedNativeOwnerEpoch !== selected.lifecycle.native_owner_epoch)
        )
          throw new WorkApiError('refused', 'instance_changed');
      } else if (primary) {
        // Old journals may lack an operation ID; read the saved key, never infer its recipient.
        const receipt = await this.api.receipt(
          'deliver_prompt',
          primary.requestKey,
          detail.task.id,
          context
        );
        if (
          receipt.kind !== 'deliver_prompt' ||
          receipt.value.attempt_id !== attemptId ||
          receipt.value.resources.instance_id !== selected.instance_id
        )
          throw new WorkApiError('refused', 'instance_changed');
      }
      const fresh = await this.api.detail(detail.task.id, context);
      const target = fresh.attempts.find((attempt) => attempt.id === attemptId);
      if (
        !target ||
        target.instance_id !== selected.instance_id ||
        target.lifecycle?.native_owner_epoch !== selected.lifecycle.native_owner_epoch ||
        workAttemptReleased(target)
      )
        throw new WorkApiError('refused', 'instance_changed');
      if (
        fresh.operations.some(
          (operation) =>
            operation.kind === 'interrupt_attempt' &&
            operation.attempt_id === attemptId &&
            ['prepared', 'submitting', 'unconfirmed'].includes(operation.state)
        )
      )
        throw new WorkApiError('refused', 'delivery_unconfirmed');
      assertDeliveryCurrent(context.isCurrent);
      const finalCapability = await this.capabilities(context);
      if (!finalCapability.connected || !finalCapability.records || !finalCapability.interruption) {
        this.publishInterruption({ error: !finalCapability.connected ? 'offline' : 'unavailable' });
        return;
      }
      intent = {
        kind: 'interrupt',
        requestKey: this.newKey(),
        taskId: detail.task.id,
        attemptId,
        expectedInstanceId: selected.instance_id,
        expectedNativeOwnerEpoch: selected.lifecycle.native_owner_epoch,
        state: 'submitting',
      };
      await this.saveInterruption(intent);
      assertDeliveryCurrent(context.isCurrent);
      const { value } = await this.api.interrupt(
        detail.task.id,
        attemptId,
        {
          expected_revision: fresh.task.revision,
          expected_instance_id: intent.expectedInstanceId,
          expected_native_owner_epoch: intent.expectedNativeOwnerEpoch,
        },
        intent.requestKey,
        context
      );
      await this.acceptInterruption(value, intent);
    } catch (error) {
      const code = error instanceof WorkApiError ? error.code : '';
      if (intent && error instanceof WorkApiError && error.outcome === 'unconfirmed') {
        try {
          await this.saveInterruption({ ...intent, state: 'unconfirmed' });
        } catch {
          this.publishInterruption({ error: 'journal_unavailable' });
          return;
        }
        this.publishInterruption({ error: 'unconfirmed' });
      } else {
        if (intent && code !== 'journal_unavailable') {
          try {
            await this.saveInterruption(null);
          } catch {
            this.publishInterruption({ error: 'journal_unavailable' });
            return;
          }
        }
        this.publishInterruption({
          error:
            code === 'journal_unavailable'
              ? 'journal_unavailable'
              : code === 'instance_changed'
                ? 'identity_changed'
                : code === 'revision_conflict'
                  ? 'conflict'
                  : code === 'delivery_unconfirmed'
                    ? 'unconfirmed'
                    : 'failed',
        });
      }
    } finally {
      this.publishInterruption({ busy: false });
    }
  }
  /** Explicit receipt lookup is read-only, including after process restart or missing receipts. */
  async checkInterruptionStatus(): Promise<void> {
    if (this.state.interruption.busy || !this.active) return;
    this.publishInterruption({ busy: true, error: null });
    try {
      if (!(await this.hydrate())) throw new WorkApiError('refused', 'journal_unavailable');
      const pending = this.state.interruption.pending;
      if (!pending) return;
      const context = this.context();
      const receipt = await this.api.receipt(
        'interrupt_attempt',
        pending.requestKey,
        pending.taskId,
        context,
        pending.attemptId
      );
      assertDeliveryCurrent(context.isCurrent);
      if (receipt.kind !== 'interrupt_attempt')
        throw new WorkApiError('unconfirmed', 'invalid_input');
      await this.acceptInterruption(receipt.value, pending);
    } catch (error) {
      this.publishInterruption({
        error:
          error instanceof WorkApiError && error.code === 'journal_unavailable'
            ? 'journal_unavailable'
            : 'unconfirmed',
      });
    } finally {
      this.publishInterruption({ busy: false });
    }
  }
  deactivate() {
    this.active = false;
    this.ownership.invalidate();
    this.readSequence++;
    this.publish({ loading: false });
  }
  private context(): WorkRequestContext {
    return { isCurrent: this.ownership.capture(() => this.active) };
  }
  private error(error: unknown) {
    if (error instanceof WorkApiError && error.code === 'inputs_unavailable')
      return 'inputs_unavailable' as const;
    if (error instanceof WorkApiError && error.code === 'input_expired')
      return 'input_expired' as const;
    if (error instanceof WorkApiError && error.code === 'journal_unavailable')
      return 'journal_unavailable' as const;
    if (error instanceof WorkApiError && error.code === 'catalog_unavailable')
      return 'catalog_unavailable' as const;
    if (error instanceof WorkApiError)
      return error.outcome === 'unconfirmed'
        ? ('unconfirmed' as const)
        : [
              'revision_conflict',
              'request_key_conflict',
              'scope_mismatch',
              'instance_changed',
            ].includes(error.code)
          ? ('conflict' as const)
          : ('failed' as const);
    return 'failed' as const;
  }
  private async capabilities(context: WorkRequestContext) {
    const capabilities = await this.readCapabilities(context);
    assertDeliveryCurrent(context.isCurrent);
    this.publish({ capabilities });
    return capabilities;
  }
  private async profiles(context: WorkRequestContext) {
    const profiles = (await this.readProfiles(context)).filter((profile) => profile.available);
    assertDeliveryCurrent(context.isCurrent);
    this.publish({ profiles });
    return profiles;
  }
  async refreshProfiles() {
    if (!this.active || this.state.busy) return;
    const owner = this.context();
    const sequence = ++this.profileSequence;
    const context = { isCurrent: () => owner.isCurrent() && sequence === this.profileSequence };
    try {
      const profiles = await this.profiles(context);
      if (!this.state.creationDraft.agents && profiles.length)
        this.updateCreationDraft({ agents: profiles[0].kind });
      this.publish({ error: profiles.length ? null : 'catalog_unavailable' });
    } catch {
      if (context.isCurrent()) this.publish({ profiles: [], error: 'catalog_unavailable' });
    }
  }
  private async requireProfiles(kinds: readonly string[], context: WorkRequestContext) {
    this.profileSequence++;
    try {
      const profiles = await this.profiles(context);
      if (!kinds.length || kinds.some((kind) => !profiles.some((profile) => profile.kind === kind)))
        throw new Error('Missing installed profile');
    } catch {
      assertDeliveryCurrent(context.isCurrent);
      throw new WorkApiError('refused', 'catalog_unavailable');
    }
  }
  private async readTaskList(context: WorkRequestContext, summaries: boolean) {
    if (summaries) {
      const page = await this.api.summaries(context);
      return {
        tasks: page.items.map(workSummaryRow),
        next_after_id: page.next_after_id,
        summaryCursor: page.snapshot_cursor,
      };
    }
    const page = await this.api.list(context);
    return { ...page, summaryCursor: null };
  }
  async refresh() {
    if (!(await this.hydrate())) return;
    if (!this.active || this.state.loading || this.state.busy) return;
    const sequence = ++this.readSequence;
    const context = this.context();
    const taskId =
      this.state.pending?.taskId ??
      (this.state.view === 'detail' ? this.state.detail?.task.id : undefined);
    this.publish({ loading: true, error: null });
    try {
      const capability = await this.capabilities(context);
      if (!capability.connected || !capability.records) {
        this.publish({ error: capability.connected ? 'unavailable' : 'offline' });
        return;
      }
      await this.reconcileReceipt(context);
      const page = await this.readTaskList(context, capability.summaries === true);
      const resolvedTaskId = this.state.pending?.taskId ?? taskId;
      let detail = resolvedTaskId ? await this.api.detail(resolvedTaskId, context) : null;
      const selectedResultId = this.state.selectedResultId;
      if (
        detail &&
        selectedResultId &&
        !detail.results.some((result) => result.id === selectedResultId)
      ) {
        try {
          const selected = await this.api.result(detail.task.id, selectedResultId, context);
          detail = { ...detail, results: [...detail.results, selected] };
        } catch (error) {
          if (!(error instanceof WorkApiError && error.status === 404)) throw error;
        }
      }
      if (!context.isCurrent() || sequence !== this.readSequence) return;
      this.publish({
        tasks: page.tasks,
        summaryCursor: page.summaryCursor,
        nextAfterId: page.next_after_id,
        hasUpdates: false,
        requiresRefresh: false,
      });
      if (detail) this.applyDetail(detail, Boolean(this.state.pending?.taskId));
      const pending = this.state.pending;
      if (pending?.state === 'acknowledged' && detail?.task.id === pending.taskId)
        await this.savePending(null);
      if (pending?.operationId && pending.taskId) {
        const operation = await this.api.operation(pending.taskId, pending.operationId, context);
        if (!context.isCurrent()) return;
        if (operation.state === 'acknowledged' || operation.state === 'refused')
          await this.savePending(null);
      }
    } catch (error) {
      if (context.isCurrent())
        this.publish({ error: this.error(error), capabilities: unavailable });
    } finally {
      if (context.isCurrent() && sequence === this.readSequence) this.publish({ loading: false });
    }
  }
  async loadMore() {
    if (
      !this.state.nextAfterId ||
      this.state.loading ||
      !this.state.capabilities.records ||
      this.state.busy ||
      !this.active
    )
      return;
    const base = this.context();
    const sequence = this.readSequence;
    const context = { isCurrent: () => base.isCurrent() && sequence === this.readSequence };
    const after = this.state.nextAfterId;
    const cursor = this.state.summaryCursor;
    const rows = this.state.tasks;
    this.publish({ loading: true });
    try {
      if (cursor !== null) {
        const page = await this.api.summaries(context, after, cursor);
        if (
          context.isCurrent() &&
          this.state.tasks === rows &&
          this.state.summaryCursor === cursor &&
          this.state.nextAfterId === after
        )
          this.publish({
            tasks: mergeWorkSummaryRows(rows, page, cursor),
            nextAfterId: page.next_after_id,
          });
      } else {
        const page = await this.api.list(context, after);
        if (
          context.isCurrent() &&
          this.state.tasks === rows &&
          this.state.summaryCursor === null &&
          this.state.nextAfterId === after
        )
          this.publish({
            tasks: [
              ...rows,
              ...page.tasks.filter((task) => !rows.some((old) => old.id === task.id)),
            ],
            nextAfterId: page.next_after_id,
          });
      }
    } catch (error) {
      if (context.isCurrent())
        this.publish({
          error: this.error(error),
          ...(error instanceof WorkApiError && error.code === 'revision_conflict'
            ? { hasUpdates: true }
            : {}),
        });
    } finally {
      if (context.isCurrent()) this.publish({ loading: false });
    }
  }
  async loadRecords(kind: 'attempt' | 'operation' | 'result' | 'review') {
    const detail = this.state.detail;
    if (!detail || this.state.loading || this.state.busy || !this.active) return;
    const field = {
      attempt: 'attempts',
      operation: 'operations',
      result: 'results',
      review: 'reviews',
    } as const;
    const page = detail.pages?.[field[kind]];
    if (!page?.has_more || !page.next_after_id) return;
    const context = this.context();
    this.publish({ loading: true, error: null });
    try {
      const next = await this.api.records(
        detail.task.id,
        kind,
        page.snapshot_revision,
        page.next_after_id,
        context
      );
      if (!context.isCurrent() || this.state.detail !== detail) return;
      const merged = mergeWorkPage(detail, kind, next);
      const lead = workExecutionRecordsComplete(merged)
        ? merged.attempts.find(
            (attempt) => attempt.role === 'lead' && !workAttemptReleased(attempt)
          )
        : undefined;
      this.publish({
        detail: merged,
        recipientId: this.state.recipientId ?? lead?.id ?? null,
        selectedAttemptId: this.state.selectedAttemptId ?? lead?.id ?? null,
      });
    } catch (error) {
      if (context.isCurrent()) this.publish({ error: this.error(error), requiresRefresh: true });
    } finally {
      if (context.isCurrent()) this.publish({ loading: false });
    }
  }
  private async reconcileReceipt(context: WorkRequestContext) {
    const pending = this.state.pending;
    if (
      !pending ||
      pending.state !== 'unconfirmed' ||
      (pending.operationId && pending.kind !== 'reconcile')
    )
      return;
    const kinds = {
      create: 'create_task',
      start: 'start_attempt',
      deliver: 'deliver_prompt',
      review: 'review_result',
      pause: 'pause_task',
      reconcile: 'reconcile_attempt',
      configure: 'configure_delegation',
      dependencies: 'set_dependencies',
    } as const;
    try {
      const receipt = await this.api.receipt(
        kinds[pending.kind],
        pending.requestKey,
        pending.taskId,
        context,
        pending.attemptId
      );
      if (this.state.pending !== pending) return;
      if (receipt.kind === 'reconcile_attempt') {
        if (receipt.value.receipt_type === 'reconciliation') {
          const evidence = receipt.value.receipt.release?.evidence;
          if (evidence && evidence.kind !== 'gateway_dispatch_fence') {
            if (
              evidence.native_owner_epoch !== pending.expectedNativeOwnerEpoch ||
              (evidence.kind === 'native_exit_tombstone' &&
                evidence.instance_id !== pending.expectedInstanceId)
            )
              throw new WorkApiError('invalid_response', 'invalid_response');
          }
          this.applyReconciliation(receipt.value.receipt);
        } else {
          this.mergeOperation(receipt.value.operation);
          if (['prepared', 'submitting'].includes(receipt.value.operation.state)) return;
        }
        // An interrupted check has no input side effects. After an explicit lookup
        // it may be superseded by a new check with a new key, never replayed.
        await this.savePending(null);
        return;
      }
      if (receipt.kind === 'create_task') {
        await this.rememberCreation(receipt.value, receipt.value, pending.requestKey);
      } else if (receipt.kind === 'start_attempt' || receipt.kind === 'deliver_prompt') {
        this.mergeOperation(receipt.value);
        await this.savePending({
          ...pending,
          operationId: receipt.value.id,
          state: ['acknowledged', 'refused'].includes(receipt.value.state)
            ? 'acknowledged'
            : 'unconfirmed',
        });
      } else {
        await this.savePending({ ...pending, state: 'acknowledged' });
      }
    } catch (error) {
      // A missing receipt may still be in flight. It never permits a replay.
      if (!(error instanceof WorkApiError && error.status === 404)) throw error;
    }
  }
  async selectTask(taskId: string) {
    if (this.state.busy || !this.active) return;
    if (this.state.detail?.task.id === taskId) {
      this.readSequence++;
      this.publish({ view: 'detail', loading: false });
      return;
    }
    const remembered = this.viewMemory.recall(taskId);
    if (remembered) {
      this.readSequence++;
      this.publish({
        ...remembered,
        view: 'detail',
        draft: this.drafts.get(taskId) ?? '',
        loading: false,
        error: null,
        hasUpdates: this.state.hasUpdates || remembered.hasUpdates,
      });
      return;
    }
    if (!this.state.capabilities.records) return;
    const sequence = ++this.readSequence;
    const context = this.context();
    this.publish({ loading: true, error: null });
    try {
      const detail = await this.api.detail(taskId, context);
      if (!context.isCurrent() || sequence !== this.readSequence) return;
      this.applyDetail(detail, true);
    } catch (error) {
      if (context.isCurrent() && sequence === this.readSequence)
        this.publish({ error: this.error(error) });
    } finally {
      if (context.isCurrent() && sequence === this.readSequence) this.publish({ loading: false });
    }
  }
  private applyDetail(detail: WorkDetail, selected = false) {
    const same = this.state.detail?.task.id === detail.task.id;
    if (this.state.detail) this.drafts.set(this.state.detail.task.id, this.state.draft);
    const lead = [...detail.attempts]
      .reverse()
      .find((attempt) => attempt.role === 'lead' && !workAttemptReleased(attempt));
    const historicalLead = [...detail.attempts]
      .reverse()
      .find((attempt) => attempt.role === 'lead');
    this.publish({
      detail,
      requiresRefresh: false,
      selectedAttemptId:
        same && this.state.detail?.attempts.length
          ? this.state.selectedAttemptId
          : (lead?.id ?? historicalLead?.id ?? null),
      selectedResultId:
        same && this.state.detail?.results.length
          ? this.state.selectedResultId
          : (detail.results.at(-1)?.id ?? null),
      recipientId:
        same && this.state.detail?.attempts.length ? this.state.recipientId : (lead?.id ?? null),
      draft: same ? this.state.draft : (this.drafts.get(detail.task.id) ?? ''),
      ...(!same ? { lifecycleObservation: null } : {}),
      ...(selected ? { view: 'detail' as const, hasUpdates: false } : {}),
    });
  }
  showList() {
    if (!this.state.busy) {
      if (this.state.detail) this.drafts.set(this.state.detail.task.id, this.state.draft);
      this.readSequence++;
      this.publish({
        view: 'list',
        loading: false,
      });
    }
  }
  showCreate() {
    if (this.state.busy) return;
    this.readSequence++;
    this.publish({ view: 'create', loading: false });
  }
  getViewAnchor(region: 'list' | 'detail' | 'output', taskId = this.state.detail?.task.id) {
    return this.viewMemory.anchor(region, taskId);
  }
  saveViewAnchor(
    region: 'list' | 'detail' | 'output',
    anchor: WorkViewAnchor,
    taskId = this.state.detail?.task.id
  ) {
    this.viewMemory.saveAnchor(region, anchor, taskId);
  }
  clearPresentation() {
    this.retired = true;
    this.deactivate();
    this.viewMemory.clear();
    this.drafts.clear();
    this.acknowledgedCreations.clear();
    this.state = {
      ...this.state,
      view: 'list',
      detail: null,
      selectedAttemptId: null,
      selectedResultId: null,
      recipientId: null,
      draft: '',
      tasks: [],
      creationDraft: { title: '', project: '', goal: '', agents: '', maxWorkers: '0' },
    };
    for (const listener of this.listeners) listener();
  }
  selectAttempt(id: string) {
    if (this.state.detail?.attempts.some((attempt) => attempt.id === id))
      this.publish({ selectedAttemptId: id });
  }
  selectResult(id: string) {
    if (this.state.detail?.results.some((result) => result.id === id))
      this.publish({ selectedResultId: id });
  }
  addressAttempt(id: string) {
    if (
      !this.state.busy &&
      this.state.detail?.attempts.some(
        (attempt) => attempt.id === id && !workAttemptReleased(attempt)
      )
    )
      this.publish({ recipientId: id });
  }
  setDraft(draft: string) {
    this.publish({ draft });
  }
  updateCreationDraft(patch: Partial<WorkControllerSnapshot['creationDraft']>) {
    this.publish({ creationDraft: { ...this.state.creationDraft, ...patch } });
  }
  notifyUpdates() {
    this.publish({ hasUpdates: true });
  }
  markUnavailable() {
    this.publish({ capabilities: unavailable, error: 'unavailable' });
  }
  /** Polling only signals new facts; it cannot replace the output/result being read. */
  async checkUpdates() {
    const cursor =
      this.state.view === 'detail'
        ? this.state.detail?.cursor
        : (this.state.summaryCursor ?? this.state.detail?.cursor);
    if (
      !this.active ||
      this.state.loading ||
      this.state.busy ||
      cursor === undefined ||
      !this.state.capabilities.records
    )
      return;
    const context = this.context();
    const view = this.state.view;
    const taskId = this.state.detail?.task.id;
    const summaryCursor = this.state.summaryCursor;
    try {
      const page = await this.api.changes(cursor, context);
      if (
        context.isCurrent() &&
        this.state.view === view &&
        this.state.summaryCursor === summaryCursor &&
        this.state.detail?.task.id === taskId &&
        (page.reset_required || page.changes.length > 0)
      )
        this.publish({ hasUpdates: true });
    } catch {
      /* A notification poll does not replace a readable snapshot or initiate recovery. */
    }
  }
  private async mutate(
    kind: PendingWorkAction['kind'],
    taskId: string | null,
    execution: boolean,
    effect: (key: string, context: WorkRequestContext) => Promise<WorkTask | WorkOperation | void>,
    identity?: Pick<
      PendingWorkIntent,
      'attemptId' | 'expectedInstanceId' | 'expectedNativeOwnerEpoch'
    >,
    preflight?: (context: WorkRequestContext) => Promise<void>
  ) {
    if (!(await this.hydrate())) return;
    if (this.state.busy || this.state.pending || !this.active) return;
    if (execution && this.state.requiresRefresh) {
      this.publish({ error: 'conflict' });
      return;
    }
    if (execution && this.state.detail && !workExecutionRecordsComplete(this.state.detail)) {
      this.publish({ error: 'conflict' });
      return;
    }
    if (
      execution &&
      this.state.detail?.operations.some((operation) =>
        workOperationBlocksExecution(operation, this.state.detail!.attempts)
      )
    ) {
      this.publish({ error: 'unconfirmed' });
      return;
    }
    const context = this.context();
    this.publish({ busy: true, error: null });
    let key: string | null = null;
    try {
      const capability = await this.capabilities(context);
      if (kind === 'reconcile' && !capability.reconciliation) {
        this.publish({ error: 'lifecycle_unavailable' });
        return;
      }
      if (!capability.connected || !capability.records || (execution && !capability.execution)) {
        this.publish({
          error: !capability.connected
            ? 'offline'
            : !capability.records
              ? 'unavailable'
              : 'execution_unavailable',
        });
        return;
      }
      assertDeliveryCurrent(context.isCurrent);
      if (preflight) {
        await preflight(context);
        assertDeliveryCurrent(context.isCurrent);
        const fresh = await this.capabilities(context);
        if (!fresh.records || (execution && !fresh.execution))
          throw new WorkApiError('refused', 'capability_unavailable');
      }
      key = this.newKey();
      await this.savePending({ requestKey: key, taskId, kind, state: 'submitting', ...identity });
      const receipt = await effect(key, context);
      if (receipt && 'state' in receipt) this.mergeOperation(receipt);
      if (
        receipt &&
        'state' in receipt &&
        ['unconfirmed', 'submitting', 'prepared'].includes(receipt.state)
      ) {
        await this.savePending({
          ...(this.state.pending ?? { requestKey: key, taskId, kind }),
          state: 'unconfirmed',
          operationId: receipt.id,
        });
        this.publish({ error: 'unconfirmed' });
      } else {
        await this.savePending(null);
        this.publish({
          hasUpdates: true,
          requiresRefresh: this.state.requiresRefresh || execution,
          ...(receipt && 'state' in receipt && receipt.state === 'refused'
            ? { error: 'failed' as const }
            : {}),
        });
      }
    } catch (error) {
      if (key && error instanceof WorkApiError && error.outcome === 'unconfirmed') {
        try {
          await this.savePending({
            ...(this.state.pending ?? { requestKey: key, taskId, kind }),
            requestKey: error.requestKey ?? key,
            state: 'unconfirmed',
          });
          this.publish({ error: 'unconfirmed' });
        } catch {
          this.publish({ error: 'journal_unavailable' });
        }
      } else {
        const pending = this.getSnapshot().pending;
        const storageFailed = error instanceof WorkApiError && error.code === 'journal_unavailable';
        if (pending?.state !== 'acknowledged' && !storageFailed) {
          try {
            await this.savePending(null);
          } catch {
            this.publish({ error: 'journal_unavailable' });
            return;
          }
        }
        this.publish({ error: this.error(error) });
      }
    } finally {
      this.publish({ busy: false });
    }
  }
  private mergeOperation(operation: WorkOperation) {
    const detail = this.state.detail;
    if (detail?.task.id !== operation.task_id) return;
    this.publish({
      detail: {
        ...detail,
        operations: [...detail.operations.filter((old) => old.id !== operation.id), operation],
      },
    });
  }
  private creationIdentity(input: WorkCreateTask) {
    return JSON.stringify([
      input.repo_path,
      input.title,
      input.brief,
      input.parent_task_id,
      input.policy.allowed_agents,
      input.policy.max_workers,
      (input.input_refs ?? []).map(({ input_id, caption, use }) => ({ input_id, caption, use })),
    ]);
  }
  private async rememberCreation(input: WorkCreateTask, task: WorkTask, requestKey: string) {
    this.acknowledgedCreations.set(this.creationIdentity(input), task.id);
    this.publish({
      tasks: [task, ...this.state.tasks.filter((item) => item.id !== task.id)],
    });
    await this.savePending({ requestKey, taskId: task.id, kind: 'create', state: 'acknowledged' });
  }
  private async inspectPreviousCreation(input: WorkCreateTask) {
    const taskId = this.acknowledgedCreations.get(this.creationIdentity(input));
    if (!taskId) return false;
    await this.selectTask(taskId);
    return true;
  }
  private assertInputs(
    refs: readonly TaskInputRef[],
    prepared: WorkPreparedInputs | undefined,
    context: WorkRequestContext
  ) {
    assertDeliveryCurrent(context.isCurrent);
    if (prepared) assertDeliveryCurrent(prepared.isCurrent);
    if (refs.length && !this.state.capabilities.inputs)
      throw new WorkApiError('refused', 'inputs_unavailable');
  }
  async create(input: WorkCreateTask, prepare?: WorkInputPreparation) {
    if (!prepare && (await this.inspectPreviousCreation(input))) return false;
    let prepared: WorkPreparedInputs | undefined;
    let created = false;
    await this.mutate(
      'create',
      null,
      false,
      async (key, context) => {
        await this.requireProfiles(input.policy.allowed_agents, context);
        this.assertInputs(input.input_refs ?? [], prepared, context);
        const { value } = await this.api.create(input, key, context);
        created = true;
        // Record the durable task identity even if the user left while its ACK arrived.
        await this.rememberCreation(input, value, key);
        prepared?.onAcknowledged();
        if (context.isCurrent()) {
          const detail = await this.api.detail(value.id, context);
          if (context.isCurrent()) this.applyDetail(detail, true);
        }
        return value;
      },
      undefined,
      prepare
        ? async (context) => {
            prepared = await prepare(context);
            this.assertInputs(prepared.inputRefs, prepared, context);
            input = { ...input, input_refs: prepared.inputRefs };
            if (this.acknowledgedCreations.has(this.creationIdentity(input)))
              throw new WorkApiError('refused', 'revision_conflict');
          }
        : undefined
    );
    return created;
  }
  /** One explicit user commit; each durable stage retains a separate receipt and key. */
  async startGoal(input: WorkCreateTask, prepare?: WorkInputPreparation): Promise<boolean> {
    if (!prepare && (await this.inspectPreviousCreation(input))) return false;
    let prepared: WorkPreparedInputs | undefined;
    let submitted = false;
    const brief = input.brief;
    const agent = input.policy.allowed_agents[0];
    await this.mutate(
      'create',
      null,
      true,
      async (createKey, context) => {
        await this.requireProfiles(input.policy.allowed_agents, context);
        this.assertInputs(input.input_refs ?? [], prepared, context);
        const { value: task } = await this.api.create(input, createKey, context);
        await this.rememberCreation(input, task, createKey);
        prepared?.onAcknowledged();
        const created = await this.api.detail(task.id, context);
        if (context.isCurrent()) {
          this.applyDetail(created, true);
          this.publish({ draft: brief });
        }
        const startCapability = await this.capabilities(context);
        if (!startCapability.execution) throw new WorkApiError('refused', 'capability_unavailable');
        await this.requireProfiles([agent], context);
        const startKey = this.newKey();
        await this.savePending({
          requestKey: startKey,
          taskId: task.id,
          kind: 'start',
          state: 'submitting',
        });
        const { value: started } = await this.api.start(
          task.id,
          { agent_kind: agent, role: 'lead' },
          created.task.revision,
          startKey,
          context
        );
        this.mergeOperation(started);
        if (started.state !== 'acknowledged') return started;
        await this.savePending({
          requestKey: startKey,
          taskId: task.id,
          kind: 'start',
          state: 'acknowledged',
          operationId: started.id,
        });
        const live = await this.api.detail(task.id, context);
        if (context.isCurrent()) this.applyDetail(live);
        const attempt = live.attempts.find((item) => item.id === started.attempt_id);
        if (!attempt?.instance_id) throw new WorkApiError('refused', 'instance_changed');
        const deliveryCapability = await this.capabilities(context);
        if (!deliveryCapability.execution)
          throw new WorkApiError('refused', 'capability_unavailable');
        const initialRefs = task.input_refs?.map(({ input_id, caption, use }) => ({
          input_id,
          caption,
          use,
        }));
        this.assertInputs(initialRefs ?? [], undefined, context);
        const deliveryKey = this.newKey();
        await this.savePending({
          requestKey: deliveryKey,
          taskId: task.id,
          kind: 'deliver',
          state: 'submitting',
          attemptId: attempt.id,
          expectedInstanceId: attempt.instance_id,
          expectedNativeOwnerEpoch: attempt.lifecycle?.native_owner_epoch ?? null,
        });
        const { value: delivered } = await this.api.deliver(
          task.id,
          {
            attempt_id: attempt.id,
            expected_instance_id: attempt.instance_id,
            text: brief,
            ...(initialRefs?.length ? { input_refs: initialRefs } : {}),
          },
          live.task.revision,
          deliveryKey,
          context
        );
        submitted = delivered.state === 'acknowledged';
        if (submitted && this.state.detail?.task.id === task.id && this.state.draft === brief)
          this.publish({ draft: '' });
        return delivered;
      },
      undefined,
      prepare
        ? async (context) => {
            prepared = await prepare(context);
            this.assertInputs(prepared.inputRefs, prepared, context);
            input = { ...input, input_refs: prepared.inputRefs };
            if (this.acknowledgedCreations.has(this.creationIdentity(input)))
              throw new WorkApiError('refused', 'revision_conflict');
          }
        : undefined
    );
    return submitted;
  }
  async start(agentKind: string) {
    const detail = this.state.detail;
    if (!detail || detail.task.paused || !detail.task.policy.allowed_agents.includes(agentKind))
      return;
    if (detail.attempts.some((attempt) => attempt.role === 'lead')) return;
    await this.mutate('start', detail.task.id, true, async (key, context) => {
      await this.requireProfiles([agentKind], context);
      return (
        await this.api.start(
          detail.task.id,
          { agent_kind: agentKind, role: 'lead' },
          detail.task.revision,
          key,
          context
        )
      ).value;
    });
  }
  private applyReconciliation(receipt: WorkReconciliation) {
    const detail = this.state.detail;
    this.publish({ lifecycleObservation: receipt });
    if (!detail?.attempts.some((attempt) => attempt.id === receipt.attempt_id)) return;
    // An immutable recovered receipt may precede a newer detail snapshot.
    if (receipt.task_revision < detail.task.revision) return;
    this.publish({
      detail: {
        ...detail,
        task: { ...detail.task, revision: receipt.task_revision },
        attempts: detail.attempts.map((attempt) =>
          attempt.id !== receipt.attempt_id
            ? attempt
            : {
                ...attempt,
                lifecycle: {
                  ...(attempt.lifecycle ?? {
                    launch_phase: 'legacy_unknown' as const,
                    native_owner_epoch: null,
                  }),
                  reservation: receipt.reservation,
                  release: receipt.release,
                },
              }
        ),
      },
      hasUpdates: true,
    });
  }
  async checkLifecycle(attemptId: string) {
    const detail = this.state.detail;
    const attempt = detail?.attempts.find((item) => item.id === attemptId);
    if (!detail || !attempt) return;
    const identity = {
      attemptId,
      expectedInstanceId: attempt.instance_id,
      expectedNativeOwnerEpoch: attempt.lifecycle?.native_owner_epoch ?? null,
    };
    await this.mutate(
      'reconcile',
      detail.task.id,
      false,
      async (key, context) => {
        const { value } = await this.api.reconcile(
          detail.task.id,
          attemptId,
          {
            expected_revision: detail.task.revision,
            expected_instance_id: identity.expectedInstanceId,
            expected_native_owner_epoch: identity.expectedNativeOwnerEpoch,
          },
          key,
          context
        );
        this.applyReconciliation(value);
        await this.savePending({
          requestKey: key,
          taskId: detail.task.id,
          kind: 'reconcile',
          state: 'acknowledged',
          operationId: value.operation_id,
          ...identity,
        });
        this.mergeOperation(await this.api.operation(detail.task.id, value.operation_id, context));
      },
      identity
    );
  }
  async startReplacement(attemptId: string, agentKind: string) {
    const detail = this.state.detail;
    const previous = detail?.attempts.find((attempt) => attempt.id === attemptId);
    if (
      !detail ||
      !previous ||
      !canReplaceWorkAttempt(detail, attemptId) ||
      !detail.task.policy.allowed_agents.includes(agentKind)
    )
      return;
    await this.mutate('start', detail.task.id, true, async (key, context) => {
      if (!this.state.capabilities.reconciliation)
        throw new WorkApiError('refused', 'capability_unavailable');
      await this.requireProfiles([agentKind], context);
      const { value } = await this.api.start(
        detail.task.id,
        { agent_kind: agentKind, role: previous.role },
        detail.task.revision,
        key,
        context
      );
      this.mergeOperation(value);
      if (value.state === 'acknowledged') {
        await this.savePending({
          requestKey: key,
          taskId: detail.task.id,
          kind: 'start',
          state: 'acknowledged',
          operationId: value.id,
        });
        const fresh = await this.api.detail(detail.task.id, context);
        const replacement = fresh.attempts.find((attempt) => attempt.id === value.attempt_id);
        if (!replacement || workAttemptReleased(replacement))
          throw new WorkApiError('refused', 'instance_changed');
        if (context.isCurrent() && this.state.detail?.task.id === detail.task.id) {
          this.publish({
            detail: {
              ...this.state.detail,
              task: fresh.task,
              attempts: [
                ...this.state.detail.attempts.filter((attempt) => attempt.id !== replacement.id),
                replacement,
              ],
            },
            recipientId: replacement.id,
          });
        }
      }
      return value;
    });
  }
  async deliver(prepare?: WorkInputPreparation) {
    let prepared: WorkPreparedInputs | undefined;
    const detail = this.state.detail;
    const recipient = detail?.attempts.find((attempt) => attempt.id === this.state.recipientId);
    const draft = this.state.draft;
    if (!detail || !recipient?.instance_id || workAttemptReleased(recipient) || !draft.trim())
      return;
    const interruptionBlocked = () =>
      this.state.interruption.busy ||
      (this.state.interruption.pending?.taskId === detail.task.id &&
        this.state.interruption.pending.attemptId === recipient.id) ||
      this.state.detail?.operations.some(
        (operation) =>
          operation.kind === 'interrupt_attempt' &&
          workOperationBlocksExecution(operation, this.state.detail!.attempts, recipient.id)
      );
    if (interruptionBlocked()) {
      this.publish({ error: 'unconfirmed' });
      return;
    }
    await this.mutate(
      'deliver',
      detail.task.id,
      true,
      async (key, context) => {
        if (interruptionBlocked()) throw new WorkApiError('refused', 'delivery_unconfirmed');
        this.assertInputs(prepared?.inputRefs ?? [], prepared, context);
        const { value } = await this.api.deliver(
          detail.task.id,
          {
            attempt_id: recipient.id,
            expected_instance_id: recipient.instance_id ?? '',
            text: draft,
            ...(prepared?.inputRefs.length ? { input_refs: prepared.inputRefs } : {}),
          },
          detail.task.revision,
          key,
          context
        );
        if (
          value.state === 'acknowledged' &&
          this.state.detail?.task.id === detail.task.id &&
          this.state.draft === draft
        )
          this.publish({ draft: '' });
        if (value.state === 'acknowledged') prepared?.onAcknowledged();
        return value;
      },
      {
        attemptId: recipient.id,
        expectedInstanceId: recipient.instance_id,
        expectedNativeOwnerEpoch: recipient.lifecycle?.native_owner_epoch ?? null,
      },
      prepare
        ? async (context) => {
            prepared = await prepare(context);
            this.assertInputs(prepared.inputRefs, prepared, context);
          }
        : undefined
    );
  }
  async review(
    resultId: string,
    revision: number,
    decision: 'accepted' | 'changes_requested',
    message: string | null = null
  ): Promise<WorkReview | null> {
    const detail = this.state.detail;
    if (
      !detail ||
      resultId !== this.state.selectedResultId ||
      detail.task.revision !== revision ||
      !detail.results.some((result) => result.id === resultId)
    ) {
      this.publish({ error: 'conflict' });
      return null;
    }
    let acknowledged: WorkReview | null = null;
    await this.mutate('review', detail.task.id, false, async (key, context) => {
      const { value } = await this.api.review(
        detail.task.id,
        { submission_id: resultId, decision, message },
        revision,
        key,
        context
      );
      acknowledged = value;
      if (this.state.detail?.task.id === detail.task.id)
        this.publish({
          detail: {
            ...this.state.detail,
            task: { ...this.state.detail.task, revision: revision + 1 },
            reviews: [...this.state.detail.reviews, value],
          },
        });
    });
    return acknowledged;
  }
  /** Preparing a review follow-up never sends input or changes historical selection. */
  prepareReviewFollowup(reviewId: string) {
    const detail = this.state.detail;
    if (
      !detail ||
      this.state.busy ||
      this.state.pending ||
      this.state.draft.trim() ||
      !workExecutionRecordsComplete(detail)
    )
      return false;
    const review = detail.reviews.find(
      (item) =>
        item.id === reviewId &&
        item.decision === 'changes_requested' &&
        item.submission_id === this.state.selectedResultId
    );
    const lead = detail.attempts.find((item) => item.role === 'lead' && !workAttemptReleased(item));
    if (!review || !lead) return false;
    this.publish({
      recipientId: lead.id,
      draft: `Please address the requested changes for submission ${review.submission_id} (review ${review.id}).${review.message?.trim() ? `\n\n${review.message.trim()}` : ''}`,
    });
    return true;
  }
  /** Read related records for an explicit dependency picker without changing the active task. */
  async inspectRelatedTask(taskId: string): Promise<WorkDetail | null> {
    const source = this.state.detail?.task;
    if (!source || !this.active || !this.state.capabilities.records) return null;
    const sequence = this.readSequence;
    const base = this.context();
    const context = {
      isCurrent: () =>
        base.isCurrent() &&
        sequence === this.readSequence &&
        this.state.detail?.task.id === source.id,
    };
    const related = await this.api.detail(taskId, context);
    assertDeliveryCurrent(context.isCurrent);
    if (
      related.task.id === source.id ||
      related.task.repo_path !== source.repo_path ||
      !(
        related.task.parent_task_id === source.id ||
        (source.parent_task_id && related.task.parent_task_id === source.parent_task_id)
      )
    )
      throw new WorkApiError('refused', 'scope_mismatch');
    return related;
  }
  async inspectRelatedResults(taskId: string, revision: number, afterId: string) {
    const sequence = this.readSequence;
    const related = await this.inspectRelatedTask(taskId);
    if (!related || related.task.revision !== revision)
      throw new WorkApiError('refused', 'revision_conflict');
    const base = this.context();
    return this.api.records(taskId, 'result', revision, afterId, {
      isCurrent: () => base.isCurrent() && sequence === this.readSequence,
    });
  }
  async inspectRelatedResult(taskId: string, resultId: string) {
    const sequence = this.readSequence;
    const related = await this.inspectRelatedTask(taskId);
    if (!related) return null;
    const base = this.context();
    return this.api.result(taskId, resultId, {
      isCurrent: () => base.isCurrent() && sequence === this.readSequence,
    });
  }
  async configureDelegation(intent: WorkDelegationIntent): Promise<void> {
    const detail = this.state.detail;
    if (
      !detail ||
      intent.serverId !== this.api.scope.serverId ||
      intent.sessionId !== this.api.scope.sessionId ||
      intent.taskId !== detail.task.id ||
      intent.expected_revision !== detail.task.revision ||
      detail.task.parent_task_id !== null ||
      (intent.input.policy.enabled && !workExecutionRecordsComplete(detail))
    ) {
      this.publish({ error: 'conflict' });
      return;
    }
    const input = {
      policy: { ...intent.input.policy },
      coordinator_attempt_id: intent.input.coordinator_attempt_id,
    };
    const coordinator = intent.coordinator ? { ...intent.coordinator } : null;
    const epoch = parseWorkDelegationState(detail.task.delegation).coordinator_epoch;
    const sequence = this.readSequence;
    const scoped = (context: WorkRequestContext) => ({
      isCurrent: () =>
        context.isCurrent() &&
        this.readSequence === sequence &&
        this.state.detail?.task.id === detail.task.id &&
        this.state.detail.task.revision === detail.task.revision,
    });
    await this.mutate(
      'configure',
      detail.task.id,
      false,
      async (key, context) => {
        const guard = scoped(context);
        assertDeliveryCurrent(guard.isCurrent);
        if (!this.state.capabilities.delegation)
          throw new WorkApiError('refused', 'capability_unavailable');
        const { value } = await this.api.configureDelegation(
          detail.task.id,
          input,
          detail.task.revision,
          epoch,
          key,
          guard
        );
        if (this.state.detail?.task.id === value.id)
          this.publish({ detail: { ...this.state.detail, task: value } });
        return value;
      },
      coordinator
        ? {
            attemptId: coordinator.attemptId,
            expectedInstanceId: coordinator.instanceId,
            expectedNativeOwnerEpoch: coordinator.nativeOwnerEpoch,
          }
        : undefined,
      async (context) => {
        const guard = scoped(context);
        if (!this.state.capabilities.delegation)
          throw new WorkApiError('refused', 'capability_unavailable');
        const fresh = await this.api.detail(detail.task.id, guard);
        if (
          fresh.task.revision !== detail.task.revision ||
          parseWorkDelegationState(fresh.task.delegation).coordinator_epoch !== epoch
        )
          throw new WorkApiError('refused', 'revision_conflict');
        if (input.policy.enabled) {
          const attempt = fresh.attempts.find(
            (attempt) => attempt.id === input.coordinator_attempt_id
          );
          const confirmed = attempt ? confirmedDelegationLead(fresh.task, attempt) : null;
          if (
            !coordinator ||
            !confirmed ||
            coordinator.taskId !== confirmed.taskId ||
            coordinator.attemptId !== confirmed.attemptId ||
            coordinator.instanceId !== confirmed.instanceId ||
            coordinator.nativeOwnerEpoch !== confirmed.nativeOwnerEpoch
          )
            throw new WorkApiError('refused', 'instance_changed');
        }
      }
    );
  }
  async setDependencies(intent: WorkDependencyIntent): Promise<void> {
    const detail = this.state.detail;
    if (
      !detail ||
      intent.serverId !== this.api.scope.serverId ||
      intent.sessionId !== this.api.scope.sessionId ||
      intent.taskId !== detail.task.id ||
      intent.expected_revision !== detail.task.revision
    ) {
      this.publish({ error: 'conflict' });
      return;
    }
    let dependencies: ReturnType<typeof parseWorkDependencies>;
    try {
      dependencies = parseWorkDependencies(intent.dependencies, detail.task.id);
    } catch {
      this.publish({ error: 'invalid' });
      return;
    }
    if (dependencies.length && detail.task.parent_task_id === null) {
      this.publish({ error: 'conflict' });
      return;
    }
    const sequence = this.readSequence;
    const scoped = (context: WorkRequestContext) => ({
      isCurrent: () =>
        context.isCurrent() &&
        sequence === this.readSequence &&
        this.state.detail?.task.id === detail.task.id &&
        this.state.detail.task.revision === detail.task.revision,
    });
    await this.mutate(
      'dependencies',
      detail.task.id,
      false,
      async (key, context) => {
        const guard = scoped(context);
        assertDeliveryCurrent(guard.isCurrent);
        if (!this.state.capabilities.delegation)
          throw new WorkApiError('refused', 'capability_unavailable');
        const { value } = await this.api.setDependencies(
          detail.task.id,
          dependencies,
          detail.task.revision,
          key,
          guard
        );
        if (this.state.detail?.task.id === value.id)
          this.publish({ detail: { ...this.state.detail, task: value } });
        return value;
      },
      undefined,
      async (context) => {
        const guard = scoped(context);
        if (!this.state.capabilities.delegation)
          throw new WorkApiError('refused', 'capability_unavailable');
        const fresh = await this.api.detail(detail.task.id, guard);
        if (fresh.task.revision !== detail.task.revision)
          throw new WorkApiError('refused', 'revision_conflict');
        for (const dependency of dependencies) {
          const prerequisite = await this.api.detail(dependency.prerequisite_task_id, guard);
          if (
            prerequisite.task.parent_task_id !== detail.task.parent_task_id ||
            prerequisite.task.repo_path !== detail.task.repo_path
          )
            throw new WorkApiError('refused', 'scope_mismatch');
          if (dependency.submission_id)
            await this.api.result(prerequisite.task.id, dependency.submission_id, guard);
        }
      }
    );
  }
  async setPaused(paused: boolean) {
    const detail = this.state.detail;
    if (!detail) return;
    await this.mutate('pause', detail.task.id, false, async (key, context) => {
      const { value } = await this.api.setDelegationPaused(
        detail.task.id,
        paused,
        detail.task.revision,
        key,
        context
      );
      if (this.state.detail?.task.id === value.id)
        this.publish({ detail: { ...this.state.detail, task: value } });
      return value;
    });
  }
}
