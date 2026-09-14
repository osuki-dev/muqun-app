import { expect, test } from 'bun:test';
import {
  captureWorkDelegationIntent,
  confirmedDelegationLead,
  parseWorkDelegationState,
} from '../work-delegation';
import { createDemoWorkTransport, DEMO_WORK_IDS } from '../demo-work';
import { createWorkApi } from '../work-api';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';
const availability = { connected: true, capable: true, pending: false, historyComplete: true };
async function fixture() {
  const api = createWorkApi(
    {
      serverId: DEMO_PAIRING_SERVER_ID,
      label: 'Demo',
      url: 'https://demo.invalid',
      token: 'demo',
      pairedAt: 0,
    },
    'demo',
    createDemoWorkTransport()
  );
  const detail = await api.detail(DEMO_WORK_IDS.review, { isCurrent: () => true });
  return {
    serverId: DEMO_PAIRING_SERVER_ID,
    task: detail.task,
    attempts: detail.attempts,
    availability,
    enabled: true,
    maxChildren: '4',
    requirement: 'human_accepted' as const,
    selectedLead: confirmedDelegationLead(detail.task, detail.attempts[0]),
  };
}
test('delegation wire state defaults old records without accepting invalid scope or bounds', () => {
  expect(parseWorkDelegationState(undefined).policy.enabled).toBe(false);
  const valid = {
    policy: {
      enabled: true,
      max_children: 64,
      max_depth: 1,
      dependency_requirement: 'human_accepted',
    },
    coordinator_attempt_id: DEMO_WORK_IDS.lead,
    coordinator_epoch: 2,
  } as const;
  expect(parseWorkDelegationState(valid)).toEqual(valid);
  for (const patch of [
    { max_children: 65 },
    { max_children: -1 },
    { max_children: 1.5 },
    { max_depth: 2 },
    { dependency_requirement: 'idle' },
  ])
    expect(() =>
      parseWorkDelegationState({ ...valid, policy: { ...valid.policy, ...patch } })
    ).toThrow();
  expect(() => parseWorkDelegationState({ ...valid, coordinator_attempt_id: null })).toThrow();
});
test('enable captures exact explicitly chosen confirmed lead, revision and policy without mutating records', async () => {
  const args = await fixture();
  const before = JSON.stringify(args);
  const result = captureWorkDelegationIntent(args);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected configuration');
  expect(result.intent).toMatchObject({
    serverId: DEMO_PAIRING_SERVER_ID,
    taskId: args.task.id,
    expected_revision: args.task.revision,
    coordinator: args.selectedLead,
    input: {
      policy: {
        enabled: true,
        max_children: 4,
        max_depth: 1,
        dependency_requirement: 'human_accepted',
      },
      coordinator_attempt_id: DEMO_WORK_IDS.lead,
    },
  });
  expect(JSON.stringify(args)).toBe(before);
  result.intent.input.policy.max_children = 0;
  expect(args.maxChildren).toBe('4');
  expect(captureWorkDelegationIntent({ ...args, selectedLead: null })).toEqual({
    ok: false,
    problem: 'lead_required',
  });
  for (const field of ['instanceId', 'nativeOwnerEpoch', 'taskId'] as const)
    expect(
      captureWorkDelegationIntent({
        ...args,
        selectedLead: { ...args.selectedLead!, [field]: 'replaced' },
      })
    ).toEqual({ ok: false, problem: 'lead_changed' });
});
test('children cannot redelegate and worker/released/unconfirmed identities are not coordinator choices', async () => {
  const args = await fixture();
  expect(confirmedDelegationLead(args.task, args.attempts[1])).toBeNull();
  const lead = args.attempts[0];
  expect(
    confirmedDelegationLead(args.task, {
      ...lead,
      lifecycle: { ...lead.lifecycle!, reservation: 'released' },
    })
  ).toBeNull();
  expect(
    confirmedDelegationLead(args.task, {
      ...lead,
      lifecycle: { ...lead.lifecycle!, launch_phase: 'legacy_unknown' },
    })
  ).toBeNull();
  expect(
    captureWorkDelegationIntent({
      ...args,
      task: { ...args.task, parent_task_id: DEMO_WORK_IDS.uncertain },
    })
  ).toEqual({ ok: false, problem: 'child_task' });
});
test('offline/capability/pending/history guards fence config and zero/64 remain valid child limits', async () => {
  const args = await fixture();
  for (const [patch, problem] of [
    [{ connected: false }, 'offline'],
    [{ capable: false }, 'unavailable'],
    [{ pending: true }, 'pending'],
    [{ historyComplete: false }, 'history_incomplete'],
  ] as const)
    expect(
      captureWorkDelegationIntent({ ...args, availability: { ...availability, ...patch } })
    ).toEqual({ ok: false, problem });
  for (const maxChildren of ['0', '64'])
    expect(captureWorkDelegationIntent({ ...args, maxChildren }).ok).toBe(true);
  for (const maxChildren of ['', '-1', '65', '4.5', '1e1', ' 1', '01'])
    expect(captureWorkDelegationIntent({ ...args, maxChildren })).toEqual({
      ok: false,
      problem: 'invalid_limit',
    });
  const disabled = captureWorkDelegationIntent({ ...args, enabled: false, selectedLead: null });
  expect(disabled.ok && disabled.intent.input.coordinator_attempt_id).toBeNull();
  expect(disabled.ok && disabled.intent.input.policy.enabled).toBe(false);
});

test('disabling a saved root policy needs no complete attempt history or selected lead', async () => {
  const args = await fixture();
  const incomplete = {
    ...args,
    availability: { ...availability, historyComplete: false },
    selectedLead: null,
  };
  expect(captureWorkDelegationIntent({ ...incomplete, enabled: true })).toEqual({
    ok: false,
    problem: 'history_incomplete',
  });
  const disabled = captureWorkDelegationIntent({ ...incomplete, enabled: false });
  expect(disabled.ok && disabled.intent.input.policy.enabled).toBe(false);
  expect(disabled.ok && disabled.intent.coordinator).toBeNull();
});
