import { expect, test } from 'bun:test';
import {
  demoNoticeSnapshot,
  demoNoticeTasks,
  isDemoNoticeAsid,
  stopDemoNoticeFixture,
  subscribeDemoNotice,
} from '../demo-notification-native';
import { useInAppNotifications } from '../../stores/in-app-notifications';
import { useServerTasksStore } from '../../stores/server-tasks';
import { useAgentPermissionStore } from '../../stores/agent-permissions';
import { useGatewayGeneration } from '../../stores/gateway-connection-generation';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';
import type { AgentDomainEvent } from '../agent-protocol';

// Actual Zustand stores/reducers only: no React render, effect, timer, keyboard,
// native input or tool mock. These tests do NOT replace any native/old VM gate.
async function isolated(check: () => void | Promise<void>) {
  const notices = useInAppNotifications.getState(),
    tasks = useServerTasksStore.getState(),
    permissions = useAgentPermissionStore.getState();
  stopDemoNoticeFixture();
  useInAppNotifications.setState({ items: [], seen: [], resolvedQuestions: [] });
  try {
    await check();
  } finally {
    stopDemoNoticeFixture();
    useInAppNotifications.setState(notices, true);
    useServerTasksStore.setState(tasks, true);
    useAgentPermissionStore.setState(permissions, true);
  }
}
const report = (asid = 'demo-notice-observe') =>
  demoNoticeSnapshot(asid)!
    .timeline.flatMap((item) =>
      item.part.type === 'text' && item.role === 'assistant' ? [item.part.text] : []
    )
    .join('\n');
const begin = () => subscribeDemoNotice('demo-notice-begin', () => {});

test('exact isolated ASIDs only; snapshot reads/observe never enqueue', () =>
  isolated(() => {
    for (const asid of [
      'demo-native-preview',
      'demo-compaction-layout',
      'demo-notice-one-extra',
      'live-agent',
    ]) {
      expect(isDemoNoticeAsid(asid)).toBe(false);
      expect(demoNoticeSnapshot(asid)).toBeNull();
    }
    const original = useInAppNotifications.getState();
    expect(demoNoticeSnapshot('demo-notice-one')).not.toBeNull();
    expect(useInAppNotifications.getState()).toBe(original);
    begin();
    const before = useInAppNotifications.getState();
    demoNoticeSnapshot('demo-notice-five');
    subscribeDemoNotice('demo-notice-observe', () => {});
    expect(useInAppNotifications.getState()).toBe(before);
  }));

test('each activation run has new IDs; same-run duplicates use original fixed receipts and retain seen', () =>
  isolated(() => {
    begin();
    subscribeDemoNotice('demo-notice-one', () => {});
    const old = useInAppNotifications.getState().items[0];
    expect(old.question?.asid).toBe('demo-notice-target-0');
    expect(old.id.startsWith('notice-')).toBe(true);
    useInAppNotifications.getState().clear(); // pure store contract, NOT native Clear all evidence
    const seen = useInAppNotifications.getState().seen;
    subscribeDemoNotice('demo-notice-duplicate', () => {});
    expect(useInAppNotifications.getState().items).toEqual([]);
    expect(useInAppNotifications.getState().seen).toBe(seen);
    expect(report()).toContain('QA_NOTICE_RECEIPTS_RETAINED yes');
    begin();
    subscribeDemoNotice('demo-notice-one', () => {});
    const fresh = useInAppNotifications.getState().items[0];
    expect(fresh.id).not.toBe(old.id);
    expect(useInAppNotifications.getState().seen).toContain(old.id);
    expect(useInAppNotifications.getState().seen).toContain(fresh.id);
  }));

test('fixture never clears an occupied queue or seen history to start a run', () =>
  isolated(() => {
    useInAppNotifications.getState().enqueue({
      id: 'unrelated-existing',
      title: 'Existing',
      body: '',
      route: null,
      kind: 'approval',
    });
    const before = useInAppNotifications.getState();
    const events: AgentDomainEvent[] = [];
    subscribeDemoNotice('demo-notice-begin', (event) => events.push(event));
    expect(useInAppNotifications.getState()).toBe(before);
    expect(
      events.some(
        (e) =>
          e.type === 'agent.timeline.upsert' &&
          e.items.some(
            (item) => item.part.type === 'text' && item.part.text.includes('QA_NOTICE_ERROR')
          )
      )
    ).toBe(true);
  }));

test('five actual distinct original routes and canonical task survive actual store Clear all', () =>
  isolated(() => {
    begin();
    subscribeDemoNotice('demo-notice-five', () => {});
    const before = useInAppNotifications.getState().items;
    expect(before).toHaveLength(5);
    expect(new Set(before.map((n) => n.id)).size).toBe(5);
    expect(before.map((n) => typeof n.route === 'object' && n.route?.params.asid)).toEqual(
      Array.from({ length: 5 }, (_, i) => `demo-notice-target-${i}`)
    );
    const task = demoNoticeTasks()[0];
    useInAppNotifications.getState().clear();
    expect(
      useServerTasksStore
        .getState()
        .index[DEMO_PAIRING_SERVER_ID].tasks.find((t) => t.taskId === task.taskId)
    ).toBe(task);
    expect(task.state).toBe('waiting');
    expect(report()).toContain('QA_NOTICE_TASK_WAITING yes');
  }));

test('case-segmented actual transition receipts retain before/after; overflow is explicit, never silent eviction', () =>
  isolated(() => {
    begin();
    subscribeDemoNotice('demo-notice-one', () => {});
    const id = useInAppNotifications.getState().items[0].id;
    useInAppNotifications.getState().clear();
    const saved = report();
    const segment = JSON.parse(saved.split('\n\n').at(-1)!);
    expect(segment.name).toBe('one');
    expect(segment.entries.some((e: { ids: string[] }) => e.ids.includes(id))).toBe(true);
    expect(segment.entries.at(-1).ids).toEqual([]);
    subscribeDemoNotice('demo-notice-duplicate', () => {});
    expect(saved).toContain(id); // external native flow likewise saves BEFORE next case navigation
    expect(report()).toContain('one:');
    for (let i = 0; i < 40; i++)
      useInAppNotifications.getState().enqueue({
        id: `external-${i}`,
        title: 'External test-store observation',
        body: '',
        route: null,
        kind: 'approval',
      });
    expect(report()).toContain('QA_NOTICE_LOG_OVERFLOW yes');
    expect(JSON.parse(report().split('\n\n').at(-1)!).entries).toHaveLength(32);
  }));

test('authoritative reopen emits genuine typed events and waits for their real consumer; no direct unsee/fresh substitute', () =>
  isolated(async () => {
    begin();
    const events: AgentDomainEvent[] = [];
    const stop = subscribeDemoNotice('demo-notice-reopen', (event) => events.push(event));
    const resolved = events.find((e) => e.type === 'agent.form.resolved');
    expect(resolved?.type).toBe('agent.form.resolved');
    expect(events.some((e) => e.type === 'agent.form.pending')).toBe(false);
    expect(useInAppNotifications.getState().items).toEqual([]);
    // Exercise real reducer boundary ONLY, not a mock Workbench effect. Actual
    // typed handler/native form/complete pipeline remains required in full flow.
    if (resolved?.type !== 'agent.form.resolved') throw new Error('Missing actual typed data');
    const gatewayGeneration = useGatewayGeneration.getState().byServer[DEMO_PAIRING_SERVER_ID];
    useInAppNotifications.getState().resolveQuestion({
      serverId: DEMO_PAIRING_SERVER_ID,
      asid: resolved.asid,
      formId: resolved.form_id,
      ...(gatewayGeneration ? { generation: gatewayGeneration } : {}),
    });
    await Promise.resolve();
    const pending = events.find((e) => e.type === 'agent.form.pending');
    expect(pending?.type).toBe('agent.form.pending');
    expect(useInAppNotifications.getState().items).toEqual([]);
    expect(
      useInAppNotifications.getState().resolvedQuestions?.some((q) => q.formId === resolved.form_id)
    ).toBe(true);
    expect(report()).toContain('QA_NOTICE_REOPEN pending');
    stop(); // cancellation cannot enqueue a late fixture receipt
    useInAppNotifications.getState().reopenQuestion({
      serverId: DEMO_PAIRING_SERVER_ID,
      asid: resolved.asid,
      formId: resolved.form_id,
      ...(gatewayGeneration ? { generation: gatewayGeneration } : {}),
    });
    expect(useInAppNotifications.getState().items).toEqual([]);
  }));

test('teardown removes observers without clearing canonical queue/seen or inventing timer progress', () =>
  isolated(() => {
    begin();
    subscribeDemoNotice('demo-notice-info', () => {});
    const before = useInAppNotifications.getState();
    stopDemoNoticeFixture();
    expect(useInAppNotifications.getState()).toBe(before);
    expect(demoNoticeSnapshot('demo-notice-observe')!.timeline).toHaveLength(1);
  }));

const resolvedQuestion = (event: Extract<AgentDomainEvent, { type: 'agent.form.resolved' }>) => {
  const generation = useGatewayGeneration.getState().byServer[DEMO_PAIRING_SERVER_ID];
  return {
    serverId: DEMO_PAIRING_SERVER_ID,
    asid: event.asid,
    formId: event.form_id,
    ...(generation ? { generation } : {}),
  };
};

test('reentrancy regression: pending is delivered only after the resolving consumer stack returns', () =>
  isolated(async () => {
    begin();
    const order: string[] = [];
    const stop = subscribeDemoNotice('demo-notice-reopen', (event) => {
      if (event.type === 'agent.form.resolved') {
        order.push('resolved-enter');
        useInAppNotifications.getState().resolveQuestion(resolvedQuestion(event));
        order.push('resolved-return');
      } else if (event.type === 'agent.form.pending') order.push('pending-delivered');
    });
    try {
      expect(order).toEqual(['resolved-enter', 'resolved-return']);
      await Promise.resolve(); // actual JS task boundary, no fake timer/Workbench effect
      expect(order).toEqual(['resolved-enter', 'resolved-return', 'pending-delivered']);
      expect(useInAppNotifications.getState().items).toEqual([]); // no consumer barrier transition yet
    } finally {
      stop();
    }
  }));

test('reentrancy regression: consumer cancellation drops queued pending and cannot enqueue a late receipt', () =>
  isolated(async () => {
    begin();
    let pending = 0;
    const stop = subscribeDemoNotice('demo-notice-reopen', (event) => {
      if (event.type === 'agent.form.resolved')
        useInAppNotifications.getState().resolveQuestion(resolvedQuestion(event));
      if (event.type === 'agent.form.pending') pending++;
    });
    stop();
    await Promise.resolve();
    expect(pending).toBe(0);
    expect(useInAppNotifications.getState().items).toEqual([]);
  }));

test('reentrancy regression: replacing a cancelled attempt with the SAME callback cannot deliver its old pending', () =>
  isolated(async () => {
    begin();
    let pending = 0;
    const consumer = (event: AgentDomainEvent) => {
      if (event.type === 'agent.form.resolved')
        useInAppNotifications.getState().resolveQuestion(resolvedQuestion(event));
      if (event.type === 'agent.form.pending') pending++;
    };
    subscribeDemoNotice('demo-notice-reopen', consumer)();
    const stop = subscribeDemoNotice('demo-notice-reopen', consumer);
    try {
      await Promise.resolve();
      expect(pending).toBe(1);
      expect(useInAppNotifications.getState().items).toEqual([]);
    } finally {
      stop();
    }
  }));

test('reentrancy regression: a new run invalidates the old queued delivery', () =>
  isolated(async () => {
    begin();
    let oldPending = 0;
    subscribeDemoNotice('demo-notice-reopen', (event) => {
      if (event.type === 'agent.form.resolved')
        useInAppNotifications.getState().resolveQuestion(resolvedQuestion(event));
      if (event.type === 'agent.form.pending') oldPending++;
    });
    begin(); // same actual empty queue, NEW namespace/run, no seen reset
    await Promise.resolve();
    expect(oldPending).toBe(0);
    expect(useInAppNotifications.getState().items).toEqual([]);
  }));

test('reentrancy regression: barrier receipt does not claim the pending consumer/UI handler has completed', () =>
  isolated(async () => {
    begin();
    let pendingReturned = false,
      barrierObservedBeforeReturn = false;
    const stop = subscribeDemoNotice('demo-notice-reopen', (event) => {
      if (event.type === 'agent.form.resolved')
        useInAppNotifications.getState().resolveQuestion(resolvedQuestion(event));
      if (event.type === 'agent.form.pending') {
        const generation = useGatewayGeneration.getState().byServer[DEMO_PAIRING_SERVER_ID];
        useInAppNotifications.getState().reopenQuestion({
          serverId: DEMO_PAIRING_SERVER_ID,
          asid: event.asid,
          formId: event.request.id,
          ...(generation ? { generation } : {}),
        });
        pendingReturned = true;
      }
      if (
        event.type === 'agent.timeline.upsert' &&
        !pendingReturned &&
        event.items.some(
          (item) =>
            item.part.type === 'text' &&
            item.part.text.includes('QA_NOTICE_REOPEN barrier-reopened')
        )
      )
        barrierObservedBeforeReturn = true;
    });
    try {
      await Promise.resolve();
      expect(pendingReturned).toBe(true);
      expect(barrierObservedBeforeReturn).toBe(true);
      expect(report()).toContain('QA_NOTICE_REOPEN barrier-reopened');
      expect(report().includes('typed-complete')).toBe(false);
      // Pure store transition only; native same-Workbench canonical form remains
      // required, never represented by a fake forms array or handler simulation.
    } finally {
      stop();
    }
  }));
