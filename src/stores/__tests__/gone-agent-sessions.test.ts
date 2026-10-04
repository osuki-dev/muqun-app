import { expect, test } from 'bun:test';

import { goneSessionKey } from '@/lib/home-continue';
import { createHomeRecentsStore } from '@/lib/home-recents-state';
import { useGoneAgentSessions } from '../gone-agent-sessions';

test('markGone remembers one gateway session, once', () => {
  const { markGone } = useGoneAgentSessions.getState();
  markGone('osk', 'ses_1');
  const first = useGoneAgentSessions.getState().keys;
  markGone('osk', 'ses_1');
  expect(useGoneAgentSessions.getState().keys).toBe(first);
  expect(first.has(goneSessionKey('osk', 'ses_1'))).toBe(true);
  expect(first.has(goneSessionKey('other', 'ses_1'))).toBe(false);
});

test('a gone session is forgotten from recents by its target', async () => {
  const store = createHomeRecentsStore({ load: async () => null, save: async () => {} });
  await store.getState().hydrate();
  const gone = {
    kind: 'agent-session' as const,
    serverId: 'osk',
    sessionId: 'dev',
    directory: '/deleted',
    asid: 'ses_1',
  };
  const kept = { ...gone, directory: '/kept', asid: 'ses_2' };
  await store.getState().visit(kept, 'Kept', 1);
  await store.getState().visit(gone, 'Greeting', 2);
  await store.getState().remove(gone);
  expect(store.getState().entries.map((entry) => entry.target)).toEqual([kept]);
});
