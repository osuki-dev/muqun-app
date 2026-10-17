import type { AgentDomainEvent, AgentSessionSnapshot, TimelineItem } from './agent-protocol';

export const DEMO_COMPACTION_LOG_ASIDS = [
  'demo-compaction-log-complete',
  'demo-compaction-log-failed',
  'demo-compaction-log-empty-failed',
] as const;
export const isDemoCompactionLogAsid = (asid: string) =>
  DEMO_COMPACTION_LOG_ASIDS.some((value) => value === asid);
export const DEMO_COMPACTION_RAW_A =
  '# QA_COMPACTION_LOG\r\n\r\nQA_STREAM_HEAD\r\n\r\n' +
  Array.from(
    { length: 30 },
    (_, i) => `Synthetic log paragraph ${i + 1}. 保留原文\t  \r\n\r\n`
  ).join('');
export const DEMO_COMPACTION_RAW_B = 'QA_STREAM_APPEND_B\r\n\r\n';
export const DEMO_COMPACTION_RAW_C = 'QA_STREAM_APPEND_C\r\n\r\n';
export const DEMO_COMPACTION_RAW =
  ' \r\n\t\r\n' + DEMO_COMPACTION_RAW_A + DEMO_COMPACTION_RAW_B + DEMO_COMPACTION_RAW_C;
type Planned = { afterMs: number; event: AgentDomainEvent };

/** Fictional normal protocol data, NOT captured API output/assistant prose.
 * Delays use REAL elapsed runtime; they never advance a clock or the pulse.
 */
export function demoCompactionLogPlan(asid: string): Planned[] {
  if (!isDemoCompactionLogAsid(asid)) throw new Error('Not an exact compaction log fixture');
  const changed = (
    seq: number,
    status: 'started' | 'running' | 'completed' | 'failed',
    delta?: string
  ): AgentDomainEvent => ({
    type: 'agent.compaction.changed',
    asid,
    seq,
    status,
    reason: 'manual',
    ...(delta === undefined ? {} : { delta }),
  });
  const boundary = (
    seq: number,
    revision: number,
    status: 'running' | 'completed',
    summary: string
  ): AgentDomainEvent => ({
    type: 'agent.timeline.upsert',
    asid,
    seq,
    items: [
      {
        id: `${asid}-boundary`,
        message_id: `${asid}-boundary`,
        order: 'demo-compaction-033',
        role: 'assistant',
        ordinal: 0,
        seq: revision,
        updated_ms: revision,
        part: { type: 'compaction', status, reason: 'manual', summary },
      },
    ],
  });
  const empty = asid === 'demo-compaction-log-empty-failed';
  const first: Planned[] = [
    { afterMs: 0, event: changed(33, 'started') },
    { afterMs: 250, event: changed(34, 'running', ' \r\n\t\r\n') },
  ];
  if (empty) return [...first, { afterMs: 4000, event: changed(35, 'failed') }];
  return [
    ...first,
    { afterMs: 8000, event: changed(35, 'running', DEMO_COMPACTION_RAW_A) },
    { afterMs: 18000, event: changed(36, 'running', DEMO_COMPACTION_RAW_B) },
    // Item revision10000 is NOT the compaction-event lastSeq. The following
    // real delta38 must still append; different canonical B must not erase A.
    {
      afterMs: 20000,
      event: boundary(
        37,
        10000,
        'running',
        'Different canonical text — do not replace received raw A+B'
      ),
    },
    { afterMs: 22000, event: changed(38, 'running', DEMO_COMPACTION_RAW_C) },
    { afterMs: 40000, event: changed(39, asid.endsWith('-complete') ? 'completed' : 'failed') },
    ...(asid.endsWith('-complete')
      ? [{ afterMs: 48000, event: boundary(40, 10001, 'completed', DEMO_COMPACTION_RAW) }]
      : []),
  ];
}

type Session = {
  listeners: Set<(event: AgentDomainEvent) => void>;
  timers: Set<ReturnType<typeof setTimeout>>;
  started: boolean;
  seq: number;
  boundary: TimelineItem | null;
};
const sessions = new Map<string, Session>();
function session(asid: string): Session {
  if (!isDemoCompactionLogAsid(asid)) throw new Error('Not an exact compaction log fixture');
  let value = sessions.get(asid);
  if (!value) {
    value = { listeners: new Set(), timers: new Set(), started: false, seq: 32, boundary: null };
    sessions.set(asid, value);
  }
  return value;
}
export function stopDemoCompactionLogs() {
  for (const value of sessions.values()) {
    for (const timer of value.timers) clearTimeout(timer);
    value.timers.clear();
    value.listeners.clear();
  }
  sessions.clear();
}
export function demoCompactionLogSnapshot(
  asid: string,
  base: AgentSessionSnapshot
): AgentSessionSnapshot {
  if (!base.info || base.timeline.length !== 32)
    throw new Error('Expected the unchanged 32-row offline layout fixture');
  const value = session(asid);
  const timeline = base.timeline.map((item) => ({
    ...item,
    id: `${asid}-${item.id}`,
    message_id: `${asid}-${item.message_id}`,
  }));
  if (value.boundary) timeline.push(value.boundary);
  return {
    ...base,
    info: {
      ...base.info,
      asid,
      backend_session_id: asid,
      title: 'Compaction protocol log fixture',
    },
    timeline,
    seq: value.seq,
  };
}
export function subscribeDemoCompactionLog(
  asid: string,
  onEvent: (event: AgentDomainEvent) => void
): () => void {
  const value = session(asid);
  value.listeners.add(onEvent);
  return () => {
    value.listeners.delete(onEvent);
    if (value.listeners.size === 0) {
      for (const timer of value.timers) clearTimeout(timer);
      if (sessions.get(asid) === value) sessions.delete(asid);
    }
  };
}
/** ONE actual existing Context→Compact request starts a finite data stream.
 * Never use repeated Compact requests to fake deltas: they would optimistically
 * reset the actual Workbench activity/animation and invalidate append oracles.
 */
export function startDemoCompactionLog(asid: string) {
  const value = session(asid);
  if (!value.listeners.size || value.started)
    throw new Error('Open a fresh offline log session before Compact');
  value.started = true;
  const send = (event: AgentDomainEvent) => {
    if (sessions.get(asid) !== value || !value.listeners.size) return;
    value.seq = event.seq;
    if (event.type === 'agent.timeline.upsert') value.boundary = event.items[0];
    for (const listener of [...value.listeners]) if (value.listeners.has(listener)) listener(event);
  };
  for (const planned of demoCompactionLogPlan(asid)) {
    if (planned.afterMs === 0) {
      send(planned.event);
      continue;
    }
    const timer = setTimeout(() => {
      value.timers.delete(timer);
      send(planned.event);
    }, planned.afterMs);
    value.timers.add(timer);
  }
}
