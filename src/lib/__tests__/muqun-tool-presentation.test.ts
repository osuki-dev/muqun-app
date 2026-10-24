import { describe, expect, test } from 'bun:test';
import type { ToolPart } from '../agent-protocol';
import { muqunToolPresentation } from '../muqun-tool-presentation';

function call(name: string, output: unknown, extra: Partial<ToolPart> = {}): ToolPart {
  return {
    type: 'tool',
    id: 'call',
    name: `muqun:${name}`,
    input: {},
    output,
    content: [],
    metadata: {},
    state: 'completed',
    ...extra,
  };
}

describe('Muqun MCP result snapshots', () => {
  test.each([
    ['exec.run', { task_id: 't1', state: 'working', stdout_tail: 'building' }, 'started'],
    [
      'tasks.delegate',
      { task_id: 't1', state: 'working', goal: 'Build', binding: { peer_name: 'mini' } },
      'started',
    ],
    ['tasks.wait', { task_id: 't1', state: 'working', stdout_tail: 'building' }, 'working'],
    [
      'tasks.read',
      { your_task: { task_id: 't1', state: 'waiting', summary: 'Needs approval' } },
      'waiting',
    ],
    ['tasks.cancel', { task_id: 't1', state: 'cancelled', exit_code: 130 }, 'cancelled'],
    ['tasks.complete', { task_id: 't1', state: 'done', summary: 'Built' }, 'done'],
    ['fleet.list', { machines: [{ machineId: 'm1', label: 'mini', online: true }] }, 'returned'],
    [
      'fleet.describe',
      {
        machineId: 'm1',
        label: 'mini',
        gatewayVersion: '4.0.0',
        agents: [{ id: 'codex', version: '1.0' }],
      },
      'returned',
    ],
  ] as const)('%s uses its returned state, not invocation completion', (name, result, status) => {
    const presented = muqunToolPresentation(
      call(name, { content: [{ type: 'text', text: JSON.stringify(result) }] })
    );
    expect(presented?.status).toBe(status);
  });

  test('MCP error envelopes and command failures remain failures', () => {
    expect(
      muqunToolPresentation(
        call('exec.run', { isError: true, content: [{ type: 'text', text: 'Permission denied' }] })
      )?.error
    ).toBe('Permission denied');
    expect(
      muqunToolPresentation(call('exec.run', { task_id: 't1', state: 'done', exit_code: 1 }))
        ?.status
    ).toBe('failed');
    expect(
      muqunToolPresentation(
        call('exec.run', { error: 'unauthorized', message: 'Link this computer again' })
      )?.error
    ).toBe('Link this computer again');
  });

  test('only an unfinished invocation is live', () => {
    expect(muqunToolPresentation(call('exec.run', undefined, { state: 'running' }))?.status).toBe(
      'calling'
    );
    expect(
      muqunToolPresentation(call('tasks.read', { task_id: 't1', state: 'idle_unconfirmed' }))
        ?.status
    ).toBe('unconfirmed');
    expect(
      muqunToolPresentation(call('tasks.complete', { task_id: 't1', state: 'waiting' }))?.status
    ).toBe('waiting');
  });

  test('decodes output once without repeating arguments or a command-shaped summary', () => {
    const result = muqunToolPresentation(
      call(
        'exec.run',
        JSON.stringify({ task_id: 't1', state: 'done', stdout_tail: 'one\ntwo', exit_code: 0 }),
        { input: { command: 'printf output', machine: 'mini', cwd: '~/Work' } }
      )
    );
    expect(result?.output).toBe('one\ntwo');
    expect(result?.command).toBe('printf output');
    expect(result?.machine).toBe('mini');
    expect(
      muqunToolPresentation(
        call('tasks.read', { task_id: 't1', kind: 'command', goal: 'pwd', summary: 'pwd' })
      )?.output
    ).toBeUndefined();
  });

  test('supports own-task absence and timeline pages without fabricating completion', () => {
    expect(
      muqunToolPresentation(
        call('tasks.read', { structuredContent: { your_task: null, note: 'No task assigned' } })
      )?.status
    ).toBe('unassigned');
    const page = muqunToolPresentation(
      call('tasks.read', {
        task_id: 't1',
        items: [{ role: 'assistant', type: 'text', text: 'Built' }],
        cursor: 7,
      })
    );
    expect(page?.status).toBe('returned');
    expect(page?.timelineCount).toBe(1);
    expect(page?.output).toBe('Built');
  });

  test('same-name computers keep distinct IDs and unknown reachability', () => {
    const result = muqunToolPresentation(
      call('fleet.list', {
        machines: [
          { machineId: 'm1', label: 'mini', online: true },
          { machineId: 'm2', label: 'mini', online: null },
        ],
      })
    );
    expect(result?.machines.map((machine) => machine.id)).toEqual(['m1', 'm2']);
    expect(result?.machines[1]?.online).toBeUndefined();
    expect(
      muqunToolPresentation(
        call('fleet.list', {
          machines: [{ machineId: 'm1', label: 'mini', online: false, state: 'unauthorized' }],
        })
      )?.machines[0]?.unauthorized
    ).toBe(true);
  });

  test('unrecognized, malformed, oversized and deeply nested replies remain unknown', () => {
    for (const output of [
      'not JSON',
      'x'.repeat(70_000),
      { task_id: 't1', state: 'future_state' },
      { result: { result: { result: { result: { result: { result: { state: 'done' } } } } } } },
    ]) {
      expect(muqunToolPresentation(call('exec.run', output))?.status).toBe('unknown');
    }
    expect(muqunToolPresentation(call('exec.run', {}, { name: 'other:exec.run' }))).toBeNull();
    for (const name of ['mcp__muqun__exec_run', 'muqun_exec_run']) {
      expect(muqunToolPresentation(call('exec.run', { state: 'done' }, { name }))?.status).toBe(
        'done'
      );
    }
  });
});
