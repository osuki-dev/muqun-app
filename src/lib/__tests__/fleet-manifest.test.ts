import { describe, expect, test } from 'bun:test';

import { parseFleetManifest } from '../fleet-manifest';

describe('parseFleetManifest', () => {
  test('reads the camelCase manifest with nested agents and terminal backends', () => {
    const manifest = parseFleetManifest({
      machineId: 'm1',
      label: 'Studio',
      hostname: 'studio.local',
      os: 'macos',
      arch: 'aarch64',
      gatewayVersion: '1.2.3',
      agents: [{ id: 'claude', kind: 'claude', status: 'connected' }, 'junk'],
      terminal: [
        { sessionId: 's1', label: 'main', kind: 'herdr', connected: true, capabilities: ['x'] },
      ],
      toolchains: [
        { id: 'xcode', version: '16.2', path: '/Applications/Xcode.app' },
        { id: 'node' },
        {},
      ],
      tasks: { active: 2, waiting: 1 },
      suitableFor: ['ios-build', 'terminal'],
    });
    expect(manifest?.machineId).toBe('m1');
    expect(manifest?.agents.map((a) => a.id)).toEqual(['claude']);
    expect(manifest?.terminal).toEqual([
      { sessionId: 's1', label: 'main', kind: 'herdr', connected: true, capabilities: ['x'] },
    ]);
    expect(manifest?.toolchains).toEqual([
      { id: 'xcode', version: '16.2', path: '/Applications/Xcode.app' },
      { id: 'node' },
    ]);
    expect(manifest?.tasks).toEqual({ active: 2, waiting: 1 });
    expect(manifest?.suitableFor).toEqual(['ios-build', 'terminal']);
  });

  test('missing lists are empty and a manifest without a machine id is rejected', () => {
    expect(parseFleetManifest({ machineId: 'm' })).toMatchObject({
      agents: [],
      terminal: [],
      toolchains: [],
      suitableFor: [],
      tasks: { active: 0, waiting: 0 },
    });
    expect(parseFleetManifest({})).toBeNull();
    expect(parseFleetManifest(null)).toBeNull();
  });
});
