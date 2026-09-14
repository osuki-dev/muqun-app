import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createDemoWorkInputs, pickDemoWorkInput } from '../demo-work-inputs';
import { createDemoWorkTransport } from '../demo-work';
import { createWorkApi } from '../work-api';
import { TaskInputUploadJournal, taskInputRefs } from '../task-inputs';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';
const record = {
  serverId: DEMO_PAIRING_SERVER_ID,
  label: 'Demo',
  url: 'https://demo.invalid',
  token: 'demo',
  pairedAt: 0,
};
const scope = { sessionId: 'demo', project: '/demo/homepage', draftId: 'fictional-input-draft' };
const context = { isCurrent: () => true };
async function refused(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected refusal');
}
const input = {
  repo_path: scope.project,
  title: 'Fictional input task',
  brief: 'No real assistant runs',
  parent_task_id: null,
  policy: { allowed_agents: ['codex'], max_workers: 1 },
};

describe('explicit fictional managed inputs (no real picker/upload proof)', () => {
  test('bundled receipt matches bytes and exact key replay is scoped/read only', async () => {
    const fixtures = createDemoWorkInputs();
    const [file] = await pickDemoWorkInput('library');
    const receipt = await fixtures.upload(record, scope, 'upload', file, context);
    const bytes = Buffer.from(file.uri.split(',')[1], 'base64');
    expect(receipt.size_bytes).toBe(bytes.length);
    expect(receipt.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await fixtures.upload(record, scope, 'upload', file, context)).toEqual(receipt);
    expect(await fixtures.read(record, scope, 'upload', context)).toEqual(receipt);
    expect(await fixtures.read(record, scope, 'missing', context)).toBeNull();
    await expect(
      fixtures.upload(record, { ...scope, project: '/other' }, 'upload', file, context)
    ).rejects.toThrow('request_key_conflict');
    await expect(
      fixtures.read({ ...record, serverId: 'real' }, scope, 'upload', context)
    ).rejects.toThrow('scope mismatch');
    await expect(
      fixtures.upload(
        record,
        scope,
        'local-file',
        { ...file, uri: 'file:///private/device/image.gif' },
        context
      )
    ).rejects.toThrow('Only bundled fictional');
    await expect(
      fixtures.upload(record, scope, 'stale', file, { isCurrent: () => false })
    ).rejects.toThrow('owner changed');
  });

  test('expired receipt remains expired on read/retry; explicit renewal creates a fresh handle', async () => {
    const fixtures = createDemoWorkInputs();
    const [file] = await pickDemoWorkInput('file');
    let key = 0;
    const journal = new TaskInputUploadJournal(
      () => `upload-${++key}`,
      fixtures.upload,
      fixtures.read
    );
    await expect(journal.run('tile', record, scope, file, context)).rejects.toThrow('expired');
    const expired = journal.receipt('tile')!;
    await expect(journal.run('tile', record, scope, file, context)).rejects.toThrow('expired');
    expect(key).toBe(1);
    expect(journal.receipt('tile')).toEqual(expired);
    expect(journal.renewExpired('tile')).toBe(true);
    const renewed = await journal.run('tile', record, scope, file, context);
    expect(renewed.input_id).not.toBe(expired.input_id);
    expect(taskInputRefs([renewed], scope)).toHaveLength(1);
    expect(key).toBe(2);
    journal.remove('tile');
    expect(journal.receipt('tile')).toBeUndefined();
    expect(await fixtures.read(record, scope, 'upload-2', context)).toEqual(renewed);
  });

  test('create and independent delivery freeze exact ordered captions/use and reject expired or other-task claims', async () => {
    const fixtures = createDemoWorkInputs();
    const api = createWorkApi(record, 'demo', createDemoWorkTransport({ inputs: fixtures }));
    const [file] = await pickDemoWorkInput('library');
    const first = await fixtures.upload(record, scope, 'first', file, context);
    const refs = [
      {
        input_id: first.input_id,
        caption: 'Fictional "layout"\n$(not a command)',
        use: 'reference-only' as const,
      },
    ];
    const created = await api.create({ ...input, input_refs: refs }, 'create-input', context);
    expect(created.value.input_refs).toEqual([
      {
        ...refs[0],
        name: first.name,
        mime: first.mime,
        size_bytes: first.size_bytes,
        sha256: first.sha256,
      },
    ]);
    expect(
      await refused(api.create({ ...input, input_refs: refs }, 'foreign-claim', context))
    ).toMatchObject({ code: 'scope_mismatch' });
    const second = await fixtures.upload(record, scope, 'second', file, context);
    const independent = [
      {
        input_id: second.input_id,
        caption: 'Explicit follow-up only',
        use: 'may-include' as const,
      },
    ];
    const taskId = created.value.id;
    await api.start(
      taskId,
      { agent_kind: 'codex', role: 'lead' },
      created.value.revision,
      'start',
      context
    );
    let detail = await api.detail(taskId, context);
    const attempt = detail.attempts[0];
    const sent = await api.deliver(
      taskId,
      {
        attempt_id: attempt.id,
        expected_instance_id: attempt.instance_id!,
        text: 'Fictional follow-up',
        input_refs: independent,
      },
      detail.task.revision,
      'send-second',
      context
    );
    expect(
      sent.value.input_refs?.map(({ input_id, caption, use }) => ({ input_id, caption, use }))
    ).toEqual(independent);
    detail = await api.detail(taskId, context);
    expect(detail.task.input_refs).toEqual(created.value.input_refs);
    expect(detail.results).toHaveLength(0);
    const [expiredFile] = await pickDemoWorkInput('file');
    const expired = await fixtures.upload(record, scope, 'expired', expiredFile, context);
    expect(
      await refused(
        api.deliver(
          taskId,
          {
            attempt_id: attempt.id,
            expected_instance_id: attempt.instance_id!,
            text: 'Must refuse',
            input_refs: [{ input_id: expired.input_id, caption: '', use: 'reference-only' }],
          },
          detail.task.revision,
          'expired-send',
          context
        )
      )
    ).toMatchObject({ code: 'input_expired' });
    expect(await api.detail(taskId, context)).toEqual(detail);
  });
});
