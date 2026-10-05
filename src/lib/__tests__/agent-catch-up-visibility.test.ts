import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { productionSource, transpile, walk } from '../../test-support/production-source';
import { advanceSeq, askCatchUp } from '../agent-catch-up';

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

test('recovered foreground replies are read; background, superseded and running sessions are not', async () => {
  expect(callback).not.toBe('');
  for (const scenario of ['foreground', 'background', 'superseded', 'running'] as const) {
    const marked: string[] = [];
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
      askCatchUp,
      advanceSeq,
      sessionId: 'backend-a',
      loadSnapshot: () => {},
      setTimeline: () => {},
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
      items: [],
      status: scenario === 'running' ? 'busy' : 'idle',
      latest_seq: 6,
    });
    await new Promise((yes) => setImmediate(yes));
    expect(marked).toEqual(scenario === 'foreground' ? ['session-a'] : []);
    expect(applied).toEqual(scenario === 'foreground' ? [['session-a', 123]] : []);
  }
});
