import { expect, test } from 'bun:test';
import { createDemoWorkTransport, DEMO_WORK_IDS } from '../demo-work';
import { createWorkApi } from '../work-api';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';
import { WorkController } from '../work-controller';
import { selectWorkDependencyVersion } from '../work-dependencies';
const record = {
  serverId: DEMO_PAIRING_SERVER_ID,
  label: 'Demo',
  url: 'https://demo.invalid',
  token: 'demo',
  pairedAt: 0,
};
const context = { isCurrent: () => true };
test('inspecting sibling results retains current task and explicitly pins an older immutable version without starting work', async () => {
  const transport = createDemoWorkTransport();
  const writes: string[] = [];
  const api = createWorkApi(record, 'demo', async (target, path, request) => {
    if (request.method === 'POST') writes.push(path);
    return transport(target, path, request);
  });
  let key = 0;
  const controller = new WorkController(
    api,
    async () => ({ connected: true, records: true, execution: true, delegation: true }),
    () => `dependency-${++key}`
  );
  controller.activate();
  await controller.refresh();
  await controller.selectTask(DEMO_WORK_IDS.childImplementation);
  controller.setDraft('Retain child follow-up');
  const before = controller.getSnapshot();
  const sibling = await controller.inspectRelatedTask(DEMO_WORK_IDS.childDesign);
  expect(sibling?.results).toHaveLength(2);
  expect(controller.getSnapshot().detail).toBe(before.detail);
  const draft = selectWorkDependencyVersion(
    before.detail!.task,
    sibling!,
    DEMO_WORK_IDS.childFirstResult,
    before.detail!.task.dependencies ?? []
  );
  expect(before.detail?.task.dependencies?.[0].submission_id).toBeNull();
  await controller.setDependencies({
    serverId: record.serverId,
    sessionId: 'demo',
    taskId: before.detail!.task.id,
    expected_revision: before.detail!.task.revision,
    dependencies: draft,
  });
  const after = controller.getSnapshot();
  expect(after.detail?.task.id).toBe(before.detail?.task.id);
  expect(after.draft).toBe(before.draft);
  expect(after.detail?.task.dependencies?.[0].submission_id).toBe(DEMO_WORK_IDS.childFirstResult);
  expect(writes).toHaveLength(1);
  expect(writes[0].endsWith('/dependencies')).toBe(true);
  expect(after.detail?.operations).toEqual(before.detail?.operations);
  expect(after.detail?.attempts).toEqual(before.detail?.attempts);
});
test('dependency choices require inspected sibling membership and null remains an explicit blocked reference', async () => {
  const api = createWorkApi(record, 'demo', createDemoWorkTransport());
  const child = await api.detail(DEMO_WORK_IDS.childImplementation, context);
  const sibling = await api.detail(DEMO_WORK_IDS.childDesign, context);
  const foreign = await api.detail(DEMO_WORK_IDS.lifecycle, context);
  expect(selectWorkDependencyVersion(child.task, sibling, null, [])).toEqual([
    { prerequisite_task_id: sibling.task.id, submission_id: null },
  ]);
  expect(() => selectWorkDependencyVersion(child.task, foreign, null, [])).toThrow('Unrelated');
  expect(() =>
    selectWorkDependencyVersion(child.task, sibling, DEMO_WORK_IDS.firstResult, [])
  ).toThrow('not inspected');
  expect(() => selectWorkDependencyVersion(child.task, child, null, [])).toThrow('Unrelated');
});
test('demo configuration receipt retains child tasks/process history on enable and disable', async () => {
  const api = createWorkApi(record, 'demo', createDemoWorkTransport());
  let detail = await api.detail(DEMO_WORK_IDS.review, context);
  const before = structuredClone(detail);
  let epoch = detail.task.delegation!.coordinator_epoch;
  for (const enabled of [true, false]) {
    const config = {
      policy: {
        enabled,
        max_children: 4,
        max_depth: 1 as const,
        dependency_requirement: 'human_accepted' as const,
      },
      coordinator_attempt_id: enabled ? DEMO_WORK_IDS.lead : null,
    };
    const result = await api.configureDelegation(
      detail.task.id,
      config,
      detail.task.revision,
      epoch,
      `configure-${enabled}`,
      context
    );
    expect(result.value.delegation?.policy.enabled).toBe(enabled);
    epoch++;
    detail = await api.detail(detail.task.id, context);
    expect(detail.operations).toEqual(before.operations);
    expect(detail.attempts).toEqual(before.attempts);
    expect((await api.detail(DEMO_WORK_IDS.childDesign, context)).attempts).toHaveLength(1);
  }
});
