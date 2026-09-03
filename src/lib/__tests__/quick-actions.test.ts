import { describe, expect, test } from 'bun:test';

import { quickActionAvailability, type QuickActionParams } from '../quick-actions';

/** The sheet as the lightning button opens it: a live pane on a capable gateway. */
const overALivePane: QuickActionParams = {
  sessionId: 'session-1',
  paneId: '%3',
  serverId: 'server-1',
  spawnSupported: true,
  webServiceSupported: true,
  agentTarget: 'agent-1',
  agentStatus: 'working',
  manageOnly: false,
};

describe('quickActionAvailability', () => {
  test('offers every row over a working agent on a capable gateway', () => {
    expect(quickActionAvailability(overALivePane)).toEqual({
      webServiceBlockedByTunnel: false,
      canCreate: true,
      canStartTask: true,
      canStopAgent: true,
      canOpenWebService: true,
      canPreviewSimulator: true,
      hasActions: true,
    });
  });

  test('the Settings entry gets the shortcut list and nothing else', () => {
    const availability = quickActionAvailability({ ...overALivePane, manageOnly: true });
    expect(availability.canCreate).toBe(false);
    expect(availability.canStartTask).toBe(false);
    expect(availability.canStopAgent).toBe(false);
    expect(availability.canOpenWebService).toBe(false);
    expect(availability.hasActions).toBe(false);
  });

  test('a gateway that cannot spawn keeps New task and Stop off the sheet', () => {
    const availability = quickActionAvailability({ ...overALivePane, spawnSupported: false });
    expect(availability.canCreate).toBe(true);
    expect(availability.canStartTask).toBe(false);
    expect(availability.canStopAgent).toBe(false);
  });

  test('an idle agent is not offered Stop', () => {
    expect(quickActionAvailability({ ...overALivePane, agentStatus: 'idle' }).canStopAgent).toBe(
      false
    );
  });

  test('a working agent with nothing to address is not offered Stop', () => {
    expect(quickActionAvailability({ ...overALivePane, agentTarget: '' }).canStopAgent).toBe(false);
  });

  test('a pane with no agent at all is not offered Stop', () => {
    const availability = quickActionAvailability({
      ...overALivePane,
      agentTarget: '',
      agentStatus: '',
    });
    expect(availability.canStopAgent).toBe(false);
    expect(availability.canCreate).toBe(true);
  });

  test('a transport that cannot be trusted with a plain URL loses only that row', () => {
    const availability = quickActionAvailability({
      ...overALivePane,
      webServiceSupported: false,
    });
    expect(availability.canOpenWebService).toBe(false);
    expect(availability.canCreate).toBe(true);
    expect(availability.hasActions).toBe(true);
  });

  test('the web service row survives without a pane, because it is about the machine', () => {
    const availability = quickActionAvailability({
      ...overALivePane,
      sessionId: undefined,
      paneId: undefined,
    });
    expect(availability.canCreate).toBe(false);
    expect(availability.canOpenWebService).toBe(true);
    expect(availability.hasActions).toBe(true);
  });

  test('nothing to act on leaves no action block to separate from the list', () => {
    const availability = quickActionAvailability({
      sessionId: 'session-1',
      paneId: '%3',
      serverId: undefined,
      spawnSupported: true,
      webServiceSupported: true,
      manageOnly: false,
    });
    expect(availability.hasActions).toBe(false);
  });
});

describe('the simulator preview row', () => {
  test('is offered exactly when the web service row is', () => {
    // They reach the same machine the same way, so they stand or fall together
    // until someone deliberately separates them.
    for (const webServiceSupported of [true, false]) {
      const availability = quickActionAvailability({
        serverId: 'srv-a',
        sessionId: 'sess',
        paneId: 'wM:p1',
        spawnSupported: true,
        webServiceSupported,
        manageOnly: false,
      });
      expect(availability.canPreviewSimulator).toBe(availability.canOpenWebService);
      expect(availability.canPreviewSimulator).toBe(webServiceSupported);
    }
  });

  test('needs a server but not a pane: a simulator belongs to the machine', () => {
    const availability = quickActionAvailability({
      serverId: 'srv-a',
      spawnSupported: false,
      webServiceSupported: true,
      manageOnly: false,
    });
    expect(availability.canPreviewSimulator).toBe(true);
    expect(availability.canCreate).toBe(false);
  });

  test('is never offered from the Settings entry, which has no machine in front of it', () => {
    const availability = quickActionAvailability({
      serverId: 'srv-a',
      spawnSupported: true,
      webServiceSupported: true,
      manageOnly: true,
    });
    expect(availability.canPreviewSimulator).toBe(false);
    expect(availability.hasActions).toBe(false);
  });
});

describe('a gateway reached through an SSH tunnel', () => {
  test('says why the two rows are off rather than dropping them', () => {
    const availability = quickActionAvailability({
      ...overALivePane,
      webServiceSupported: false,
      webServiceBlockedByTunnel: true,
    });
    expect(availability.canOpenWebService).toBe(false);
    expect(availability.canPreviewSimulator).toBe(false);
    expect(availability.webServiceBlockedByTunnel).toBe(true);
    // A sheet that would otherwise be empty still opens, to carry the reason.
    expect(availability.hasActions).toBe(true);
  });

  test('an unencrypted gateway is refused without an explanation to give', () => {
    const availability = quickActionAvailability({
      ...overALivePane,
      webServiceSupported: false,
    });
    expect(availability.canOpenWebService).toBe(false);
    expect(availability.webServiceBlockedByTunnel).toBe(false);
  });

  test('the Settings entry explains nothing, having offered nothing', () => {
    const availability = quickActionAvailability({
      ...overALivePane,
      manageOnly: true,
      webServiceSupported: false,
      webServiceBlockedByTunnel: true,
    });
    expect(availability.webServiceBlockedByTunnel).toBe(false);
  });
});
