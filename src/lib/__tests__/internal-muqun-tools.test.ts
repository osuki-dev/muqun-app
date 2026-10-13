import { describe, expect, test } from 'bun:test';

import type { TimelineItem, ToolPart } from '../agent-protocol';
import { executeToolCalls } from '../agent-tool-output';
import { isHiddenMuqunTool } from '../internal-muqun-tools';
import { withoutTaskPlumbing } from '../task-plumbing';
import { createAgentTranscriptStore } from '../../stores/agent-transcript';

const discovery = {
  tool: 'opencode.list_mcp_resources',
  status: 'completed',
  input: { server: 'muqun' },
};

/** The successful discovery wrapper and child shown in the reported card. */
const execute = (overrides: Partial<ToolPart> = {}): ToolPart => ({
  type: 'tool',
  id: 'discovery',
  name: 'execute',
  state: 'completed',
  input: { code: 'return await tools.opencode.list_mcp_resources({server:"muqun"});' },
  metadata: { toolCalls: [discovery] },
  content: [],
  output: { resources: [], templates: [] },
  ...overrides,
});

const row = (part: TimelineItem['part']): TimelineItem => ({
  id: 'discovery-row',
  message_id: 'message',
  role: 'assistant',
  ordinal: 0,
  seq: 1,
  updated_ms: 1,
  part,
});

describe('internal Muqun tool visibility', () => {
  test('the reported wrapper disappears from display, with its canonical call retained', () => {
    const store = createAgentTranscriptStore();
    const call = row(execute());
    store.getState().setTimeline([call]);
    expect(store.getState().keys).toEqual([]);
    expect(store.getState().timeline).toEqual([call]);
    expect(store.getState().toolIds.has('discovery')).toBe(true);
  });

  test.each<[string, unknown]>([
    ['muqun_tasks_complete', {}],
    ['mcp__muqun__tasks.complete', {}],
    ['muqun.tasks.read', {}],
    ['muqun__tasks_wait', {}],
    ['list_mcp_resources', { server: 'muqun' }],
    ['opencode.list_mcp_resource_templates', { server: 'muqun' }],
  ])('successful internal call %s is hidden', (name, input) => {
    expect(isHiddenMuqunTool(execute({ name, input }))).toBe(true);
  });

  test.each<[string, unknown]>([
    ['list_mcp_resources', {}],
    ['opencode.list_mcp_resources', { server: 'muqun-docs' }],
    ['opencode.list_mcp_resources', { query: 'muqun' }],
    ['mcp__external__tasks.complete', {}],
    ['tasks.complete', {}],
    ['read', { path: 'muqun' }],
  ])('external or unqualified call %s is retained', (name, input) => {
    expect(isHiddenMuqunTool(execute({ name, input }))).toBe(false);
  });

  test.each([
    'await tools.opencode.list_mcp_resources({server: "muqun"}); console.log("answer")',
    'return await tools.opencode.list_mcp_resources({server: "external"});',
    'return await tools.opencode.list_mcp_resources({server: getServer()});',
    'return await tools.opencode.list_mcp_resources({server: "muqun", extra: await work()});',
    'return await tools.opencode.list_mcp_resources({server: `muqun${work()}`});',
    'return await tools.opencode.list_mcp_resources({server: "muqun"}).then(work);',
    'console.log("tools.opencode.list_mcp_resources({server: muqun})")',
    'return\nawait tools.opencode.list_mcp_resources({server: "muqun"});',
  ])('uncertain or mixed code stays visible: %s', (code) => {
    expect(isHiddenMuqunTool(execute({ input: { code } }))).toBe(false);
  });

  test('literal JSON orchestration wrappers and the older metadata spelling are recognized', () => {
    expect(
      isHiddenMuqunTool(
        execute({
          input: { code: 'await tools.muqun.tasks_complete({"summary":"done"})' },
          metadata: {
            tool_calls: [{ tool: 'muqun.tasks_complete', status: 'completed', input: {} }],
          },
        })
      )
    ).toBe(true);
  });

  test.each<Partial<ToolPart>>([
    { state: 'failed' },
    { state: 'running' },
    { error: { name: 'PermissionDenied', message: 'Permission denied' } },
    { metadata: { error: true, toolCalls: [discovery] } },
    { output: { isError: true, content: [{ type: 'text', text: 'Connection failed' }] } },
    { metadata: {} },
    { metadata: { toolCalls: [] } },
    { metadata: { toolCalls: [{ ...discovery, status: 'rejected' }] } },
    { metadata: { toolCalls: [{ ...discovery, status: 'unknown' }] } },
    { metadata: { toolCalls: [{ ...discovery, result: { isError: true } }] } },
    { metadata: { toolCalls: [discovery, { tool: 'read', status: 'completed' }] } },
    { metadata: { toolCalls: [discovery, null] } },
  ])('failures, mixed children and missing evidence are retained: %j', (overrides) => {
    expect(isHiddenMuqunTool(execute(overrides))).toBe(false);
  });

  test('a mixed wrapper keeps external and failed child rows', () => {
    const calls = [
      discovery,
      { ...discovery, input: { server: 'external' } },
      { ...discovery, status: 'rejected' },
      { tool: 'muqun_tasks_read', status: 'completed', input: {} },
      { tool: 'read', status: 'completed', input: { path: 'result.txt' } },
    ];
    expect(executeToolCalls({ toolCalls: calls }).map((call) => [call.name, call.status])).toEqual([
      ['opencode.list_mcp_resources', 'completed'],
      ['opencode.list_mcp_resources', 'error'],
      ['read', 'completed'],
    ]);
    const part = execute({ metadata: { toolCalls: calls }, output: 'Useful external result' });
    const item = row(part);
    expect(withoutTaskPlumbing(item)).toBe(item);
    expect(part.metadata.toolCalls).toHaveLength(5);
  });

  test('permission rows never enter the tool filter', () => {
    const item = row({
      type: 'approval',
      request: {
        id: 'approval',
        asid: 'session',
        action: 'mcp',
        resources: ['muqun'],
        save: [],
        prompt: 'Allow this call?',
        options: [],
      },
    });
    expect(withoutTaskPlumbing(item)).toBe(item);
  });
});
