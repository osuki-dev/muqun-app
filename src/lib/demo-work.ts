import { utf8Bytes } from './multipart';
import type { WorkTaskSummary } from './work-summaries';
import { parseWorkDelegationState, parseWorkDelegationPolicy } from './work-delegation';
import { demoWorkInputs, resetDemoWorkInputs } from './demo-work-inputs';
import type { TaskInputRef } from './task-inputs';
import { DEMO_PAIRING_SERVER_ID } from './pairing';
import type { WorkArtifactTransport } from './work-artifacts';
import type {
  WorkAttempt,
  WorkBinding,
  WorkChange,
  WorkDetail,
  WorkOperation,
  WorkReconciliation,
  WorkResult,
  WorkTask,
  WorkTransport,
} from './work-api';

/** Fictional offline Gateway responses. Never evidence of real agent delivery. */
export const DEMO_WORK_IDS = {
  review: id(1),
  uncertain: id(2),
  unsupported: id(3),
  lifecycle: id(4),
  childDesign: id(5),
  childImplementation: id(6),
  childFirstResult: id(24),
  childSecondResult: id(25),
  lifecycleLead: id(14),
  lifecycleResult: id(23),
  lead: id(11),
  worker: id(12),
  firstResult: id(21),
  secondResult: id(22),
};
const emptyBinding: WorkBinding = {
  instance_id: null,
  target: null,
  pane_id: null,
  worktree_path: null,
};
const now = 1789344000000;
const artifactText = '# Demo result\nThis immutable artifact is fictional offline evidence.\n';
const artifactSha256 = '8887b91b0373e3881394e6823806b8a267385d6e32d3335951b21e6cce56c549';
function id(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function binding(attemptId: string): WorkBinding {
  return {
    instance_id: `demo-work-instance-${attemptId}`,
    target: `demo-work-pane-${attemptId}`,
    pane_id: `demo-work-pane-${attemptId}`,
    worktree_path: '/demo/homepage',
  };
}

type DemoLifecycleCheck = 'live' | 'unknown' | 'exited' | 'interrupted' | 'revision_refused';
export function createDemoWorkTransport(
  options: {
    execution?: boolean;
    interruption?: boolean;
    delegation?: boolean;
    interruptOutcome?: 'acknowledged' | 'unconfirmed';
    lifecycleChecks?: DemoLifecycleCheck[];
    inputs?: typeof demoWorkInputs;
  } = {}
): WorkTransport {
  let sequence = 100;
  let cursor = 0;
  const tasks = new Map<string, WorkDetail>();
  const changes: WorkChange[] = [];
  const requests = new Map<string, { signature: string; value: unknown }>();
  const outputs = new Map<string, string>();
  const receipts = new Map<string, unknown>();
  const failedRequests = new Map<string, { signature: string; code: string; status: number }>();
  const lifecycleChecks = new Map<string, number>();
  const nextId = () => id(sequence++);
  function seed(taskId: string, title: string): WorkDetail {
    const task: WorkTask = {
      id: taskId,
      session_id: 'demo',
      revision: 0,
      created_at_ms: now,
      updated_at_ms: now,
      paused: false,
      repo_path: '/demo/homepage',
      title,
      brief: 'Fictional offline example. No agent, command, or network request runs.',
      parent_task_id: null,
      delegation: parseWorkDelegationState(undefined),
      dependencies: [],
      policy: { allowed_agents: ['claude', 'codex'], max_workers: 1 },
    };
    const detail: WorkDetail = {
      task,
      attempts: [],
      operations: [],
      results: [],
      reviews: [],
      cursor,
    };
    tasks.set(taskId, detail);
    return detail;
  }
  function operation(
    detail: WorkDetail,
    kind: WorkOperation['kind'],
    attempt: WorkAttempt | undefined,
    state: WorkOperation['state'] = 'acknowledged',
    failure: WorkOperation['failure_code'] = null
  ): WorkOperation {
    const result: WorkOperation = {
      id: nextId(),
      task_id: detail.task.id,
      attempt_id: attempt?.id ?? null,
      kind,
      state,
      failure_code: failure,
      resources: attempt ? binding(attempt.id) : { ...emptyBinding },
      created_at_ms: now,
      updated_at_ms: now,
    };
    detail.operations.push(result);
    return result;
  }
  function changed(detail: WorkDetail, kind: string, entityId: string) {
    detail.task.revision++;
    detail.task.updated_at_ms = now + ++cursor;
    detail.cursor = cursor;
    changes.push({
      cursor,
      task_id: detail.task.id,
      revision: detail.task.revision,
      kind,
      entity_id: entityId,
    });
  }
  function addAttempt(
    detail: WorkDetail,
    attemptId: string,
    kind: string,
    role: 'lead' | 'worker'
  ) {
    const attempt: WorkAttempt = {
      ...binding(attemptId),
      lifecycle: {
        launch_phase: 'launch_confirmed',
        reservation: 'reserved',
        native_owner_epoch: 'fictional-demo-native-owner-epoch',
        release: null,
      },
      id: attemptId,
      task_id: detail.task.id,
      agent_kind: kind,
      role,
      created_at_ms: now,
    };
    detail.attempts.push(attempt);
    outputs.set(attemptId, 'Offline demo: this assistant has not received an instruction.');
    return attempt;
  }
  const review = seed(DEMO_WORK_IDS.review, 'Demo: review a homepage');
  addAttempt(review, DEMO_WORK_IDS.lead, 'claude', 'lead');
  addAttempt(review, DEMO_WORK_IDS.worker, 'codex', 'worker');
  for (const [resultId, summary] of [
    [DEMO_WORK_IDS.firstResult, 'Demo submission 1: initial homepage proposal.'],
    [DEMO_WORK_IDS.secondResult, 'Demo submission 2: revised homepage proposal.'],
  ]) {
    review.results.push({
      id: resultId,
      task_id: review.task.id,
      attempt_id: DEMO_WORK_IDS.lead,
      summary,
      artifacts: [{ path: 'RESULT.md', sha256: artifactSha256, size_bytes: 69 }],
      evidence: ['Fictional demo review evidence; no build or test ran.'],
      created_at_ms: now,
    });
  }
  const uncertain = seed(DEMO_WORK_IDS.uncertain, 'Demo: delivery not confirmed');
  const uncertainAttempt = addAttempt(uncertain, id(13), 'claude', 'lead');
  operation(uncertain, 'deliver_prompt', uncertainAttempt, 'unconfirmed', 'delivery_unconfirmed');
  const unsupported = seed(DEMO_WORK_IDS.unsupported, 'Demo: unsupported execution');
  operation(unsupported, 'start_attempt', undefined, 'refused', 'capability_unavailable');

  // The native lifecycle sequence is deliberately simulated, never inferred from idle status.
  const lifecycle = seed(DEMO_WORK_IDS.lifecycle, 'Demo: simulated assistant lifecycle');
  const lifecycleLead = addAttempt(lifecycle, DEMO_WORK_IDS.lifecycleLead, 'claude', 'lead');
  operation(lifecycle, 'start_attempt', lifecycleLead);
  outputs.set(lifecycleLead.id, 'Fictional prior assistant output. No real assistant ran.');
  lifecycle.results.push({
    id: DEMO_WORK_IDS.lifecycleResult,
    task_id: lifecycle.task.id,
    attempt_id: lifecycleLead.id,
    summary: 'Fictional prior result retained after simulated exit.',
    artifacts: [],
    evidence: ['Simulated offline lifecycle; not proof of native exit or task completion.'],
    created_at_ms: now,
  });

  const childDesign = seed(DEMO_WORK_IDS.childDesign, 'Demo: delegated design');
  const childImplementation = seed(
    DEMO_WORK_IDS.childImplementation,
    'Demo: dependent implementation'
  );
  for (const [child, attemptId] of [
    [childDesign, id(17)],
    [childImplementation, id(18)],
  ] as const) {
    child.task.parent_task_id = review.task.id;
    child.task.delegation = {
      ...parseWorkDelegationState(undefined),
      policy: { ...parseWorkDelegationState(undefined).policy, max_depth: 0 },
    };
    addAttempt(child, attemptId, 'codex', 'lead');
  }
  childImplementation.task.dependencies = [
    { prerequisite_task_id: childDesign.task.id, submission_id: null },
  ];
  for (const [resultId, summary] of [
    [DEMO_WORK_IDS.childFirstResult, 'Fictional child result version one.'],
    [DEMO_WORK_IDS.childSecondResult, 'Fictional child result version two.'],
  ])
    childDesign.results.push({
      id: resultId,
      task_id: childDesign.task.id,
      attempt_id: id(17),
      summary,
      artifacts: [],
      evidence: ['Fictional offline result; no child assistant ran.'],
      created_at_ms: now,
    });

  const error = (code: string, status = 409) => ({ status, body: { error: { code } } });
  return async (record, path, request) => {
    if (!request.isCurrent() || request.signal?.aborted)
      throw new Error('Demo request owner changed');
    if (record.serverId !== DEMO_PAIRING_SERVER_ID) return error('scope_mismatch', 403);
    const url = new URL(path, 'https://demo.invalid');
    const prefix = '/api/sessions/demo';
    if (!url.pathname.startsWith(`${prefix}/`)) return error('scope_mismatch', 403);
    const route = url.pathname.slice(prefix.length);
    const details = [...tasks.values()];
    if (request.method === 'GET' && route === '/agents') {
      return {
        status: 200,
        body: {
          agents: details.flatMap((detail) =>
            detail.attempts.map((attempt) => ({
              id: attempt.target,
              pane_id: attempt.pane_id,
              target: attempt.target,
              instance_id: attempt.instance_id,
              agent: attempt.agent_kind,
              status: 'idle',
            }))
          ),
        },
      };
    }
    const output = route.match(/^\/panes\/([^/]+)\/output$/);
    if (request.method === 'GET' && output) {
      const attempt = details
        .flatMap((detail) => detail.attempts)
        .find((item) => item.pane_id === decodeURIComponent(output[1]));
      return attempt
        ? {
            status: 200,
            body: {
              result: {
                type: 'pane_read',
                read: { output: outputs.get(attempt.id) ?? '', revision: null },
              },
            },
          }
        : error('not_found', 404);
    }
    if (!route.startsWith('/work/')) return error('not_found', 404);
    const segments = route.slice('/work/'.length).split('/');
    if (request.method === 'GET') {
      if (segments[0] === 'receipts') {
        const value = receipts.get(
          `${url.searchParams.get('kind')}:${url.searchParams.get('request_key')}`
        );
        return value ? { status: 200, body: clone(value) } : error('not_found', 404);
      }
      if (segments[0] === 'changes') {
        const after = Number(url.searchParams.get('after') ?? 0);
        return {
          status: 200,
          body: clone({
            changes: changes.filter((item) => item.cursor > after),
            cursor,
            reset_required: false,
          }),
        };
      }
      if (segments[0] === 'operations') {
        const value = details
          .flatMap((detail) => detail.operations)
          .find((item) => item.id === segments[1]);
        return value ? { status: 200, body: clone(value) } : error('not_found', 404);
      }
      if (segments[0] === 'task-summaries' && segments.length === 1) {
        const after = url.searchParams.get('after_id');
        const expectedCursor = url.searchParams.get('snapshot_cursor');
        const limit = Number(url.searchParams.get('limit') ?? 20);
        if (
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 20 ||
          (after && expectedCursor === null)
        )
          return error('invalid_input', 400);
        if (expectedCursor !== null && Number(expectedCursor) !== cursor)
          return error('revision_conflict');
        const eligible = details
          .filter((detail) => !after || detail.task.id > after)
          .sort((a, b) => a.task.id.localeCompare(b.task.id));
        const items: WorkTaskSummary[] = [];
        for (const detail of eligible.slice(0, limit)) {
          const latest = detail.results.at(-1);
          const latestReview = latest
            ? [...detail.reviews].reverse().find((review) => review.submission_id === latest.id)
            : undefined;
          const activity = [...changes]
            .reverse()
            .find((change) => change.task_id === detail.task.id);
          const reserved = detail.attempts.filter(
            (attempt) => attempt.lifecycle?.reservation !== 'released'
          );
          const item: WorkTaskSummary = {
            task_id: detail.task.id,
            session_id: detail.task.session_id,
            parent_task_id: detail.task.parent_task_id,
            task_revision: detail.task.revision,
            title: detail.task.title,
            repo_path: detail.task.repo_path,
            paused: detail.task.paused,
            last_activity: activity
              ? { cursor: activity.cursor, kind: activity.kind, entity_id: activity.entity_id }
              : null,
            reserved_attempts: reserved.length,
            unresolved_native_operations: detail.operations.filter(
              (operation) =>
                ['start_attempt', 'deliver_prompt', 'interrupt_attempt'].includes(operation.kind) &&
                ['prepared', 'submitting', 'unconfirmed'].includes(operation.state) &&
                reserved.some((attempt) => attempt.id === operation.attempt_id)
            ).length,
            unreviewed_results: detail.results.filter(
              (result) => !detail.reviews.some((review) => review.submission_id === result.id)
            ).length,
            latest_result: latest
              ? {
                  submission_id: latest.id,
                  review: latestReview
                    ? { review_id: latestReview.id, decision: latestReview.decision }
                    : null,
                }
              : null,
          };
          const candidate = [...items, item];
          if (
            utf8Bytes(
              JSON.stringify({
                items: candidate,
                snapshot_cursor: cursor,
                next_after_id: item.task_id,
              })
            ).length >
            128 * 1024
          )
            break;
          items.push(item);
        }
        return {
          status: 200,
          body: clone({
            items,
            snapshot_cursor: cursor,
            next_after_id: eligible.length > items.length ? (items.at(-1)?.task_id ?? null) : null,
          }),
        };
      }
      if (segments[0] === 'tasks' && segments.length === 1) {
        const after = url.searchParams.get('after_id');
        const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 50));
        const ordered = details
          .map((detail) => detail.task)
          .sort((a, b) => a.id.localeCompare(b.id));
        const eligible = ordered.filter((task) => !after || task.id > after);
        const selected = eligible.slice(0, limit);
        return {
          status: 200,
          body: clone({
            tasks: selected,
            next_after_id: eligible.length > limit ? selected.at(-1)?.id : null,
          }),
        };
      }
      const detail = tasks.get(segments[1]);
      if (detail && segments[2] === 'results' && segments.length === 4) {
        const result = detail.results.find((item) => item.id === segments[3]);
        return result ? { status: 200, body: clone(result) } : error('not_found', 404);
      }
      return detail && segments.length === 2
        ? { status: 200, body: clone(detail) }
        : error('not_found', 404);
    }
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>;
    if (typeof body.request_key !== 'string' || !body.request_key)
      return error('invalid_input', 400);
    const signature = `${path}:${request.body}`;
    const failed = failedRequests.get(body.request_key);
    if (failed)
      return failed.signature === signature
        ? error(failed.code, failed.status)
        : error('request_key_conflict');
    const earlier = requests.get(body.request_key);
    if (earlier)
      return earlier.signature === signature
        ? { status: 200, body: clone({ value: earlier.value, replayed: true }) }
        : error('request_key_conflict');
    let detail = tasks.get(segments[1]);
    let value: unknown;
    if (segments[0] === 'tasks' && segments.length === 1) {
      const taskId = nextId();
      let inputRefs;
      try {
        inputRefs = (options.inputs ?? demoWorkInputs).freeze(
          (body.input_refs ?? []) as TaskInputRef[],
          String(body.repo_path),
          taskId
        );
      } catch (failure) {
        return error(failure instanceof Error ? failure.message : 'invalid_input');
      }
      detail = seed(taskId, String(body.title));
      Object.assign(detail.task, {
        input_refs: inputRefs,
        repo_path: body.repo_path,
        brief: body.brief,
        parent_task_id: body.parent_task_id,
        policy: clone(body.policy),
      });
      changed(detail, 'task_created', taskId);
      value = detail.task;
    } else {
      if (!detail) return error('not_found', 404);
      if (body.expected_revision !== detail.task.revision) return error('revision_conflict');
      if (segments[2] === 'attempts' && segments.length === 3) {
        if (options.execution === false || detail.task.id === DEMO_WORK_IDS.unsupported)
          return error('capability_unavailable');
        if (detail.task.paused) return error('not_ready');
        const reserved = detail.attempts.filter(
          (attempt) => attempt.lifecycle?.reservation !== 'released'
        );
        if (body.role === 'lead' && reserved.some((attempt) => attempt.role === 'lead'))
          return error('resource_limit');
        if (
          body.role === 'worker' &&
          reserved.filter((attempt) => attempt.role === 'worker').length >=
            detail.task.policy.max_workers
        )
          return error('resource_limit');
        const attempt = addAttempt(
          detail,
          nextId(),
          String(body.agent_kind),
          body.role === 'worker' ? 'worker' : 'lead'
        );
        value = operation(detail, 'start_attempt', attempt);
        changed(detail, 'attempt_started', attempt.id);
      } else if (segments[2] === 'attempts' && segments[4] === 'interruptions') {
        const attempt = detail.attempts.find((item) => item.id === segments[3]);
        if (!attempt) return error('not_found', 404);
        if (options.interruption === false) return error('capability_unavailable');
        if (
          !attempt.instance_id ||
          !attempt.lifecycle?.native_owner_epoch ||
          body.expected_instance_id !== attempt.instance_id ||
          body.expected_native_owner_epoch !== attempt.lifecycle.native_owner_epoch
        )
          return error('instance_changed');
        if (attempt.lifecycle.reservation === 'released') return error('instance_changed');
        if (
          detail.operations.some(
            (item) =>
              item.kind === 'interrupt_attempt' &&
              item.attempt_id === attempt.id &&
              ['prepared', 'submitting', 'unconfirmed'].includes(item.state)
          )
        )
          return error('delivery_unconfirmed');
        const state =
          options.interruptOutcome ??
          (detail.task.id === DEMO_WORK_IDS.uncertain ? 'unconfirmed' : 'acknowledged');
        const op = operation(
          detail,
          'interrupt_attempt',
          attempt,
          state,
          state === 'unconfirmed' ? 'delivery_unconfirmed' : null
        );
        if (state === 'acknowledged')
          op.interruption_receipt = {
            operation_id: op.id,
            launch_id: attempt.instance_id,
            owner_epoch: attempt.lifecycle.native_owner_epoch,
            receipt_id: `fictional-interrupt-${op.id}`,
            key: 'Escape',
            bytes_written: 1,
            input_disposition: 'written',
          };
        // A simulated Escape receipt changes no prompt receipt, output, result, or reservation.
        changed(detail, 'attempt_interruption', op.id);
        value = op;
        receipts.set(`interrupt_attempt:${body.request_key}`, {
          kind: 'interrupt_attempt',
          value: clone(op),
        });
      } else if (segments[2] === 'attempts' && segments[4] === 'reconciliations') {
        const attempt = detail.attempts.find((item) => item.id === segments[3]);
        if (!attempt) return error('not_found', 404);
        if (options.execution === false) return error('capability_unavailable');
        if (
          body.expected_instance_id !== attempt.instance_id ||
          body.expected_native_owner_epoch !== (attempt.lifecycle?.native_owner_epoch ?? null)
        )
          return error('instance_changed');
        const index = lifecycleChecks.get(attempt.id) ?? 0;
        const checks =
          options.lifecycleChecks ??
          (attempt.id === DEMO_WORK_IDS.lifecycleLead ? ['live', 'unknown', 'exited'] : ['live']);
        const check = checks[Math.min(index, checks.length - 1)] ?? 'unknown';
        lifecycleChecks.set(attempt.id, index + 1);
        const op = operation(detail, 'reconcile_attempt', attempt);
        if (check === 'interrupted' || check === 'revision_refused') {
          op.state = check === 'interrupted' ? 'unconfirmed' : 'refused';
          op.failure_code = check === 'interrupted' ? null : 'revision_conflict';
          changed(detail, 'operation_changed', op.id);
          receipts.set(`reconcile_attempt:${body.request_key}`, {
            kind: 'reconcile_attempt',
            value: { receipt_type: 'operation', operation: clone(op) },
          });
          failedRequests.set(body.request_key, {
            signature,
            code: check === 'interrupted' ? 'storage_unavailable' : 'revision_conflict',
            status: check === 'interrupted' ? 503 : 409,
          });
          if (check === 'interrupted') throw new Error('Fictional lifecycle acknowledgement lost');
          return error('revision_conflict');
        }
        const alreadyReleased = attempt.lifecycle?.reservation === 'released';
        if (
          check === 'exited' &&
          !alreadyReleased &&
          attempt.lifecycle?.native_owner_epoch &&
          attempt.instance_id
        ) {
          attempt.lifecycle.reservation = 'released';
          attempt.lifecycle.release = {
            reason: 'owned_process_exited',
            evidence: {
              kind: 'native_exit_tombstone',
              instance_id: attempt.instance_id,
              native_owner_epoch: attempt.lifecycle.native_owner_epoch,
              native_receipt_id: `fictional-exit-${attempt.id}`,
            },
            reconciliation_operation_id: op.id,
            released_at_ms: now + cursor,
          };
        }
        changed(detail, 'attempt_reconciled', op.id);
        value = {
          operation_id: op.id,
          attempt_id: attempt.id,
          observation: alreadyReleased ? 'already_released' : check,
          reservation: attempt.lifecycle?.reservation ?? 'reserved',
          release: attempt.lifecycle?.release ?? null,
          task_revision: detail.task.revision,
        } satisfies WorkReconciliation;
        receipts.set(`reconcile_attempt:${body.request_key}`, {
          kind: 'reconcile_attempt',
          value: { receipt_type: 'reconciliation', receipt: clone(value) },
        });
      } else if (segments[2] === 'attempts' && segments[4] === 'deliveries') {
        const attempt = detail.attempts.find((item) => item.id === segments[3]);
        if (!attempt) return error('not_found', 404);
        if (options.execution === false) return error('capability_unavailable');
        if (attempt.instance_id !== body.expected_instance_id) return error('instance_changed');
        if (attempt.lifecycle?.reservation === 'released') return error('not_ready');
        if (
          detail.operations.some(
            (item) =>
              (['start_attempt', 'deliver_prompt'].includes(item.kind) ||
                (item.kind === 'interrupt_attempt' && item.attempt_id === attempt.id)) &&
              ['prepared', 'submitting', 'unconfirmed'].includes(item.state)
          )
        )
          return error('delivery_unconfirmed');
        let inputRefs;
        try {
          inputRefs = (options.inputs ?? demoWorkInputs).freeze(
            (body.input_refs ?? []) as TaskInputRef[],
            detail.task.repo_path,
            detail.task.id
          );
        } catch (failure) {
          return error(failure instanceof Error ? failure.message : 'invalid_input');
        }
        outputs.set(
          attempt.id,
          `Offline demo instruction acknowledgement: ${String(body.text)}\nNo real assistant ran.`
        );
        value = operation(detail, 'deliver_prompt', attempt);
        (value as WorkOperation).input_refs = inputRefs;
        changed(detail, 'prompt_delivered', (value as WorkOperation).id);
      } else if (segments[2] === 'delegation-config') {
        if (options.delegation === false) return error('capability_unavailable');
        if (detail.task.parent_task_id !== null) return error('scope_mismatch');
        const input = body.input as { policy: unknown; coordinator_attempt_id: string | null };
        const policy = parseWorkDelegationPolicy(input.policy);
        if (policy.enabled) {
          const lead = detail.attempts.find(
            (attempt) => attempt.id === input.coordinator_attempt_id
          );
          if (
            !lead ||
            lead.role !== 'lead' ||
            lead.lifecycle?.launch_phase !== 'launch_confirmed' ||
            lead.lifecycle.reservation !== 'reserved' ||
            !lead.instance_id ||
            !lead.lifecycle.native_owner_epoch
          )
            return error('not_ready');
        }
        detail.task.delegation = {
          policy,
          coordinator_attempt_id: input.coordinator_attempt_id,
          coordinator_epoch: parseWorkDelegationState(detail.task.delegation).coordinator_epoch + 1,
        };
        changed(detail, 'delegation_configured', detail.task.id);
        value = detail.task;
        receipts.set(`configure_delegation:${body.request_key}`, {
          kind: 'configure_delegation',
          value: clone(value),
        });
      } else if (segments[2] === 'dependencies') {
        if (options.delegation === false) return error('capability_unavailable');
        const dependencies = body.dependencies as {
          prerequisite_task_id: string;
          submission_id: string | null;
        }[];
        if (!detail.task.parent_task_id) return error('scope_mismatch');
        for (const dependency of dependencies) {
          const sibling = tasks.get(dependency.prerequisite_task_id);
          if (
            !sibling ||
            sibling.task.id === detail.task.id ||
            sibling.task.parent_task_id !== detail.task.parent_task_id ||
            sibling.task.repo_path !== detail.task.repo_path ||
            (dependency.submission_id !== null &&
              !sibling.results.some((result) => result.id === dependency.submission_id))
          )
            return error('scope_mismatch');
        }
        detail.task.dependencies = clone(dependencies);
        changed(detail, 'dependencies_changed', detail.task.id);
        value = detail.task;
        receipts.set(`set_dependencies:${body.request_key}`, {
          kind: 'set_dependencies',
          value: clone(value),
        });
      } else if (segments[2] === 'delegation') {
        detail.task.paused = body.paused === true;
        changed(detail, 'delegation_changed', detail.task.id);
        value = detail.task;
      } else if (segments[2] === 'reviews') {
        if (!detail.results.some((item) => item.id === body.submission_id))
          return error('not_found', 404);
        const receipt = {
          id: nextId(),
          task_id: detail.task.id,
          actor_id: 'demo-reviewer',
          created_at_ms: now,
          submission_id: String(body.submission_id),
          decision: body.decision,
          message: body.message,
        };
        detail.reviews.push(receipt as WorkDetail['reviews'][number]);
        changed(detail, 'result_reviewed', receipt.id);
        value = receipt;
      } else if (segments[2] === 'results') {
        if (!detail.attempts.some((item) => item.id === body.attempt_id))
          return error('not_found', 404);
        const result: WorkResult = {
          id: nextId(),
          task_id: detail.task.id,
          attempt_id: String(body.attempt_id),
          summary: String(body.summary),
          artifacts: clone(body.artifacts) as WorkResult['artifacts'],
          evidence: clone(body.evidence) as string[],
          created_at_ms: now,
        };
        detail.results.push(result);
        changed(detail, 'result_submitted', result.id);
        value = result;
      } else return error('not_found', 404);
    }
    requests.set(body.request_key, { signature, value: clone(value) });
    return { status: 200, body: clone({ value, replayed: false }) };
  };
}

let transport = createDemoWorkTransport();
export const demoWorkRequest: WorkTransport = (record, path, request) =>
  transport(record, path, request);
export function resetDemoWork() {
  resetDemoWorkInputs();
  transport = createDemoWorkTransport();
}

export const demoWorkArtifact: WorkArtifactTransport = async (
  record,
  path,
  expectedBytes,
  context
) => {
  if (!context.isCurrent() || context.signal?.aborted)
    throw new Error('Demo artifact owner changed');
  const roots = [DEMO_WORK_IDS.firstResult, DEMO_WORK_IDS.secondResult].map(
    (submission) =>
      `/api/sessions/demo/work/tasks/${DEMO_WORK_IDS.review}/results/${submission}/artifacts/0`
  );
  if (record.serverId !== DEMO_PAIRING_SERVER_ID || !roots.includes(path) || expectedBytes !== 69)
    throw new Error('Demo artifact unavailable');
  return new TextEncoder().encode(artifactText);
};
