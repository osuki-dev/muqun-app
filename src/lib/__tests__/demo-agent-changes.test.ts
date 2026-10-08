import { describe, expect, test } from 'bun:test';

import { agentChangesApi } from '../changes-api';
import { changesWorktreeContext } from '../changes-worktree-context';
import {
  DEMO_AGENT_CHANGES_ASID,
  DEMO_AGENT_CHANGES_DIRECTORY,
  DEMO_AGENT_CHANGES_SESSION_ID,
  demoAgentChangesFixture,
} from '../demo-agent-changes';

describe('isolated offline agent Changes fixture', () => {
  test('requires both reserved identities and never stands in for another session', () => {
    expect(demoAgentChangesFixture('real-gateway', DEMO_AGENT_CHANGES_ASID)).toBeUndefined();
    expect(demoAgentChangesFixture(DEMO_AGENT_CHANGES_SESSION_ID, 'real-agent')).toBeUndefined();
  });

  test('proves a managed checkout whose name differs from the branch', async () => {
    const fixture = demoAgentChangesFixture(DEMO_AGENT_CHANGES_SESSION_ID, DEMO_AGENT_CHANGES_ASID);
    if (!fixture) throw new Error('Missing isolated demo fixture');
    const listing = await fixture.listWorktrees(fixture.directory);
    expect(
      changesWorktreeContext(fixture.directory, {
        directory: fixture.directory,
        entries: listing.entries,
        revision: 0,
      })
    ).toEqual({
      name: 'quiet-river',
      directory: DEMO_AGENT_CHANGES_DIRECTORY,
    });
    expect(
      changesWorktreeContext('/demo/muqun', {
        directory: '/demo/muqun',
        entries: listing.entries,
        revision: 0,
      })
    ).toBeUndefined();
    expect((await fixture.listWorktrees('/another-project')).entries).toEqual([]);
    const api = agentChangesApi(
      { sessionId: DEMO_AGENT_CHANGES_SESSION_ID, asid: DEMO_AGENT_CHANGES_ASID, filesApi: false },
      fixture.client
    );
    const changes = await api.listing('working');
    expect(changes.repo?.branch).toBe('feat/diff-context');
    expect(changes.changes[0]?.path).toBe('context.txt');
    expect(changes.patches.get('context.txt')).toContain('+verified context');
    expect(api.discard).toBeUndefined();
  });
});
