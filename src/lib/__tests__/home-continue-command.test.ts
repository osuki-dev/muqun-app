import { describe, expect, test } from 'bun:test';

import {
  createHomeCommandController,
  embeddedResumeRoute,
  type HomeNavigation,
} from '../home-commands';
import { homeContinueCommand } from '../home-continue';

describe('Continue row destination -> Home command', () => {
  test('a pane row resumes its server on that pane', () => {
    expect(
      homeContinueCommand({ type: 'pane', serverId: 'a', paneId: 'wK:p3', cwd: '/work/app' })
    ).toEqual({
      type: 'resume-server',
      target: { kind: 'gateway-terminal', serverId: 'a', paneId: 'wK:p3' },
    });
  });

  test('a pane row without a pane id resumes the server alone', () => {
    expect(homeContinueCommand({ type: 'pane', serverId: 'a' })).toEqual({
      type: 'resume-server',
      target: { kind: 'gateway-terminal', serverId: 'a' },
    });
  });

  test('remembered terminal, agent and SSH targets resume by their own kind', () => {
    const terminal = {
      kind: 'gateway-terminal' as const,
      serverId: 'a',
      sessionId: 's',
      paneId: 'p1',
    };
    const agent = {
      kind: 'agent-session' as const,
      serverId: 'a',
      sessionId: 's',
      directory: '/work',
      asid: 'ses_1',
      agentId: 'deepseek',
    };
    const ssh = { kind: 'ssh-host' as const, hostId: 'h1' };
    for (const target of [terminal, agent, ssh]) {
      expect(homeContinueCommand({ type: 'recent', target })).toEqual({
        type: 'resume-target',
        target,
      });
    }
  });

  test('the controller sends each command to the matching destination', async () => {
    const navigations: HomeNavigation[] = [];
    const resumed: unknown[] = [];
    let selected: string | null = 'a';
    const controller = createHomeCommandController({
      hasServer: () => true,
      selectServerNow: (id) => {
        selected = id;
        return true;
      },
      selectServer: async () => true,
      selectedServerId: () => selected,
      loadTerminalSelection: async () => null,
      validateTarget: async () => true,
      navigate: (destination) => navigations.push(destination),
      resumeServer: (target) => {
        resumed.push(target);
        return true;
      },
    });
    await controller.dispatch(homeContinueCommand({ type: 'pane', serverId: 'a', paneId: 'p3' }));
    await controller.dispatch(
      homeContinueCommand({
        type: 'recent',
        target: { kind: 'gateway-terminal', serverId: 'a', sessionId: 's', paneId: 'p1' },
      })
    );
    await controller.dispatch(
      homeContinueCommand({
        type: 'recent',
        target: {
          kind: 'agent-session',
          serverId: 'a',
          sessionId: 's',
          directory: '/work',
          asid: 'ses_1',
          agentId: 'deepseek',
        },
      })
    );
    await controller.dispatch(
      homeContinueCommand({ type: 'recent', target: { kind: 'ssh-host', hostId: 'h1' } })
    );
    expect(resumed).toEqual([
      { kind: 'gateway-terminal', serverId: 'a', paneId: 'p3' },
      { kind: 'gateway-terminal', serverId: 'a', sessionId: 's', paneId: 'p1' },
    ]);
    expect(navigations).toEqual([
      {
        type: 'agent',
        target: {
          kind: 'agent-session',
          serverId: 'a',
          sessionId: 's',
          directory: '/work',
          asid: 'ses_1',
          agentId: 'deepseek',
        },
        intent: 'existing',
      },
      { type: 'ssh', hostId: 'h1' },
    ]);
  });
});

describe('embedded overview resume', () => {
  test('a root-owned workspace always takes the handoff', () => {
    expect(
      embeddedResumeRoute({ routeBound: false, workspaceServerId: 'a', targetServerId: 'b' })
    ).toBe('handoff');
  });

  test("a route-bound workspace takes its own server's pane as a handoff", () => {
    expect(
      embeddedResumeRoute({ routeBound: true, workspaceServerId: 'a', targetServerId: 'a' })
    ).toBe('handoff');
  });

  test('a route-bound workspace routes to another server', () => {
    expect(
      embeddedResumeRoute({ routeBound: true, workspaceServerId: 'a', targetServerId: 'b' })
    ).toBe('route');
    expect(
      embeddedResumeRoute({ routeBound: true, workspaceServerId: undefined, targetServerId: 'b' })
    ).toBe('route');
  });
});
