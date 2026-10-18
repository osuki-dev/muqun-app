import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import {
  isMentionsRefusal,
  ledgerTaskBody,
  parseCreatedLedgerTask,
  type createLedgerTask,
} from '../task-ledger';

type Body = Record<string, string | string[]>;
function ledgerCaller(
  loadGateway: () => Promise<{ postLedgerTask: (body: Body) => Promise<unknown> }>
) {
  // Execute the production async dispatch/retry body. Only the native client's
  // dynamic import is substituted, so tests can move the selected destination.
  const source = declaration('src/lib/task-ledger.ts', 'createLedgerTask').replace(
    "await import('./gateway-client')",
    'await loadGateway()'
  );
  return runInNewContext(transpile(`${source}\ncreateLedgerTask`), {
    loadGateway,
    ledgerTaskBody,
    parseCreatedLedgerTask,
    isMentionsRefusal,
  }) as typeof createLedgerTask;
}

const refusal = () => new Error('Open task: 400 {"error":{"code":"invalid_mentions"}}');
const request = {
  goal: 'Read /home/ryu/uploads/a.webp',
  agentId: 'codex',
  mentions: ['mini'],
};

test('a destination change during client loading prevents the first post', async () => {
  let owns = true;
  const posts: Body[] = [];
  const create = ledgerCaller(async () => {
    owns = false;
    return {
      postLedgerTask: async (body) => {
        posts.push(body);
        return {};
      },
    };
  });
  expect(await create(request, () => owns)).toBeNull();
  expect(posts).toEqual([]);
});

test('a mentions refusal cannot retry uploaded host paths on another computer', async () => {
  let selected = 'computer-a';
  const posts: { destination: string; body: Body }[] = [];
  const create = ledgerCaller(async () => ({
    postLedgerTask: async (body) => {
      posts.push({ destination: selected, body });
      selected = 'computer-b';
      throw refusal();
    },
  }));
  expect(await create(request, () => selected === 'computer-a')).toBeNull();
  expect(posts).toEqual([{ destination: 'computer-a', body: ledgerTaskBody(request) }]);
});

test('the owning computer still gets exactly one retry without mentions', async () => {
  const posts: Body[] = [];
  const create = ledgerCaller(async () => ({
    postLedgerTask: async (body) => {
      posts.push(body);
      if (posts.length === 1) throw refusal();
      return {
        task_id: 'task-a',
        kind: 'delegation',
        state: 'working',
        goal: request.goal,
        updated_ms: 1,
      };
    },
  }));
  expect((await create(request, () => true))?.task.taskId).toBe('task-a');
  expect(posts).toEqual([
    ledgerTaskBody(request),
    ledgerTaskBody({ goal: request.goal, agentId: request.agentId }),
  ]);
});
