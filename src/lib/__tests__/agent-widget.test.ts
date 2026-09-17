import * as bunTest from 'bun:test';

const { describe, expect, test } = bunTest;
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

mockModule('react-native', () => ({
  Platform: { OS: 'android', Version: '34' },
}));

mockModule('expo-secure-store', () => ({
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

const { agentWidgetUri, computeSummaryStatus, sortAgentWidgetEntries } =
  await import('../agent-widget');

type AgentWidgetEntry = import('../agent-widget').AgentWidgetEntry;
type AgentWidgetSnapshot = import('../agent-widget').AgentWidgetSnapshot;

describe('agent-widget', () => {
  describe('sortAgentWidgetEntries', () => {
    test('surfaces blocked entries first, then working, then done, then idle', () => {
      const entries: AgentWidgetEntry[] = [
        { id: '1', name: 'Idle Agent', status: 'idle', paneId: '%1' },
        { id: '2', name: 'Working Agent', status: 'working', paneId: '%2' },
        { id: '3', name: 'Blocked Agent', status: 'blocked', paneId: '%3' },
        { id: '4', name: 'Done Agent', status: 'done', paneId: '%4' },
      ];

      const sorted = sortAgentWidgetEntries(entries);
      expect(sorted.map((e) => e.name)).toEqual([
        'Blocked Agent',
        'Working Agent',
        'Done Agent',
        'Idle Agent',
      ]);
    });

    test('prioritizes isBlocked flag above all other statuses', () => {
      const entries: AgentWidgetEntry[] = [
        { id: '1', name: 'Working Agent', status: 'working', paneId: '%1' },
        {
          id: '2',
          name: 'Action Needed Agent',
          status: 'working',
          paneId: '%2',
          isBlocked: true,
        },
      ];

      const sorted = sortAgentWidgetEntries(entries);
      expect(sorted[0].name).toBe('Action Needed Agent');
    });
  });

  describe('computeSummaryStatus', () => {
    test('identifies blocked as summary status if any entry is blocked', () => {
      const entries: AgentWidgetEntry[] = [
        { id: '1', name: 'Agent A', status: 'working', paneId: '%1' },
        { id: '2', name: 'Agent B', status: 'blocked', paneId: '%2' },
      ];
      expect(computeSummaryStatus(entries)).toBe('blocked');
    });

    test('identifies working if no blocked entries exist', () => {
      const entries: AgentWidgetEntry[] = [
        { id: '1', name: 'Agent A', status: 'done', paneId: '%1' },
        { id: '2', name: 'Agent B', status: 'working', paneId: '%2' },
      ];
      expect(computeSummaryStatus(entries)).toBe('working');
    });

    test('falls back to idle or unknown when empty or idle', () => {
      expect(computeSummaryStatus([])).toBe('unknown');
      expect(
        computeSummaryStatus([{ id: '1', name: 'Agent A', status: 'idle', paneId: '%1' }])
      ).toBe('idle');
    });
  });

  describe('agentWidgetUri', () => {
    const snapshot: AgentWidgetSnapshot = {
      version: 1,
      serverId: 'srv-1',
      serverLabel: 'MacBook',
      sessionId: 'ses-1',
      checkedAtMs: Date.now(),
      agents: [],
    };

    test('routes opencode agents to muqun://agent with asid', () => {
      const entry: AgentWidgetEntry = {
        id: 'asid-123',
        name: 'OpenCode Assistant',
        status: 'working',
        paneId: '%5',
        engine: 'opencode',
      };
      expect(agentWidgetUri(snapshot, entry)).toBe('muqun://agent?asid=asid-123&paneId=%255');
    });

    test('routes tmux / herdr panes to muqun://servers with serverId and sessionId', () => {
      const entry: AgentWidgetEntry = {
        id: 'pane-456',
        name: 'Build Shell',
        status: 'working',
        paneId: '%8',
        engine: 'tmux',
      };
      expect(agentWidgetUri(snapshot, entry)).toBe(
        'muqun://servers/srv-1?sessionId=ses-1&paneId=%258'
      );
    });
  });
});
