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

const search = {
  tool: 'search',
  status: 'completed',
  input: { namespace: 'muqun', query: 'exec.run tasks.read tasks.complete', limit: 10 },
};
const searchCode =
  'return search({namespace:"muqun",query:"exec.run tasks.read tasks.complete",limit:10});';

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
  test.each([
    searchCode,
    "return await search({namespace: 'muqun', query: 'exec.run tasks.read', limit: 10});",
    'await tools.search({"namespace":"muqun","query":"tasks.read"})',
    'return search({namespace:"muqun",query:"tasks.read",limit:10,});',
  ])('the namespace discovery wrapper in the screenshot is hidden: %s', (code) => {
    const part = execute({ input: { code }, metadata: { toolCalls: [search] } });
    expect(isHiddenMuqunTool(part)).toBe(true);
    expect(executeToolCalls(part.metadata)).toEqual([]);
    expect(part.metadata.toolCalls).toEqual([search]);
  });

  test('live completion and history use the same filter without dropping the initial user row', () => {
    const store = createAgentTranscriptStore();
    const user = {
      ...row({ type: 'text', text: 'Check my hardware; muqun is the app name.' }),
      id: 'user',
      message_id: 'user-message',
      role: 'user' as const,
    };
    const part = execute({ input: { code: searchCode }, metadata: { toolCalls: [search] } });
    const running = row({ ...part, state: 'running' });
    const completed = row(part);
    const answer = { ...row({ type: 'text', text: 'Hardware details.' }), id: 'answer' };
    store.getState().setTimeline([user, running]);
    expect(store.getState().keys).toEqual(['grp_user']);
    const userRow = store.getState().rows.grp_user;
    store.getState().setTimeline([user, completed, answer]);
    expect(store.getState().keys).toEqual(['grp_user', 'grp_answer']);
    expect(store.getState().rows.grp_user).toBe(userRow);
    expect(store.getState().timeline).toEqual([user, completed, answer]);
    expect(store.getState().toolIds.has(part.id)).toBe(true);
    const history = createAgentTranscriptStore();
    history.getState().setTimeline([user, completed, answer]);
    expect(history.getState().keys).toEqual(store.getState().keys);
  });

  test.each([
    'return search({namespace:"muqun-docs",query:"muqun"});',
    'return search({namespace: provider, query:"muqun"});',
    'return search({namespace: "muqun", ...other});',
    'return search({namespace: "muqun", query: await work()});',
    'return search({namespace: "muqun"}); return tools.read({path:"README.md"});',
    'return search({namespace: "muqun"}).then(work);',
    'console.log("search({namespace: muqun})");',
    'return search({namespace: "external", query: "namespace: muqun"});',
    'return search({namespace: "muqun", namespace: "external"});',
  ])('mixed or ambiguous search code remains visible: %s', (code) => {
    expect(isHiddenMuqunTool(execute({ input: { code }, metadata: { toolCalls: [search] } }))).toBe(
      false
    );
  });

  test('mixed execute children hide internal discovery in every state and keep third-party work', () => {
    const external = { ...search, input: { namespace: 'files', query: 'muqun' } };
    const failed = { ...search, status: 'failed' };
    const metadata = { tool_calls: [search, external, failed] };
    const shown = executeToolCalls(metadata);
    expect(shown.map((call) => [call.name, call.status])).toEqual([['search', 'completed']]);
    expect(shown[0]?.input).toContain('namespace files');
    const part = execute({ input: { code: searchCode }, metadata });
    expect(isHiddenMuqunTool(part)).toBe(false);
    expect(part.metadata).toBe(metadata);
  });

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
    ['search', { namespace: 'muqun', query: 'exec.run tasks.read tasks.complete' }],
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
    ['search', { query: 'namespace: muqun' }],
    ['search', { namespace: 'muqun-docs' }],
    ['mcp__external__search', { namespace: 'muqun' }],
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
    { state: 'pending' },
    { state: 'streaming' },
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
    { truncated: true },
  ])('ordinary internal logs remain hidden regardless of state or error: %j', (overrides) => {
    expect(isHiddenMuqunTool(execute(overrides))).toBe(true);
    expect(isHiddenMuqunTool(execute({ ...overrides, name: 'muqun_tasks_read', input: {} }))).toBe(
      true
    );
  });

  test.each<Partial<ToolPart>>([
    { background: true },
    { child_session_id: 'child-session' },
    { metadata: { toolCalls: 'unknown' } },
    { metadata: { toolCalls: [discovery, { tool: 'read', status: 'completed' }] } },
    { metadata: { toolCalls: [discovery, null] } },
  ])('actionable entry points and mixed or unknown children are retained: %j', (overrides) => {
    expect(isHiddenMuqunTool(execute(overrides))).toBe(false);
  });

  test('hidden failures retain the canonical error and actionable process/session entries', () => {
    const error = { name: 'ConnectionError', message: 'Internal call failed' };
    const failed = execute({ state: 'failed', error, metadata: { error: true } });
    const background = execute({ ...failed, id: 'process', background: true });
    const child = execute({ ...failed, id: 'child', child_session_id: 'child-session' });
    const items = [
      row(failed),
      { ...row(background), id: 'process' },
      { ...row(child), id: 'child' },
    ];
    const store = createAgentTranscriptStore();
    store.getState().setTimeline(items);
    expect(store.getState().timeline).toEqual(items);
    expect(store.getState().timeline[0]?.part).toBe(failed);
    expect(failed.error).toBe(error);
    expect(store.getState().keys).toEqual(['grp_process', 'grp_child']);
    expect(store.getState().toolIds.has(failed.id)).toBe(true);
  });

  test('a mixed wrapper keeps external child rows and their failures', () => {
    const calls = [
      discovery,
      { ...discovery, input: { server: 'external' } },
      { ...discovery, status: 'rejected' },
      { ...discovery, status: 'failed', input: { server: 'external' } },
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
    expect(part.metadata.toolCalls).toHaveLength(6);
  });

  test.each(['pending', 'running', 'failed', 'completed', 'unknown'])(
    'nested internal calls are hidden in %s state',
    (status) => {
      const internal = { ...search, status, error: 'Failure', result: { isError: true } };
      expect(executeToolCalls({ toolCalls: [internal, 'muqun_tasks_read'] })).toEqual([]);
      expect(
        executeToolCalls({ toolCalls: [{ ...internal, child_session_id: 'child' }] })
      ).toHaveLength(1);
      expect(executeToolCalls({ toolCalls: [{ ...internal, background: true }] })).toHaveLength(1);
    }
  );

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
