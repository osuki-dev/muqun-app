import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { productionSource, transpile, walk } from '../../test-support/production-source';
import { advanceSeq, askCatchUp } from '../agent-catch-up';
import { replaceAgentTranscript, type AgentSessionRuntime } from '../agent-session-runtime';

const source = productionSource('src/components/agent-workbench.tsx');
let callback = '';
walk(source.program, (node) => {
  if (
    node.type === 'VariableDeclarator' &&
    node.id.type === 'Identifier' &&
    node.id.name === 'catchUp'
  ) {
    callback = source.code(node.init!);
  }
});

test('recovered foreground replies are read; external history, background, superseded and running sessions are not', async () => {
  expect(callback).not.toBe('');
  for (const scenario of [
    'foreground',
    'background',
    'superseded',
    'running',
    'external',
    'persisted',
  ] as const) {
    const marked: string[] = [];
    let timelineWrites = 0;
    const applied: [string, number][] = [];
    const activeAsidRef = { current: 'session-a' };
    let resolve!: (delta: unknown) => void;
    const delta = new Promise((yes) => {
      resolve = yes;
    });
    const run = runInNewContext(transpile(callback), {
      useCallback: (fn: () => void) => fn,
      activeAsidRef,
      syncRef: { current: { seq: 5, owed: false } },
      appActiveRef: { current: scenario !== 'background' },
      readRuntime: (): AgentSessionRuntime | undefined =>
        scenario === 'external' || scenario === 'persisted'
          ? {
              source: 'terminal',
              interaction: 'unavailable',
              status: 'idle',
              ...(scenario === 'persisted' ? { transcript: 'persisted' } : {}),
            }
          : undefined,
      replaceAgentTranscript,
      askCatchUp,
      advanceSeq,
      sessionId: 'backend-a',
      loadSnapshot: () => {},
      setTimeline: () => {
        timelineWrites++;
      },
      setSessionInfo: () => {},
      getAgentTimelineDelta: () => delta,
      markAgentSessionViewed: async (asid: string) => {
        marked.push(asid);
        return 123;
      },
      applyViewed: (asid: string, viewed: number) => applied.push([asid, viewed]),
    });
    run();
    if (scenario === 'superseded') activeAsidRef.current = 'session-b';
    resolve({
      resync: false,
      items: [{ id: 'new-history-row' }],
      status: scenario === 'running' ? 'busy' : 'idle',
      latest_seq: 6,
    });
    await new Promise((yes) => setImmediate(yes));
    expect(timelineWrites).toBe(scenario === 'external' || scenario === 'superseded' ? 0 : 1);
    expect(marked).toEqual(
      scenario === 'foreground' || scenario === 'persisted' ? ['session-a'] : []
    );
    expect(applied).toEqual(
      scenario === 'foreground' || scenario === 'persisted' ? [['session-a', 123]] : []
    );
  }
});
