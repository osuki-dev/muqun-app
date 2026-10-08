import { parseAgentVcsDiff, type AgentWorktreeListing } from './agent-protocol';
import type { AgentChangesClient } from './changes-api';

/** Isolated native QA data: not the shared session-tree or homepage fixture. */
export const DEMO_AGENT_CHANGES_SESSION_ID = 'demo-agent-changes';
export const DEMO_AGENT_CHANGES_ASID = 'demo-worktree-changes';
export const DEMO_AGENT_CHANGES_DIRECTORY = '/demo/worktrees/quiet-river';

export interface DemoAgentChangesFixture {
  directory: string;
  client: AgentChangesClient;
  listWorktrees: (directory: string) => Promise<AgentWorktreeListing>;
}

const FIXTURE: DemoAgentChangesFixture = {
  directory: DEMO_AGENT_CHANGES_DIRECTORY,
  client: {
    files: async () => null,
    file: async () => {
      throw new Error('The offline Changes fixture uses eager patches.');
    },
    discard: async () => {
      throw new Error('The offline Changes fixture does not support discard.');
    },
    diff: async () =>
      parseAgentVcsDiff({
        vcs: 'git',
        repo: {
          branch: 'feat/diff-context',
          head: '0123456789abcdef',
          detached: false,
        },
        files: [
          {
            path: 'context.txt',
            additions: 1,
            deletions: 1,
            patch: '@@ -1 +1 @@\n-old context\n+verified context\n',
          },
        ],
      }),
  },
  listWorktrees: async (directory) => ({
    entries:
      directory === DEMO_AGENT_CHANGES_DIRECTORY
        ? [
            { directory: '/demo/muqun' },
            { directory: DEMO_AGENT_CHANGES_DIRECTORY, strategy: 'git' },
          ]
        : [],
  }),
};

/** Caller must also gate on demo mode; ordinary route identities never match. */
export function demoAgentChangesFixture(
  sessionId: string,
  asid: string
): DemoAgentChangesFixture | undefined {
  return sessionId === DEMO_AGENT_CHANGES_SESSION_ID && asid === DEMO_AGENT_CHANGES_ASID
    ? FIXTURE
    : undefined;
}
