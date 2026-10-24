import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import type { sendAgentPrompt } from '../agent-session';

test('a follow-up carries immutable references once and surfaces preparation refusals', async () => {
  const writes: unknown[] = [];
  const prompt = runInNewContext(
    transpile(`${declaration('src/lib/agent-session.ts', 'sendAgentPrompt')}\nsendAgentPrompt`),
    {
      sessionRoute: (asid: string) => `/api/agent-sessions/${asid}/prompt`,
      writeJson: async (path: string, _what: string, body: unknown) => {
        writes.push({ path, body });
        throw new Error('Computer tools are not ready');
      },
    }
  ) as typeof sendAgentPrompt;
  await expect(
    prompt(undefined, 'conversation-a', {
      text: '@mini inspect',
      computerIds: ['machine-a'],
      attachments: ['uploaded-file'],
      delivery: 'queue',
    })
  ).rejects.toThrow('Computer tools are not ready');
  expect(writes).toEqual([
    {
      path: '/api/agent-sessions/conversation-a/prompt',
      body: {
        text: '@mini inspect',
        computer_ids: ['machine-a'],
        attachments: ['uploaded-file'],
        delivery: 'queue',
      },
    },
  ]);
});
