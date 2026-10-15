import { expect, test } from 'bun:test';
import {
  parseAgentDomainEvent,
  type AgentDomainEvent,
  type AgentSessionSnapshot,
} from '../agent-protocol';
import {
  applyCompactionEvent,
  reconcileCompactionTimeline,
  type CompactionActivity,
} from '../agent-compaction';
import {
  DEMO_COMPACTION_LOG_ASIDS,
  DEMO_COMPACTION_RAW,
  demoCompactionLogPlan,
  demoCompactionLogSnapshot,
  isDemoCompactionLogAsid,
  startDemoCompactionLog,
  stopDemoCompactionLogs,
  subscribeDemoCompactionLog,
} from '../demo-compaction-log-native';

const base = (): AgentSessionSnapshot => ({
  info: {
    asid: 'demo-compaction-layout',
    backend_session_id: 'demo-compaction-layout',
    agent_id: 'opencode',
    model: null,
    status: 'busy',
    title: 'Layout sample',
    updated_ms: 1,
  },
  timeline: Array.from({ length: 32 }, (_, i) => ({
    id: `history-${i}`,
    message_id: `history-${i}`,
    role: 'assistant',
    ordinal: 0,
    seq: i + 1,
    updated_ms: 1,
    part: { type: 'text', text: i === 31 ? 'DEMO_COMPACTION_TAIL' : `Fixed paragraph ${i + 1}` },
  })),
  permissions: [],
  forms: [],
  inbox: [],
  seq: 32,
});

test('exact independent ASIDs/snapshot cloning preserve original 32 rows and event cursor', () => {
  const original = base(),
    saved = structuredClone(original);
  for (const asid of DEMO_COMPACTION_LOG_ASIDS) {
    const snapshot = demoCompactionLogSnapshot(asid, original);
    expect(snapshot.timeline).toHaveLength(32);
    expect(snapshot.info?.asid).toBe(asid);
    expect(snapshot.timeline[31].part).toEqual(original.timeline[31].part);
    expect(snapshot.seq).toBe(32);
  }
  expect(original).toEqual(saved);
  expect(isDemoCompactionLogAsid('demo-compaction-layout')).toBe(false);
  expect(isDemoCompactionLogAsid('demo-compaction-log-complete-extra')).toBe(false);
  expect(() => demoCompactionLogPlan('live-session')).toThrow();
  stopDemoCompactionLogs();
});

test('normal wire parser + real r2 reducer retain raw A/B/C across newer timeline revision, then matching handoff', () => {
  let current: CompactionActivity | null = null;
  for (const planned of demoCompactionLogPlan('demo-compaction-log-complete')) {
    const event = parseAgentDomainEvent(planned.event.type, planned.event);
    expect(event).not.toBeNull();
    if (!event) throw new Error('Malformed fixture event');
    if (event.type === 'agent.compaction.changed') current = applyCompactionEvent(current, event);
    if (event.type === 'agent.timeline.upsert') {
      const before = current;
      current = reconcileCompactionTimeline(current, event.items, event.asid);
      if (event.seq === 37) {
        expect(event.items[0].seq).toBe(10000);
        expect(current).toBe(before);
        expect(current?.lastSeq).toBe(36); // item revision is NOT compaction event watermark
      }
    }
    if (event.seq === 38) {
      expect(current?.lastSeq).toBe(38);
      expect(current?.summary).toBe(DEMO_COMPACTION_RAW);
    }
    if (event.seq === 39) {
      expect(current?.status).toBe('completed');
      expect(current?.summary).toBe(DEMO_COMPACTION_RAW);
    }
  }
  expect(current).toBeNull();
});

test('failed with/without log uses typed compaction only, never assistant text as summary', () => {
  for (const asid of ['demo-compaction-log-failed', 'demo-compaction-log-empty-failed']) {
    let current: CompactionActivity | null = null;
    for (const { event } of demoCompactionLogPlan(asid)) {
      if (event.type === 'agent.compaction.changed') current = applyCompactionEvent(current, event);
      else if (event.type === 'agent.timeline.upsert')
        current = reconcileCompactionTimeline(current, event.items, asid);
      else throw new Error('Unexpected non-compaction data');
    }
    expect(current?.status).toBe('failed');
    expect(current?.summary.trim().length === 0).toBe(asid.endsWith('-empty-failed'));
    if (!asid.endsWith('-empty-failed')) expect(current?.summary).toBe(DEMO_COMPACTION_RAW);
  }
});

test('actual elapsed producer timer delivers whitespace, once-only start and unsubscribe cancel remaining data', async () => {
  stopDemoCompactionLogs();
  const asid = 'demo-compaction-log-complete',
    first: AgentDomainEvent[] = [],
    second: AgentDomainEvent[] = [];
  const stopFirst = subscribeDemoCompactionLog(asid, (e) => first.push(e));
  const stopSecond = subscribeDemoCompactionLog(asid, (e) => second.push(e));
  try {
    startDemoCompactionLog(asid);
    expect(() => startDemoCompactionLog(asid)).toThrow('fresh offline log session');
    expect(first.map((e) => e.seq)).toEqual([33]);
    stopFirst();
    await new Promise((resolve) => setTimeout(resolve, 400)); // REAL time, no fake clock
    expect(first.map((e) => e.seq)).toEqual([33]);
    expect(second.map((e) => e.seq)).toEqual([33, 34]);
    expect(demoCompactionLogSnapshot(asid, base()).seq).toBe(34);
    stopSecond();
    expect(demoCompactionLogSnapshot(asid, base()).seq).toBe(32);
    expect(() => startDemoCompactionLog(asid)).toThrow('fresh offline log session');
  } finally {
    stopFirst();
    stopSecond();
    stopDemoCompactionLogs();
  }
});

test('immediate owner cancellation leaves no delayed whitespace callback (actual runtime wait)', async () => {
  const events: AgentDomainEvent[] = [],
    asid = 'demo-compaction-log-failed';
  const stop = subscribeDemoCompactionLog(asid, (event) => events.push(event));
  startDemoCompactionLog(asid);
  stop();
  try {
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(events.map((e) => e.seq)).toEqual([33]);
  } finally {
    stopDemoCompactionLogs();
  }
});
