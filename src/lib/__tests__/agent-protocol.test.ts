import { describe, expect, test } from 'bun:test';

import {
  contextFillRatio,
  DEFAULT_PERMISSION_DECISIONS,
  contextTokenTotal,
  formatModelName,
  hasRealSessionTitle,
  inboxItemText,
  isBusyStatus,
  isFormFieldVisible,
  isFreeModel,
  isNoticePart,
  isSessionUnread,
  isSlashSkill,
  parseAgentCatalog,
  parseAgentContextUsage,
  parseAgentDomainEvent,
  parseAgentEngineInfo,
  parseAgentPart,
  parseAgentSessionInfo,
  parseAgentSessionList,
  parseAgentSessionSnapshot,
  parseFileDiffItems,
  parseFormField,
  parseFormRequest,
  parseInboxItems,
  parsePermissionRequest,
  parseRunStatus,
  orderKeyAfter,
  parseShellList,
  parseShellOutputPage,
  parseTimelineItem,
  parseVcsDiffMode,
  selectableAgents,
  sessionTitleOr,
  sortTimeline,
  toolDurationMs,
  validateFormField,
  type FormField,
  type TimelineItem,
} from '../agent-protocol';

/**
 * Everything the gateway can hand a phone, including what a gateway three
 * releases newer might hand it.
 *
 * The contract these tests hold every parser to is the one the module's header
 * states: take `unknown`, never throw, and answer `null` rather than a shape
 * that was not actually checked. So the hostile inputs below are not padding --
 * `undefined`, a number, an array where an object belongs and a field of the
 * wrong type are what a crash on someone's phone actually looks like.
 */
const HOSTILE: readonly unknown[] = [
  undefined,
  null,
  0,
  1,
  '',
  'nonsense',
  true,
  [],
  [1, 2, 3],
  {},
  { type: 42 },
  { type: null },
  NaN,
];

describe('primitives and hostile input', () => {
  test('every top-level parser survives junk', () => {
    for (const value of HOSTILE) {
      expect(() => parseAgentSessionInfo(value)).not.toThrow();
      expect(() => parseAgentSessionList(value)).not.toThrow();
      expect(() => parseAgentPart(value)).not.toThrow();
      expect(() => parseTimelineItem(value)).not.toThrow();
      expect(() => parsePermissionRequest(value)).not.toThrow();
      expect(() => parseFormRequest(value)).not.toThrow();
      expect(() => parseFormField(value)).not.toThrow();
      expect(() => parseAgentCatalog(value)).not.toThrow();
      expect(() => parseAgentSessionSnapshot(value)).not.toThrow();
      expect(() => parseAgentContextUsage(value)).not.toThrow();
      expect(() => parseInboxItems(value)).not.toThrow();
      expect(() => parseShellList(value)).not.toThrow();
      expect(() => parseShellOutputPage(value)).not.toThrow();
      expect(() => parseAgentEngineInfo(value)).not.toThrow();
      expect(() => parseFileDiffItems(value)).not.toThrow();
      expect(() => parseAgentDomainEvent('agent.timeline.upsert', value)).not.toThrow();
    }
  });

  test('a list parser never returns a non-array', () => {
    for (const value of HOSTILE) {
      expect(Array.isArray(parseAgentSessionList(value))).toBe(true);
      expect(Array.isArray(parseInboxItems(value))).toBe(true);
      expect(Array.isArray(parseShellList(value))).toBe(true);
      expect(Array.isArray(parseFileDiffItems(value))).toBe(true);
    }
  });
});

describe('parseAgentSessionInfo', () => {
  const full = {
    asid: 'ses_1',
    backend_session_id: 'ses_1',
    title: 'Tool availability',
    agent: 'build',
    model: { provider_id: 'opencode', model_id: 'union-alpha', variant: 'default' },
    status: 'busy',
    directory: '/home/ryu/Work/muqun/app',
    cost: 0.1,
    tokens: { input: 1, output: 2, reasoning: 3, cache_read: 4, cache_write: 5 },
    limit: { context: 200000 },
    parent_id: 'ses_0',
    project_id: '68c2',
    outcome: 'succeeded',
    error: { name: 'unknown', message: 'boom', status: 500 },
    revert: { message_id: 'msg_1', part_id: null, snapshot: null, files: null },
    fork: { session_id: 'ses_x', boundary_type: 'before', message_id: 'msg_2' },
    time_idle: 1789641018610,
    time_viewed: 1789641000000,
    deleted: false,
    updated_ms: 1789641018610,
  };

  test('reads every documented field', () => {
    const info = parseAgentSessionInfo(full);
    expect(info).not.toBeNull();
    expect(info?.asid).toBe('ses_1');
    expect(info?.status).toBe('busy');
    expect(info?.model).toEqual({
      provider_id: 'opencode',
      model_id: 'union-alpha',
      variant: 'default',
    });
    expect(info?.limit?.context).toBe(200000);
    expect(info?.parent_id).toBe('ses_0');
    expect(info?.outcome).toBe('succeeded');
    expect(info?.error?.status).toBe(500);
    expect(info?.revert?.message_id).toBe('msg_1');
    // `part_id: null` is not a part id, so it is not carried as one.
    expect(info?.revert?.part_id).toBeUndefined();
    expect(info?.fork?.session_id).toBe('ses_x');
    expect(info?.time_idle).toBe(1789641018610);
    expect(info?.deleted).toBeUndefined();
  });

  test('only the five always-present fields are required', () => {
    const info = parseAgentSessionInfo({
      asid: 'ses_2',
      backend_session_id: 'ses_2',
      title: '',
      status: 'idle',
      updated_ms: 7,
    });
    expect(info?.model).toBeNull();
    expect(info?.agent).toBeUndefined();
    expect(info?.tokens).toBeUndefined();
    expect(info?.limit).toBeUndefined();
  });

  test('a session with no id is not a session', () => {
    expect(parseAgentSessionInfo({ title: 'x', status: 'idle' })).toBeNull();
  });

  test('model is null, never invented, when OpenCode has not said', () => {
    expect(parseAgentSessionInfo({ ...full, model: null })?.model).toBeNull();
    expect(parseAgentSessionInfo({ ...full, model: { provider_id: 'x' } })?.model).toBeNull();
  });

  test('deleted is carried only when true', () => {
    expect(parseAgentSessionInfo({ ...full, deleted: true })?.deleted).toBe(true);
  });

  test('unread is time_idle past time_viewed', () => {
    const info = parseAgentSessionInfo(full);
    expect(info && isSessionUnread(info)).toBe(true);
    const read = parseAgentSessionInfo({ ...full, time_viewed: full.time_idle });
    expect(read && isSessionUnread(read)).toBe(false);
    const never = parseAgentSessionInfo({ ...full, time_idle: undefined });
    expect(never && isSessionUnread(never)).toBe(false);
  });

  test('a list drops what it cannot read and keeps the rest', () => {
    const list = parseAgentSessionList([full, null, 3, { nope: true }, { ...full, asid: 'ses_9' }]);
    expect(list.map((s) => s.asid)).toEqual(['ses_1', 'ses_9']);
  });
});

describe('parseRunStatus', () => {
  test('accepts the six documented values', () => {
    for (const status of ['busy', 'idle', 'failed', 'interrupted', 'retry', 'unknown']) {
      expect(parseRunStatus(status)).toBe(status as ReturnType<typeof parseRunStatus>);
    }
  });

  test('maps this app&apos;s older spellings rather than dropping them', () => {
    expect(parseRunStatus('running')).toBe('busy');
    expect(parseRunStatus('error')).toBe('failed');
    expect(parseRunStatus('paused')).toBe('interrupted');
    expect(parseRunStatus('terminated')).toBe('interrupted');
  });

  test('anything else is unknown, which is never rendered as idle', () => {
    expect(parseRunStatus(undefined)).toBe('unknown');
    expect(parseRunStatus(7)).toBe('unknown');
    expect(parseRunStatus('sideways')).toBe('unknown');
    expect(isBusyStatus('unknown')).toBe(false);
    expect(isBusyStatus('busy')).toBe(true);
    expect(isBusyStatus('retry')).toBe(true);
    expect(isBusyStatus('idle')).toBe(false);
  });
});

describe('parseAgentPart — tool', () => {
  const tool = {
    type: 'tool',
    id: 'call_675c18e7',
    name: 'glob',
    title: '**/*',
    input: { pattern: '**/*', path: '.' },
    output: 'sample.txt',
    content: [{ type: 'text', text: 'sample.txt' }],
    metadata: { count: 1, truncated: false },
    state: 'completed',
    time: { created: 1, ran: 2, completed: 5 },
  };

  test('reads the documented shape', () => {
    const part = parseAgentPart(tool);
    expect(part?.type).toBe('tool');
    if (part?.type !== 'tool') throw new Error('unreachable');
    expect(part.id).toBe('call_675c18e7');
    expect(part.state).toBe('completed');
    expect(part.title).toBe('**/*');
    expect(part.content).toEqual([{ type: 'text', text: 'sample.txt' }]);
    // camelCase metadata is forwarded verbatim; nothing renames it.
    expect(part.metadata.count).toBe(1);
    expect(toolDurationMs(part.time)).toBe(3);
  });

  test('`status` is accepted as the previous release&apos;s name for `state`', () => {
    const part = parseAgentPart({ ...tool, state: undefined, status: 'running' });
    expect(part?.type === 'tool' && part.state).toBe('running');
  });

  test('an error implies failed even when the state says otherwise', () => {
    const part = parseAgentPart({
      ...tool,
      state: 'completed',
      error: { name: 'ENOENT', message: 'no such file' },
    });
    if (part?.type !== 'tool') throw new Error('unreachable');
    expect(part.state).toBe('failed');
    expect(part.error?.message).toBe('no such file');
  });

  test('child_session_id is lifted out of metadata.sessionID', () => {
    const part = parseAgentPart({
      ...tool,
      name: 'subagent',
      metadata: { sessionID: 'ses_CHILD', status: 'running' },
    });
    expect(part?.type === 'tool' && part.child_session_id).toBe('ses_CHILD');
  });

  test('background and truncated are read from either level', () => {
    expect(parseAgentPart({ ...tool, background: true })).toMatchObject({ background: true });
    expect(parseAgentPart({ ...tool, metadata: { background: true } })).toMatchObject({
      background: true,
    });
    expect(parseAgentPart({ ...tool, truncated: true })).toMatchObject({ truncated: true });
    expect(parseAgentPart({ ...tool, metadata: { truncated: true } })).toMatchObject({
      truncated: true,
    });
  });

  test('file content items survive, which is how read returns an image', () => {
    const part = parseAgentPart({
      ...tool,
      name: 'read',
      content: [
        { type: 'file', uri: 'file:///tmp/a.png', mime: 'image/png', name: 'a.png' },
        { type: 'text', text: 'ok' },
        { type: 'file' },
      ],
    });
    if (part?.type !== 'tool') throw new Error('unreachable');
    expect(part.content).toEqual([
      { type: 'file', uri: 'file:///tmp/a.png', mime: 'image/png', name: 'a.png' },
      { type: 'text', text: 'ok' },
    ]);
  });

  test('a streaming input is a partial JSON string and is carried as it came', () => {
    const part = parseAgentPart({ ...tool, state: 'streaming', input: '{"pattern": "**' });
    if (part?.type !== 'tool') throw new Error('unreachable');
    expect(part.state).toBe('streaming');
    expect(part.input).toBe('{"pattern": "**');
  });

  test('a nameless tool is not a tool call', () => {
    expect(parseAgentPart({ type: 'tool', id: 'x' })).toBeNull();
  });

  test('duration needs both ends', () => {
    expect(toolDurationMs(undefined)).toBeUndefined();
    expect(toolDurationMs({ created: 1, ran: 2 })).toBeUndefined();
    expect(toolDurationMs({ ran: 5, completed: 2 })).toBeUndefined();
  });
});

describe('parseAgentPart — the rest of the union', () => {
  test('compaction', () => {
    const part = parseAgentPart({
      type: 'compaction',
      status: 'completed',
      reason: 'manual',
      summary: '## Objective',
      recent: 'tail',
      tokens: { input: 10, output: 2 },
      cost: 0.5,
    });
    expect(part).toMatchObject({
      type: 'compaction',
      status: 'completed',
      reason: 'manual',
      summary: '## Objective',
      cost: 0.5,
    });
  });

  test('compaction defaults to running/auto, and `started` is a running row', () => {
    expect(parseAgentPart({ type: 'compaction' })).toMatchObject({
      status: 'running',
      reason: 'auto',
    });
    expect(parseAgentPart({ type: 'compaction', status: 'started' })).toMatchObject({
      status: 'running',
    });
  });

  test('skill, shell, switches, todo, diff and status', () => {
    expect(parseAgentPart({ type: 'skill', skill: 's1', name: 'Skill', text: 'go' })).toMatchObject(
      {
        type: 'skill',
        skill: 's1',
      }
    );
    expect(
      parseAgentPart({
        type: 'shell',
        shell_id: 'sh_1',
        command: 'sleep 60',
        status: 'running',
        exit: 0,
      })
    ).toMatchObject({ type: 'shell', shell_id: 'sh_1', command: 'sleep 60', status: 'running' });
    expect(
      parseAgentPart({
        type: 'model_switched',
        model: { provider_id: 'opencode', model_id: 'a' },
        previous: { provider_id: 'opencode', model_id: 'b' },
      })
    ).toMatchObject({ type: 'model_switched' });
    expect(parseAgentPart({ type: 'agent_switched', agent: 'plan', previous: 'build' })).toEqual({
      type: 'agent_switched',
      agent: 'plan',
      previous: 'build',
    });
    expect(parseAgentPart({ type: 'location_switched', directory: '/a', previous: '/b' })).toEqual({
      type: 'location_switched',
      directory: '/a',
      previous: '/b',
    });
    expect(parseAgentPart({ type: 'synthetic', text: 's' })).toEqual({
      type: 'synthetic',
      text: 's',
    });
    expect(parseAgentPart({ type: 'system', description: 'd' })).toEqual({
      type: 'system',
      description: 'd',
    });
    expect(
      parseAgentPart({ type: 'todo', items: [{ text: 'a', done: true }, { text: 'b' }, 'c', 9] })
    ).toEqual({
      type: 'todo',
      items: [
        { text: 'a', done: true },
        { text: 'b', done: false },
        { text: 'c', done: false },
      ],
    });
    expect(parseAgentPart({ type: 'diff', file: 'a.ts', diff: '@@' })).toEqual({
      type: 'diff',
      file: 'a.ts',
      diff: '@@',
    });
    expect(parseAgentPart({ type: 'status', text: 'thinking' })).toEqual({
      type: 'status',
      text: 'thinking',
    });
  });

  test('an approval or form part carries its request, and drops without one', () => {
    const approval = parseAgentPart({
      type: 'approval',
      request: { id: 'per_1', action: 'shell', resources: ['ls'] },
    });
    expect(approval?.type).toBe('approval');
    expect(parseAgentPart({ type: 'approval', request: {} })).toBeNull();
    const form = parseAgentPart({ type: 'form', request: { id: 'frm_1', fields: [] } });
    expect(form?.type).toBe('form');
    expect(parseAgentPart({ type: 'form' })).toBeNull();
  });

  test('a type this build has never seen keeps its row', () => {
    // Dropping it dropped the whole `TimelineItem`, so a newer engine's output
    // had silent holes in it. The placeholder says something was said here.
    expect(parseAgentPart({ type: 'hologram', payload: 1 })).toEqual({
      type: 'unsupported',
      raw_type: 'hologram',
    });
  });

  test('a malformed *known* part is still dropped, because it is broken not new', () => {
    expect(parseAgentPart({ type: 'tool', id: 'x' })).toBeNull();
    expect(parseAgentPart({ type: 'approval', request: {} })).toBeNull();
    expect(parseAgentPart({ type: 'skill' })).toBeNull();
  });

  test('the quiet one-line kinds are recognisable as a group', () => {
    const notices = [
      { type: 'model_switched', model: null, previous: null },
      { type: 'agent_switched', agent: 'plan' },
      { type: 'location_switched', directory: '/a' },
      { type: 'skill', skill: 's' },
      { type: 'synthetic', text: 't' },
      { type: 'system', text: 't' },
    ];
    for (const raw of notices) {
      const part = parseAgentPart(raw);
      expect(part).not.toBeNull();
      expect(part && isNoticePart(part)).toBe(true);
    }
    const text = parseAgentPart({ type: 'text', text: 'hi' });
    expect(text && isNoticePart(text)).toBe(false);
  });
});

describe('timeline', () => {
  test('a row needs an id and a readable part', () => {
    expect(parseTimelineItem({ id: 'a', part: { type: 'text', text: 'x' } })).toMatchObject({
      id: 'a',
      message_id: 'a',
      role: 'assistant',
      ordinal: 0,
    });
    expect(parseTimelineItem({ part: { type: 'text', text: 'x' } })).toBeNull();
    // A part kind this build has no branch for keeps its row.
    expect(parseTimelineItem({ id: 'a', part: { type: 'hologram' } })?.part).toEqual({
      type: 'unsupported',
      raw_type: 'hologram',
    });
    // A part with no `type` at all is not a part.
    expect(parseTimelineItem({ id: 'a', part: {} })).toBeNull();
  });

  test('ordinal is read and used as the second sort key', () => {
    const rows = [
      { id: 'msg_2:t0', message_id: 'msg_2', ordinal: 0 },
      { id: 'msg_1:t1', message_id: 'msg_1', ordinal: 1 },
      { id: 'msg_1:t0', message_id: 'msg_1', ordinal: 0 },
    ].map((raw, index) =>
      parseTimelineItem({ ...raw, seq: index, part: { type: 'text', text: '' } })
    );
    const items = rows.filter((row): row is TimelineItem => row !== null);
    expect(sortTimeline(items).map((item) => item.id)).toEqual([
      'msg_1:t0',
      'msg_1:t1',
      'msg_2:t0',
    ]);
  });

  test('an optimistic row keeps its place under the reply it triggered', () => {
    // The engine's ids are time-ordered hex; a locally made `msg_<now>` sorts
    // after all of them, which is how a reply came to render above the
    // message that asked for it.
    const history = [
      parseTimelineItem({
        id: 'msg_019a:t0',
        message_id: 'msg_019a',
        ordinal: 0,
        part: { type: 'text', text: 'earlier' },
      }),
    ].filter((item): item is TimelineItem => item !== null);

    const optimistic: TimelineItem = {
      id: 'temp_usr_1758000000000',
      message_id: 'msg_1758000000000',
      role: 'user',
      ordinal: 0,
      part: { type: 'text', text: 'do the thing' },
      seq: 2,
      updated_ms: 2,
      order: orderKeyAfter(history),
    };
    const reply = parseTimelineItem({
      id: 'msg_019c:t0',
      message_id: 'msg_019c',
      ordinal: 0,
      part: { type: 'text', text: 'doing it' },
    });
    expect(reply).not.toBeNull();

    const sorted = sortTimeline([reply as TimelineItem, optimistic, ...history]);
    expect(sorted.map((item) => item.id)).toEqual([
      'msg_019a:t0',
      'temp_usr_1758000000000',
      'msg_019c:t0',
    ]);

    // And the acknowledged row, inheriting the key, lands in the same slot.
    const acknowledged: TimelineItem = {
      ...(parseTimelineItem({
        id: 'msg_019b:t0',
        message_id: 'msg_019b',
        role: 'user',
        ordinal: 0,
        part: { type: 'text', text: 'do the thing' },
      }) as TimelineItem),
      order: optimistic.order,
    };
    expect(
      sortTimeline([reply as TimelineItem, acknowledged, ...history]).map((item) => item.id)
    ).toEqual(['msg_019a:t0', 'msg_019b:t0', 'msg_019c:t0']);
  });

  test("the first row of a session sorts before the engine's answer", () => {
    const optimistic: TimelineItem = {
      id: 'temp_usr_1',
      message_id: 'msg_1758000000000',
      role: 'user',
      ordinal: 0,
      part: { type: 'text', text: 'hello' },
      seq: 1,
      updated_ms: 1,
      order: orderKeyAfter([]),
    };
    const reply = parseTimelineItem({
      id: 'msg_019c:t0',
      message_id: 'msg_019c',
      ordinal: 0,
      part: { type: 'text', text: 'hi' },
    }) as TimelineItem;
    expect(sortTimeline([reply, optimistic]).map((item) => item.id)).toEqual([
      'temp_usr_1',
      'msg_019c:t0',
    ]);
  });

  test('a detached shell is not what a new message is anchored after', () => {
    // A `shell` row is keyed by the shell's own id, from an id space that
    // sorts after every message id there will ever be.
    const items: TimelineItem[] = [
      parseTimelineItem({
        id: 'msg_019a:t0',
        message_id: 'msg_019a',
        ordinal: 0,
        part: { type: 'text', text: 'earlier' },
      }) as TimelineItem,
      {
        id: 'sh_zzz',
        message_id: 'sh_zzz',
        role: 'assistant',
        ordinal: 0,
        part: { type: 'shell', shell_id: 'sh_zzz', command: 'sleep 120', status: 'running' },
        seq: 2,
        updated_ms: 2,
      },
    ];
    expect(orderKeyAfter(items)).toBe('msg_019a~');
  });

  test('sorting is stable and does not mutate its input', () => {
    const items = [
      parseTimelineItem({
        id: 'a',
        message_id: 'm',
        ordinal: 0,
        part: { type: 'text', text: '1' },
      }),
      parseTimelineItem({
        id: 'b',
        message_id: 'm',
        ordinal: 0,
        part: { type: 'text', text: '2' },
      }),
    ].filter((item): item is TimelineItem => item !== null);
    const before = [...items];
    expect(sortTimeline(items).map((item) => item.id)).toEqual(['a', 'b']);
    expect(items).toEqual(before);
  });

  test('a snapshot comes back sorted, with unreadable rows dropped', () => {
    const snapshot = parseAgentSessionSnapshot({
      info: {
        asid: 'ses_1',
        backend_session_id: 'ses_1',
        title: '',
        status: 'idle',
        updated_ms: 1,
      },
      timeline: [
        { id: 'msg_2:t0', message_id: 'msg_2', ordinal: 0, part: { type: 'text', text: 'b' } },
        { id: 'broken' },
        { id: 'msg_1:t0', message_id: 'msg_1', ordinal: 0, part: { type: 'text', text: 'a' } },
      ],
      permissions: [{ id: 'per_1', action: 'shell', resources: [] }, {}],
      forms: [{ id: 'frm_1', fields: [] }, 3],
      inbox: [{ id: 'msg_9', sessionID: 'ses_1', type: 'user', delivery: 'queue' }],
      seq: 42,
    });
    expect(snapshot.timeline.map((item) => item.id)).toEqual(['msg_1:t0', 'msg_2:t0']);
    expect(snapshot.permissions).toHaveLength(1);
    expect(snapshot.forms).toHaveLength(1);
    expect(snapshot.inbox).toHaveLength(1);
    expect(snapshot.seq).toBe(42);
  });

  test('a snapshot of nothing is empty rather than broken', () => {
    const snapshot = parseAgentSessionSnapshot(undefined);
    expect(snapshot.info).toBeNull();
    expect(snapshot.timeline).toEqual([]);
    expect(snapshot.seq).toBe(0);
  });
});

describe('permissions', () => {
  const request = {
    id: 'per_1',
    asid: 'ses_1',
    action: 'external_directory',
    resources: ['/etc/hosts'],
    save: ['/etc/*'],
    prompt: 'external_directory: /etc/hosts',
    tool: 'tool',
    source_message_id: 'msg_1',
    source_tool_call_id: 'call_1',
    metadata: { why: 'probe' },
    message: 'because',
    options: [
      { index: 0, label: 'Allow Once', decision: 'allow' },
      { index: 1, label: 'Always Allow', decision: 'allow_always' },
      { index: 2, label: 'Reject', decision: 'deny' },
    ],
  };

  test('reads save, source_tool_call_id and the options the engine sent', () => {
    const parsed = parsePermissionRequest(request);
    expect(parsed?.save).toEqual(['/etc/*']);
    expect(parsed?.source_tool_call_id).toBe('call_1');
    expect(parsed?.options.map((option) => option.label)).toEqual([
      'Allow Once',
      'Always Allow',
      'Reject',
    ]);
  });

  test('a menu of its own is carried, not replaced by the usual three', () => {
    const parsed = parsePermissionRequest({
      ...request,
      options: [{ index: 0, label: 'Only this once', decision: 'allow' }],
    });
    expect(parsed?.options).toEqual([{ index: 0, label: 'Only this once', decision: 'allow' }]);
  });

  test('once/always/reject are accepted as aliases', () => {
    const parsed = parsePermissionRequest({
      ...request,
      options: [
        { index: 0, label: 'a', decision: 'once' },
        { index: 1, label: 'b', decision: 'always' },
        { index: 2, label: 'c', decision: 'reject' },
      ],
    });
    expect(parsed?.options.map((option) => option.decision)).toEqual([
      'allow',
      'allow_always',
      'deny',
    ]);
  });

  test('no menu of its own is an empty menu, not three English strings', () => {
    // The wording of the three default answers belongs to the card, which has
    // a macro; a pure module baking them in would ship English to every locale.
    const parsed = parsePermissionRequest({ id: 'per_2', action: 'shell', resources: [] });
    expect(parsed?.options).toEqual([]);
    expect(parsed?.save).toEqual([]);
    expect(DEFAULT_PERMISSION_DECISIONS).toEqual(['allow', 'allow_always', 'deny']);
  });

  test('a request with no id is not a request', () => {
    expect(parsePermissionRequest({ action: 'shell' })).toBeNull();
  });
});

describe('forms', () => {
  test('every documented field type parses', () => {
    const request = parseFormRequest({
      id: 'frm_1',
      asid: 'ses_1',
      title: 'Deploy',
      fields: [
        {
          type: 'string',
          key: 'tag',
          title: 'Tag',
          required: true,
          when: [{ key: 'env', op: 'eq', value: 'prod' }],
          placeholder: 'v1',
          default: 'v0',
          options: [{ value: 'v1', label: 'One' }],
          format: 'email',
          min_length: 2,
          max_length: 40,
          pattern: '^v',
          custom: true,
        },
        { type: 'number', key: 'count', min: 0, max: 10, default: 1 },
        { type: 'boolean', key: 'force', default: false },
        { type: 'multiselect', key: 'tags', options: [{ value: 'a', label: 'A' }], default: ['a'] },
        { type: 'external', key: 'oauth', url: 'https://example.test/auth' },
        { type: 'colorpicker', key: 'tint', title: 'Tint' },
        { type: 'string' },
      ],
    });
    expect(request?.fields.map((field) => field.type)).toEqual([
      'string',
      'number',
      'boolean',
      'multiselect',
      'external',
      'unknown',
    ]);
    const first = request?.fields[0];
    expect(first).toMatchObject({
      type: 'string',
      min_length: 2,
      max_length: 40,
      pattern: '^v',
      custom: true,
      format: 'email',
    });
    expect(first?.when).toEqual([{ key: 'env', op: 'eq', value: 'prod' }]);
    const unknownField = request?.fields[5];
    expect(unknownField).toMatchObject({ type: 'unknown', raw_type: 'colorpicker' });
  });

  test('an external field with no url degrades to unknown rather than a dead button', () => {
    expect(parseFormField({ type: 'external', key: 'k' })).toMatchObject({ type: 'unknown' });
  });

  test('`when` decides visibility against the answers so far', () => {
    const field = parseFormField({
      type: 'string',
      key: 'tag',
      when: [
        { key: 'env', op: 'eq', value: 'prod' },
        { key: 'skip', op: 'neq', value: true },
      ],
    });
    expect(field).not.toBeNull();
    if (!field) throw new Error('unreachable');
    expect(isFormFieldVisible(field, { env: 'prod' })).toBe(true);
    expect(isFormFieldVisible(field, { env: 'dev' })).toBe(false);
    expect(isFormFieldVisible(field, { env: 'prod', skip: true })).toBe(false);
    expect(isFormFieldVisible(field, {})).toBe(false);
  });

  test('a field with no conditions is always visible', () => {
    const field = parseFormField({ type: 'boolean', key: 'b' });
    expect(field && isFormFieldVisible(field, {})).toBe(true);
  });
});

describe('validateFormField', () => {
  function stringField(extra: Record<string, unknown>): FormField {
    const field = parseFormField({ type: 'string', key: 'k', title: 'K', ...extra });
    if (!field) throw new Error('unreachable');
    return field;
  }

  test('required is only violated by an empty answer', () => {
    expect(validateFormField(stringField({ required: true }), '')).toEqual({ reason: 'required' });
    expect(validateFormField(stringField({ required: true }), undefined)).toEqual({
      reason: 'required',
    });
    expect(validateFormField(stringField({ required: true }), 'x')).toBeNull();
    expect(validateFormField(stringField({}), '')).toBeNull();
  });

  test('length, pattern and format', () => {
    expect(validateFormField(stringField({ min_length: 3 }), 'ab')).toEqual({
      reason: 'min_length',
      limit: 3,
    });
    expect(validateFormField(stringField({ max_length: 2 }), 'abc')).toEqual({
      reason: 'max_length',
      limit: 2,
    });
    expect(validateFormField(stringField({ pattern: '^v' }), 'x')).toEqual({
      reason: 'pattern',
      pattern: '^v',
    });
    expect(validateFormField(stringField({ pattern: '^v' }), 'v1')).toBeNull();
    expect(validateFormField(stringField({ format: 'email' }), 'not-an-email')).toEqual({
      reason: 'format',
      format: 'email',
    });
    expect(validateFormField(stringField({ format: 'email' }), 'a@b.co')).toBeNull();
    expect(validateFormField(stringField({ format: 'uri' }), 'https://a.test/x')).toBeNull();
    expect(validateFormField(stringField({ format: 'date' }), '2026-09-17')).toBeNull();
    expect(validateFormField(stringField({ format: 'date' }), '17/09/2026')).toMatchObject({
      reason: 'format',
    });
  });

  test('an unparseable pattern from the engine cannot reject anything', () => {
    expect(validateFormField(stringField({ pattern: '([' }), 'anything')).toBeNull();
  });

  test('number bounds', () => {
    const field = parseFormField({ type: 'number', key: 'n', min: 1, max: 3 });
    if (!field) throw new Error('unreachable');
    expect(validateFormField(field, 0)).toEqual({ reason: 'min', limit: 1 });
    expect(validateFormField(field, 4)).toEqual({ reason: 'max', limit: 3 });
    expect(validateFormField(field, 2)).toBeNull();
  });

  test('an external or unknown field can never be invalid', () => {
    const external = parseFormField({ type: 'external', key: 'k', url: 'https://a.test' });
    const unknownField = parseFormField({ type: 'zzz', key: 'k', required: true });
    if (!external || !unknownField) throw new Error('unreachable');
    expect(validateFormField(external, undefined)).toBeNull();
    expect(validateFormField(unknownField, undefined)).toBeNull();
  });
});

describe('inbox', () => {
  test('items are OpenCode&apos;s verbatim camelCase', () => {
    const items = parseInboxItems({
      items: [
        {
          id: 'msg_1',
          sessionID: 'ses_1',
          timeCreated: 5,
          type: 'user',
          payload: { text: 'hello' },
          delivery: 'queue',
        },
        { id: 'msg_2', sessionID: 'ses_1', type: 'nonsense', payload: {}, delivery: 'weird' },
        { sessionID: 'ses_1' },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'msg_1',
      type: 'user',
      delivery: 'queue',
      timeCreated: 5,
    });
    // An unknown type is still an item that can be cancelled; the delivery
    // falls back to the documented default rather than to the wire's noise.
    expect(items[1]).toMatchObject({ type: 'unknown', delivery: 'steer' });
  });

  test('a bare array parses too', () => {
    expect(parseInboxItems([{ id: 'a', sessionID: 's', type: 'user' }])).toHaveLength(1);
  });

  test('the one line an item shows comes out of whatever shape the payload has', () => {
    expect(
      inboxItemText({
        id: 'a',
        sessionID: 's',
        type: 'user',
        payload: { text: 'x' },
        delivery: 'steer',
      })
    ).toBe('x');
    expect(
      inboxItemText({
        id: 'a',
        sessionID: 's',
        type: 'user',
        payload: { parts: [{ type: 'text', text: 'deep' }] },
        delivery: 'steer',
      })
    ).toBe('deep');
    expect(
      inboxItemText({ id: 'a', sessionID: 's', type: 'compaction', payload: {}, delivery: 'steer' })
    ).toBe('');
  });
});

describe('catalog', () => {
  const catalog = {
    models: [
      { id: 'union-alpha', name: 'Union Alpha', provider_id: 'opencode', enabled: true },
      { id: 'paid', name: 'Paid', provider_id: 'acme', enabled: false, status: 'needs key' },
    ],
    agents: [
      { id: 'build', name: 'Build', mode: 'primary', hidden: false },
      { id: 'explore', name: 'Explore', mode: 'subagent', hidden: false },
      { id: 'title', name: 'Title', mode: 'primary', hidden: true },
    ],
    mcp: [{ name: 'fs', status: 'ready' }],
    skills: [{ id: 's', name: 'S', description: 'd' }],
    providers: [
      {
        id: 'opencode',
        name: 'OpenCode',
        activation: 'auto',
        models: [
          { id: 'union-alpha', name: 'Union Alpha', enabled: true },
          { id: 'nemotron-3.5-lightning-free', name: 'Nemotron', enabled: true },
        ],
      },
      { id: 'acme', name: 'Acme', activation: 'disabled', models: [] },
    ],
    commands: [{ name: 'review', description: 'Review the branch', agent: 'plan' }],
    defaults: { model: { provider_id: 'opencode', model_id: 'union-alpha' }, agent: 'build' },
  };

  test('reads providers, commands and defaults', () => {
    const parsed = parseAgentCatalog(catalog);
    expect(parsed.providers.map((provider) => provider.id)).toEqual(['opencode', 'acme']);
    expect(parsed.providers[1].activation).toBe('disabled');
    expect(parsed.commands[0]).toMatchObject({ name: 'review', agent: 'plan' });
    expect(parsed.defaults.agent).toBe('build');
    expect(parsed.defaults.model?.model_id).toBe('union-alpha');
  });

  test('a skill carries whether it is a slash line and whether it auto-invokes', () => {
    const parsed = parseAgentCatalog({
      skills: [
        { id: 'commit-message', name: 'Commit message', description: 'd', slash: true },
        { id: 'pdf', name: 'PDF', description: 'p', autoinvoke: true, slash: false },
        { id: 'legacy', name: 'Legacy', description: 'l' },
        { id: '', name: 'Nameless' },
      ],
    });
    expect(parsed.skills.map((skill) => skill.id)).toEqual(['commit-message', 'pdf', 'legacy']);
    expect(parsed.skills[0]).toEqual({
      id: 'commit-message',
      name: 'Commit message',
      description: 'd',
      slash: true,
    });
    expect(parsed.skills[1].autoinvoke).toBe(true);
    // A catalog that predates the flag leaves it unset, which is not a yes.
    expect(parsed.skills[2].slash).toBeUndefined();
    expect(isSlashSkill(parsed.skills[0])).toBe(true);
    expect(isSlashSkill(parsed.skills[1])).toBe(false);
    expect(isSlashSkill(parsed.skills[2])).toBe(false);
  });

  test('a disabled provider and a disabled model are carried, not filtered', () => {
    const parsed = parseAgentCatalog(catalog);
    const paid = parsed.models.find((model) => model.id === 'paid');
    expect(paid?.enabled).toBe(false);
    expect(paid?.status).toBe('needs key');
  });

  test('a provider-only catalog still fills the flat model list', () => {
    const parsed = parseAgentCatalog({ providers: catalog.providers });
    expect(parsed.models.map((model) => model.id)).toEqual([
      'union-alpha',
      'nemotron-3.5-lightning-free',
    ]);
    expect(parsed.models[0].provider_id).toBe('opencode');
  });

  test('a model listed both flat and under its provider is not listed twice', () => {
    const parsed = parseAgentCatalog(catalog);
    expect(parsed.models.filter((model) => model.id === 'union-alpha')).toHaveLength(1);
  });

  test('a picker hides hidden agents and subagents', () => {
    const parsed = parseAgentCatalog(catalog);
    expect(selectableAgents(parsed.agents).map((agent) => agent.id)).toEqual(['build']);
  });

  test("a user's own agent is a choice, whatever mode it declares", () => {
    // The bug this filter was accused of: a project-defined agent from
    // `.opencode/agent` was said to be missing from the picker. It never was
    // -- the catalog was fetched without `?directory=`, so it was not in the
    // answer at all. Once it arrives, nothing here may drop it: `hidden` and
    // `mode: "subagent"` are the only two reasons to hide an entry, and a
    // custom agent declares `primary`, `all`, or no mode whatsoever.
    const parsed = parseAgentCatalog({
      agents: [
        { id: 'build', name: 'Build', mode: 'primary', hidden: false },
        {
          id: 'osuki-coder',
          name: 'osuki-coder',
          mode: 'primary',
          hidden: false,
          description: 'The house style, the house checks, and nothing else.',
        },
        { id: 'osuki-any', name: 'osuki-any', mode: 'all', hidden: false },
        { id: 'osuki-plain', name: 'osuki-plain', hidden: false },
        { id: 'osuki-helper', name: 'osuki-helper', mode: 'subagent', hidden: false },
        { id: 'Compaction', name: 'Compaction', hidden: true },
      ],
    });
    expect(selectableAgents(parsed.agents).map((agent) => agent.id)).toEqual([
      'build',
      'osuki-coder',
      'osuki-any',
      'osuki-plain',
    ]);
    const custom = parsed.agents.find((agent) => agent.id === 'osuki-coder');
    expect(custom?.description).toBe('The house style, the house checks, and nothing else.');
  });

  test('an empty answer is an empty catalog, never undefined fields', () => {
    const parsed = parseAgentCatalog(null);
    expect(parsed.models).toEqual([]);
    expect(parsed.commands).toEqual([]);
    expect(parsed.defaults).toEqual({});
  });
});

describe('context, shells, engine, diff', () => {
  test('context usage flattens the nested cache counters', () => {
    const usage = parseAgentContextUsage({
      messages: 12,
      tokens: { input: 20801, output: 41, reasoning: 134, cache: { read: 3, write: 4 } },
    });
    expect(usage.messages).toBe(12);
    expect(usage.tokens).toMatchObject({ input: 20801, cache_read: 3, cache_write: 4 });
    // The cached half of the input is input the model still read.
    expect(contextTokenTotal(usage.tokens)).toBe(20801 + 41 + 134 + 3);
  });

  test('tokens may be null, and the ring has nothing to fill', () => {
    const usage = parseAgentContextUsage({ messages: 0, tokens: null });
    expect(usage.tokens).toBeNull();
    expect(contextTokenTotal(usage.tokens)).toBe(0);
    expect(contextFillRatio(usage.tokens, 200000)).toBe(0);
    expect(contextFillRatio({ input: 1, output: 0 }, undefined)).toBeNull();
    expect(contextFillRatio({ input: 1, output: 0 }, 0)).toBeNull();
    expect(contextFillRatio({ input: 100, output: 100 }, 400)).toBeCloseTo(0.5);
    // Over the limit still reads as full rather than as more than full.
    expect(contextFillRatio({ input: 1000, output: 0 }, 100)).toBe(1);
  });

  test('shells are OpenCode&apos;s own camelCase shape', () => {
    const shells = parseShellList([
      {
        id: 'sh_1',
        status: 'running',
        command: 'sleep 20',
        cwd: '/tmp',
        pid: 4,
        metadata: { foo: 1 },
        time: { created: 1 },
      },
      { status: 'exited' },
    ]);
    expect(shells).toHaveLength(1);
    expect(shells[0]).toMatchObject({ id: 'sh_1', status: 'running', pid: 4 });
    expect(parseShellList([{ id: 'sh_2', status: 'vanished' }])[0].status).toBe('running');
  });

  test('a shell output page', () => {
    expect(parseShellOutputPage({ output: 'a', cursor: 10, size: 22, truncated: true })).toEqual({
      output: 'a',
      cursor: 10,
      size: 22,
      truncated: true,
    });
    expect(parseShellOutputPage('nope')).toEqual({
      output: '',
      cursor: 0,
      size: 0,
      truncated: false,
    });
  });

  test('engine status explains a 503 rather than pretending to be up', () => {
    expect(
      parseAgentEngineInfo({
        available: true,
        origin: 'adopted',
        url: 'http://127.0.0.1:49374',
        version: '2.0.1',
        stream_connected: true,
        autostart: true,
      })
    ).toMatchObject({ available: true, origin: 'adopted', version: '2.0.1' });
    expect(parseAgentEngineInfo({})).toMatchObject({ available: false, origin: 'none' });
  });

  test('a file diff reads either spelling of its fields', () => {
    expect(
      parseFileDiffItems([
        { path: 'a.ts', patch: '@@', additions: 2, deletions: 1 },
        { file: 'b.ts', patch: '@@', additions: 0, deletions: 0 },
        { nothing: true },
      ])
    ).toEqual([
      { path: 'a.ts', patch: '@@', additions: 2, deletions: 1 },
      { path: 'b.ts', patch: '@@', additions: 0, deletions: 0 },
    ]);
  });

  test('a diff mode is one of three, and `working` is the default', () => {
    expect(parseVcsDiffMode('branch')).toBe('branch');
    expect(parseVcsDiffMode('committed')).toBe('committed');
    expect(parseVcsDiffMode('sideways')).toBe('working');
    expect(parseVcsDiffMode(undefined)).toBe('working');
  });
});

describe('domain events', () => {
  test('the SSE name and the payload type agree, and either may be missing', () => {
    const byName = parseAgentDomainEvent('agent.status.changed', {
      asid: 'ses_1',
      status: 'failed',
      error: { name: 'unknown', message: 'Agent not found', status: 500 },
      seq: 3,
    });
    expect(byName).toMatchObject({ type: 'agent.status.changed', status: 'failed', seq: 3 });
    expect(byName?.type === 'agent.status.changed' && byName.error?.message).toBe(
      'Agent not found'
    );

    const byPayload = parseAgentDomainEvent('', {
      type: 'agent.status.changed',
      asid: 'ses_1',
      status: 'idle',
    });
    expect(byPayload?.type).toBe('agent.status.changed');
  });

  test('compaction and inbox name the session `session_id`', () => {
    const compaction = parseAgentDomainEvent('agent.compaction.changed', {
      session_id: 'ses_1',
      status: 'running',
      reason: 'manual',
      delta: '## Objective',
      seq: 20,
    });
    expect(compaction).toMatchObject({
      asid: 'ses_1',
      status: 'running',
      reason: 'manual',
      delta: '## Objective',
    });

    const inbox = parseAgentDomainEvent('agent.inbox.changed', {
      session_id: 'ses_1',
      seq: 21,
      items: [{ id: 'msg_1', sessionID: 'ses_1', type: 'user', delivery: 'queue' }],
    });
    expect(inbox?.type === 'agent.inbox.changed' && inbox.items).toHaveLength(1);
    expect(inbox?.asid).toBe('ses_1');
  });

  test('an inbox change with an empty queue is still an event', () => {
    const inbox = parseAgentDomainEvent('agent.inbox.changed', { session_id: 'ses_1', items: [] });
    expect(inbox?.type === 'agent.inbox.changed' && inbox.items).toEqual([]);
  });

  test('timeline upsert accepts one item or many, and drops an empty frame', () => {
    const many = parseAgentDomainEvent('agent.timeline.upsert', {
      asid: 'ses_1',
      seq: 14,
      items: [{ id: 'msg_1:t0', part: { type: 'text', text: 'a' } }],
    });
    expect(many?.type === 'agent.timeline.upsert' && many.items).toHaveLength(1);
    const one = parseAgentDomainEvent('agent.timeline.upsert', {
      asid: 'ses_1',
      item: { id: 'msg_1:t0', part: { type: 'text', text: 'a' } },
    });
    expect(one?.type === 'agent.timeline.upsert' && one.items).toHaveLength(1);
    expect(parseAgentDomainEvent('agent.timeline.upsert', { asid: 'ses_1', items: [] })).toBeNull();
  });

  test('removed, resolved and resync', () => {
    expect(
      parseAgentDomainEvent('agent.timeline.removed', { asid: 'ses_1', ids: ['msg_1:t0'] })
    ).toMatchObject({ ids: ['msg_1:t0'] });
    expect(parseAgentDomainEvent('agent.timeline.removed', { asid: 'ses_1', ids: [] })).toBeNull();
    expect(
      parseAgentDomainEvent('agent.permission.resolved', { asid: 'ses_1', request_id: 'per_1' })
    ).toMatchObject({ request_id: 'per_1' });
    expect(
      parseAgentDomainEvent('agent.form.resolved', { asid: 'ses_1', form_id: 'frm_1' })
    ).toMatchObject({ form_id: 'frm_1' });
    expect(
      parseAgentDomainEvent('agent.resync', { asid: '', reason: 'event_backlog_overflow' })
    ).toMatchObject({ asid: '', reason: 'event_backlog_overflow' });
  });

  test('the gateway&apos;s own `connected` frame is not a domain event', () => {
    expect(parseAgentDomainEvent('connected', { asid: 'ses_1' })).toBeNull();
  });

  test('a session update with an unreadable info is dropped', () => {
    expect(parseAgentDomainEvent('agent.session.updated', { asid: 'ses_1', info: {} })).toBeNull();
  });
});

describe('titles and model names', () => {
  test('a raw ses_ id is never a title', () => {
    expect(hasRealSessionTitle({ title: 'ses_abc123', asid: 'ses_abc123' })).toBe(false);
    expect(hasRealSessionTitle({ title: 'ses_abc123' })).toBe(false);
    expect(hasRealSessionTitle({ title: '   ', asid: 'ses_1' })).toBe(false);
    expect(hasRealSessionTitle(undefined)).toBe(false);
    expect(hasRealSessionTitle({ title: 'Count the files', asid: 'ses_1' })).toBe(true);
    // A title that merely starts with the word is a title.
    expect(hasRealSessionTitle({ title: 'ses_ and the rest', asid: 'ses_1' })).toBe(true);
  });

  test('the fallback is used until the auto-title lands', () => {
    expect(sessionTitleOr({ title: 'ses_1', asid: 'ses_1' }, 'Untitled session')).toBe(
      'Untitled session'
    );
    expect(sessionTitleOr({ title: '  Real  ', asid: 'ses_1' }, 'Untitled session')).toBe('Real');
    expect(sessionTitleOr(null, 'Untitled session')).toBe('Untitled session');
  });

  test('free models are recognised by their price list, then by name', () => {
    const free = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }];
    const paid = [{ input: 5, output: 25, cache: { read: 0.5, write: 6.25 } }];
    expect(isFreeModel({ id: 'union-alpha', provider_id: 'opencode', cost: free })).toBe(true);
    // A paid model hosted by the free provider is still paid.
    expect(isFreeModel({ id: 'claude-opus-5', provider_id: 'opencode', cost: paid })).toBe(false);
    // Without a price list only the name can say so; the provider never does.
    expect(isFreeModel({ id: 'nemotron-3.5-lightning-free', provider_id: 'opencode' })).toBe(true);
    expect(isFreeModel({ id: 'anything', provider_id: 'opencode' })).toBe(false);
    expect(isFreeModel({ id: 'gpt-6-astra', provider_id: 'openai' })).toBe(false);
  });

  test('a model name falls back to a readable spelling of its id', () => {
    expect(formatModelName({ provider_id: 'opencode', model_id: 'gpt-6-astra' })).toBe(
      'GPT-6 Astra'
    );
    // A word of three letters or fewer is an acronym often enough (`gpt`,
    // `xai`, `llm`) that upper-casing it is the better guess.
    expect(formatModelName({ provider_id: 'x', model_id: 'some-new-model' })).toBe(
      'Some NEW Model'
    );
    expect(
      formatModelName({ provider_id: 'x', model_id: 'some-new-model', variant: 'xhigh' })
    ).toBe('Some NEW Model · Max');
    expect(formatModelName(null)).toBe('Model');
    expect(formatModelName(undefined, 'Pick one')).toBe('Pick one');
  });
});

describe('a tool part whose input is still streaming', () => {
  test('input_partial is kept, under either spelling', () => {
    const part = parseAgentPart({
      type: 'tool',
      id: 'call_1',
      name: 'shell',
      state: 'streaming',
      input_partial: '{"command":"echo pro',
    });
    expect(part?.type).toBe('tool');
    expect(part && part.type === 'tool' ? part.input_partial : undefined).toBe(
      '{"command":"echo pro'
    );
    const camel = parseAgentPart({
      type: 'tool',
      id: 'call_2',
      name: 'shell',
      state: 'streaming',
      inputPartial: '{"command":"e',
    });
    expect(camel && camel.type === 'tool' ? camel.input_partial : undefined).toBe('{"command":"e');
  });

  test('a part that never streamed carries no partial at all', () => {
    const part = parseAgentPart({
      type: 'tool',
      id: 'call_3',
      name: 'shell',
      state: 'completed',
      input: { command: 'ls' },
    });
    expect(part && part.type === 'tool' ? 'input_partial' in part : true).toBe(false);
  });
});
