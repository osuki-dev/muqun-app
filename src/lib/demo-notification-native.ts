import { useInAppNotifications } from '../stores/in-app-notifications';
import { useServerTasksStore } from '../stores/server-tasks';
import { useAgentPermissionStore } from '../stores/agent-permissions';
import { useGatewayGeneration } from '../stores/gateway-connection-generation';
import { DEMO_PAIRING_SERVER_ID } from './pairing';
import type { InAppNotice, QuestionNoticeIdentity } from './in-app-notifications';
import type {
  AgentDomainEvent,
  AgentSessionSnapshot,
  FormRequest,
  TimelineItem,
} from './agent-protocol';

// Exact offline data ingress only. No renderer props, timers, dismiss/clear,
// clock overrides, gesture callbacks, or mutation of seen/resolution history.
const commands = [
  'begin',
  'one',
  'five',
  'short',
  'long',
  'known',
  'unknown',
  'info',
  'info-clear',
  'fresh',
  'duplicate',
  'observe',
  'reopen',
  'finish',
] as const;
const targets = Array.from({ length: 5 }, (_, i) => `demo-notice-target-${i}`);
export const DEMO_NOTICE_ASIDS: readonly string[] = [
  ...commands.map((c) => `demo-notice-${c}`),
  ...targets,
];
export const isDemoNoticeAsid = (asid: string) => DEMO_NOTICE_ASIDS.includes(asid);
const serverId = DEMO_PAIRING_SERVER_ID;
type Observation = {
  at: number;
  source: string;
  ids: string[];
  seen: string[];
  resolved: string[];
  task: string | null;
  permissionIds: string[];
};
type Segment = { name: string; entries: Observation[]; overflow: boolean };
type Run = {
  namespace: string;
  segments: Segment[];
  receipts: Map<string, InAppNotice>;
  batch: InAppNotice[];
  listeners: Map<(event: AgentDomainEvent) => void, string>;
  stop: (() => void)[];
  reopen: 'idle' | 'resolving' | 'pending-queued' | 'pending' | 'barrier-reopened' | 'cancelled';
  reopenAttempt: number;
  reopenListener?: (event: AgentDomainEvent) => void;
};
let generation = 0,
  sequence = 0;
let run: Run | null = null;
const commandFor = (asid: string) => commands.find((c) => `demo-notice-${c}` === asid);
const callId = (r: Run, asid: string) => `${r.namespace}-${asid}-permission-call`;
const taskId = (r: Run) => `${r.namespace}-task`;
const formFor = (r: Run, asid: string): FormRequest => ({
  id: `${r.namespace}-${asid}-form`,
  asid,
  title: 'QA_NOTICE_FORM_CANONICAL',
  fields: [{ type: 'string', key: 'answer', title: 'Synthetic answer', when: [] }],
});
function questionFor(r: Run): QuestionNoticeIdentity {
  const asid = 'demo-notice-reopen';
  const gatewayGeneration = useGatewayGeneration.getState().byServer[serverId];
  return {
    serverId,
    asid,
    formId: formFor(r, asid).id,
    ...(gatewayGeneration ? { generation: gatewayGeneration } : {}),
  };
}
function observation(r: Run, source: string): Observation {
  const notices = useInAppNotifications.getState();
  return {
    at: Date.now(),
    source,
    ids: notices.items.filter((n) => n.id.startsWith(r.namespace)).map((n) => n.id),
    seen: notices.seen.filter((id) => id.startsWith(r.namespace)),
    resolved: (notices.resolvedQuestions ?? [])
      .filter((q) => q.formId.startsWith(r.namespace))
      .map((q) => q.formId),
    task:
      useServerTasksStore.getState().index[serverId]?.tasks.find((t) => t.taskId === taskId(r))
        ?.state ?? null,
    permissionIds: Object.values(useAgentPermissionStore.getState().byToolCall)
      .filter((p) => p.id.startsWith(r.namespace))
      .map((p) => p.id),
  };
}
function record(r: Run, source: string) {
  const segment = r.segments.at(-1)!;
  if (segment.entries.length < 32) segment.entries.push(observation(r, source));
  else segment.overflow = true; // Never silently evict the before/after record.
}
function report(r: Run, asid: string): string {
  const state = useInAppNotifications.getState(),
    current = observation(r, 'read-only');
  const retained =
    r.receipts.size > 0 && [...r.receipts.keys()].every((id) => state.seen.includes(id));
  const batchIntact =
    r.batch.length > 0 && r.batch.every((n) => state.items.some((item) => item.id === n.id));
  return [
    `QA_NOTICE_READY ${commandFor(asid) ?? asid}`,
    `QA_NOTICE_NAMESPACE ${r.namespace}`,
    `QA_NOTICE_ASID ${asid}`,
    `QA_NOTICE_COUNT ${state.items.length}`,
    `QA_NOTICE_FOREIGN ${state.items.filter((n) => !n.id.startsWith(r.namespace)).length}`,
    `QA_NOTICE_RECEIPTS_RETAINED ${retained ? 'yes' : 'no'}`,
    `QA_NOTICE_BATCH_INTACT ${batchIntact ? 'yes' : 'no'}`,
    `QA_NOTICE_TASK_WAITING ${current.task === 'waiting' ? 'yes' : 'no'}`,
    `QA_NOTICE_PERMISSION_PRESENT ${current.permissionIds.includes(`${callId(r, asid)}-request`) ? 'yes' : 'no'}`,
    `QA_NOTICE_REOPEN ${r.reopen}`,
    `QA_NOTICE_LOG_OVERFLOW ${r.segments.some((s) => s.overflow) ? 'yes' : 'no'}`,
    // Per-case segments are retained for this run; every automatic case saves
    // its native snapshot before navigation. Timestamps are STORE observation,
    // NOT host-effect/timer visibility-start timestamps.
    `QA_NOTICE_SEGMENTS ${r.segments.map((s) => `${s.name}:${s.entries.length}`).join(',')}`,
    JSON.stringify(r.segments.at(-1)),
  ].join('\n\n');
}
function textItem(asid: string, text: string): TimelineItem {
  return {
    id: `${asid}-receipt`,
    message_id: `${asid}-receipt`,
    role: 'assistant',
    ordinal: 0,
    seq: ++sequence,
    updated_ms: Date.now(),
    part: { type: 'text', text },
  };
}
function emitReport(r: Run) {
  for (const [listener, asid] of r.listeners) {
    const item = textItem(asid, report(r, asid));
    listener({ type: 'agent.timeline.upsert', asid, seq: item.seq!, items: [item] });
  }
}
function put(r: Run, key: string, index = 0): InAppNotice {
  const id = `${r.namespace}-${key}-${index}`;
  const existing = r.receipts.get(id);
  if (existing) return existing; // Immutable receipt identity within one run.
  const long =
    Array.from({ length: 80 }, (_, n) => `Fictional context line ${n + 1}`).join('\n') +
    '\nTAIL-CONTEXT-73';
  const notice: InAppNotice = {
    id,
    kind: key === 'info' || key === 'info-clear' ? 'general' : 'approval',
    title: `${key === 'five' || key === 'one' ? 'Needs your input' : 'Approval required'} · Computer ${index + 1}`,
    body:
      key === 'known'
        ? 'edit: /fixture/permission-tail.ts'
        : key === 'unknown'
          ? 'unknown_fixture_rule: /fixture/permission-tail.ts'
          : key === 'long'
            ? long
            : `Synthetic ${key} notice`,
    route:
      key === 'short' || key === 'info' || key === 'info-clear'
        ? null
        : {
            pathname: '/agent',
            params: { server: serverId, asid: targets[index], agentId: 'opencode' },
          },
    ...(key === 'one' || key === 'five'
      ? { question: { serverId, asid: targets[index], formId: formFor(r, targets[index]).id } }
      : {}),
  };
  r.receipts.set(id, notice);
  return notice;
}
export function stopDemoNoticeFixture() {
  if (!run) return;
  for (const stop of run.stop) stop();
  run.listeners.clear();
  run.reopenListener = undefined;
  run = null;
}
/** Normal offline ledger refresh may retain ONLY the actual canonical entry;
 * never regenerate a missing task to conceal an accidental UI deletion. */
export function demoNoticeTasks() {
  const current = run;
  return current
    ? (useServerTasksStore.getState().index[serverId]?.tasks ?? []).filter(
        (task) => task.taskId === taskId(current)
      )
    : [];
}
function startRun(): Run {
  if (useInAppNotifications.getState().items.length)
    throw new Error('Clear existing notices through the real UI before beginning');
  stopDemoNoticeFixture();
  const r: Run = {
    namespace: `notice-${Date.now().toString(36)}-${++generation}`,
    segments: [{ name: 'begin', entries: [], overflow: false }],
    receipts: new Map(),
    batch: [],
    listeners: new Map(),
    stop: [],
    reopen: 'idle',
    reopenAttempt: 0,
  };
  run = r;
  useServerTasksStore.getState().upsert(serverId, {
    taskId: taskId(r),
    kind: 'delegation',
    state: 'waiting',
    goal: 'Fictional pending canonical task',
    binding: { kind: 'agent_session', agentId: 'opencode', asid: targets[0] },
    updatedMs: Date.now(),
  });
  const changed = (source: string) => {
    if (run !== r) return;
    record(r, source);
    const q = questionFor(r),
      state = useInAppNotifications.getState();
    const resolved = state.resolvedQuestions?.some(
      (x) =>
        x.serverId === q.serverId &&
        x.asid === q.asid &&
        x.formId === q.formId &&
        x.generation === q.generation
    );
    if (r.reopen === 'resolving' && resolved && r.reopenListener) {
      r.reopen = 'pending-queued';
      const owner = r.reopenListener,
        attempt = r.reopenAttempt;
      // Resolve's real consumer must return (including its local form removal)
      // before Pending can run. A microtask is normal async data delivery, not
      // a fake clock or a Workbench/renderer hook.
      queueMicrotask(() => {
        if (
          run !== r ||
          r.reopenAttempt !== attempt ||
          r.reopen !== 'pending-queued' ||
          r.reopenListener !== owner ||
          !r.listeners.has(owner)
        )
          return;
        r.reopen = 'pending';
        // Stamp at DELIVERY, after any intervening report events, so normal
        // event-sequence deduplication cannot discard an older queued number.
        owner({
          type: 'agent.form.pending',
          asid: q.asid,
          seq: ++sequence,
          request: formFor(r, q.asid),
        });
      });
    } else if (r.reopen === 'pending' && !resolved && r.reopenListener) {
      // Only the real Workbench's typed FormPending handler can remove this
      // barrier. No direct reopenQuestion/resolve/dismiss call exists here.
      r.reopen = 'barrier-reopened'; // Store fact ONLY, not local UI handler completion.
      const notice = {
        ...put(r, 'reopened'),
        question: q,
        route: {
          pathname: '/agent' as const,
          params: { server: serverId, asid: q.asid, agentId: 'opencode' },
        },
      };
      r.receipts.set(notice.id, notice);
      useInAppNotifications.getState().enqueue(notice);
    }
    emitReport(r);
  };
  r.stop.push(
    useInAppNotifications.subscribe(() => changed('notice-store')),
    useServerTasksStore.subscribe(() => changed('task-store')),
    useAgentPermissionStore.subscribe(() => changed('permission-store'))
  );
  record(r, 'begin');
  return r;
}

/** Snapshot reads never enqueue or start a run; only the exact offline stream
 * activation below injects data, through the same Workbench event boundary.
 */
export function demoNoticeSnapshot(asid: string): AgentSessionSnapshot | null {
  if (!isDemoNoticeAsid(asid)) return null;
  const r = run;
  const timeline: TimelineItem[] = [
    {
      id: `${asid}-original`,
      message_id: `${asid}-original`,
      role: 'user',
      ordinal: 0,
      seq: 1,
      updated_ms: 1,
      part: { type: 'text', text: 'QA_NOTICE_ORIGINAL_MESSAGE' },
    },
  ];
  if (r) timeline.push(textItem(asid, report(r, asid)));
  if (r)
    timeline.push({
      id: callId(r, asid),
      message_id: callId(r, asid),
      role: 'assistant',
      ordinal: 0,
      seq: ++sequence,
      updated_ms: Date.now(),
      part: {
        type: 'tool',
        id: callId(r, asid),
        name: 'read',
        state: 'running',
        input: { filePath: '/fixture/permission-tail.ts' },
        output: '',
        content: [],
        metadata: {},
      },
    });
  return {
    info: {
      asid,
      backend_session_id: asid,
      agent_id: 'opencode',
      model: null,
      updated_ms: 1,
      title: targets.includes(asid)
        ? `Notification target ${targets.indexOf(asid) + 1}`
        : `Notification QA ${commandFor(asid)}`,
      directory: '/demo/notice-native',
      status: 'idle',
    },
    timeline,
    permissions: r
      ? [
          {
            id: `${callId(r, asid)}-request`,
            asid,
            action: 'edit',
            resources: ['/fixture/permission-tail.ts'],
            save: [],
            prompt: 'Synthetic pending permission',
            options: [],
            source_tool_call_id: callId(r, asid),
          },
        ]
      : [],
    forms: r ? [formFor(r, asid)] : [],
    inbox: [],
    seq: sequence,
  };
}

export function subscribeDemoNotice(
  asid: string,
  listener: (event: AgentDomainEvent) => void
): () => void {
  if (!isDemoNoticeAsid(asid)) throw new Error('Not an exact offline notice fixture');
  try {
    const command = commandFor(asid);
    const r = command === 'begin' ? startRun() : run;
    if (!r) throw new Error('Open demo-notice-begin first');
    r.listeners.set(listener, asid);
    if (command && !['begin', 'observe', 'finish'].includes(command)) {
      if (r.segments.length >= 16) throw new Error('Save receipts and begin a new fixture run');
      r.segments.push({ name: command, entries: [], overflow: false });
      record(r, 'case-enter');
      if (command === 'duplicate') {
        for (const notice of r.batch) useInAppNotifications.getState().enqueue(notice);
      } else if (command === 'reopen') {
        r.reopenAttempt++;
        r.reopen = 'resolving';
        r.reopenListener = listener;
        listener({
          type: 'agent.form.resolved',
          asid,
          seq: ++sequence,
          form_id: formFor(r, asid).id,
          reason: 'answered',
        });
      } else {
        r.batch = Array.from({ length: command === 'five' ? 5 : 1 }, (_, index) =>
          put(r, command, index)
        );
        for (const notice of r.batch) useInAppNotifications.getState().enqueue(notice);
      }
    }
    emitReport(r);
    if (command === 'finish') stopDemoNoticeFixture();
    return () => {
      r.listeners.delete(listener);
      if (r.reopenListener === listener) {
        r.reopenAttempt++;
        r.reopenListener = undefined;
        if (r.reopen !== 'barrier-reopened') r.reopen = 'cancelled';
      }
    };
  } catch (error) {
    run?.listeners.delete(listener);
    if (run?.reopenListener === listener) {
      run.reopenAttempt++;
      run.reopenListener = undefined;
      if (run.reopen !== 'barrier-reopened') run.reopen = 'cancelled';
    }
    const item = textItem(asid, `QA_NOTICE_ERROR ${String(error)}`);
    listener({ type: 'agent.timeline.upsert', asid, seq: item.seq!, items: [item] });
    return () => {};
  }
}
