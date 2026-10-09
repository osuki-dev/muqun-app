import { describe, expect, test } from 'bun:test';

import type { ModeInfo, ModelInfo } from '../agent-session';
import type { GatewayRecord } from '../gateway-storage';
import {
  homeComposerAgent,
  homeHiddenClientCommands,
  homeSessionParams,
  resolveHomeComposerTarget,
} from '../home-composer';
import { buildLaunchModel } from '../home-launch-model';

function computer(serverId: string, label = serverId): GatewayRecord {
  return { serverId, label, url: `https://${serverId}.invalid`, token: 't' } as GatewayRecord;
}

const studio = computer('studio', 'Studio');
const laptop = computer('laptop', 'Laptop');
const build = computer('build', 'Build box');

describe('resolveHomeComposerTarget', () => {
  test('the chosen computer, when it may answer', () => {
    expect(
      resolveHomeComposerTarget({
        servers: [studio, laptop],
        chosen: laptop,
        reachabilityByServer: { studio: 'live', laptop: 'unknown' },
      })
    ).toEqual({ kind: 'ready', server: laptop });
  });

  test('the only computer is a target before any probe answered', () => {
    expect(
      resolveHomeComposerTarget({ servers: [studio], chosen: studio, reachabilityByServer: {} })
    ).toEqual({ kind: 'ready', server: studio });
  });

  test('a chosen computer that is offline sends to the picker', () => {
    expect(
      resolveHomeComposerTarget({
        servers: [studio, laptop],
        chosen: studio,
        reachabilityByServer: { studio: 'offline', laptop: 'live' },
      })
    ).toEqual({ kind: 'offline', server: studio });
  });

  test('nothing chosen: the first live computer before an unknown one', () => {
    expect(
      resolveHomeComposerTarget({
        servers: [studio, laptop, build],
        reachabilityByServer: { studio: 'offline', laptop: 'unknown', build: 'live' },
      })
    ).toEqual({ kind: 'ready', server: build });
    expect(
      resolveHomeComposerTarget({
        servers: [studio, laptop],
        reachabilityByServer: { studio: 'offline' },
      })
    ).toEqual({ kind: 'ready', server: laptop });
  });

  test('no target when every computer is offline, or none is paired', () => {
    expect(
      resolveHomeComposerTarget({
        servers: [studio, laptop],
        chosen: studio,
        reachabilityByServer: { studio: 'offline', laptop: 'offline' },
      })
    ).toEqual({ kind: 'none' });
    expect(resolveHomeComposerTarget({ servers: [], reachabilityByServer: {} })).toEqual({
      kind: 'none',
    });
  });
});

describe('homeComposerAgent', () => {
  test('the fallback row leads with OpenCode and names no agent id', () => {
    expect(homeComposerAgent(buildLaunchModel().entries)).toEqual({ name: 'OpenCode' });
  });

  test('no agent tile, no agent', () => {
    expect(homeComposerAgent([])).toBeNull();
  });
});

describe('homeSessionParams', () => {
  const sonnet = { provider_id: 'anthropic', model_id: 'sonnet' };
  const haiku = { provider_id: 'anthropic', model_id: 'haiku' };
  const gone = { provider_id: 'anthropic', model_id: 'retired' };
  const models = [
    { id: 'sonnet', provider_id: 'anthropic', name: 'Sonnet' },
    { id: 'haiku', provider_id: 'anthropic', name: 'Haiku' },
  ] as ModelInfo[];
  const modes = [
    { id: 'build', name: 'build' },
    { id: 'plan', name: 'plan', model: haiku },
  ] as ModeInfo[];

  test('the dock pick wins, and the agent is named only on a discovering gateway', () => {
    const base = {
      picked: { model: sonnet, mode: 'build' },
      remembered: { server: { model: haiku, mode: 'plan' } },
      catalogDefaults: {},
      models,
      modes,
      agentId: 'opencode',
    };
    expect(homeSessionParams({ ...base, agentsDiscovered: true })).toEqual({
      model: sonnet,
      mode: 'build',
      agentId: 'opencode',
    });
    expect(homeSessionParams({ ...base, agentsDiscovered: false })).toEqual({
      model: sonnet,
      mode: 'build',
    });
  });

  test('a picked mode brings its own model; a model the catalog dropped is not sent', () => {
    expect(
      homeSessionParams({
        picked: { mode: 'plan' },
        remembered: { server: { model: gone } },
        catalogDefaults: { model: sonnet },
        models,
        modes,
        agentsDiscovered: false,
      })
    ).toEqual({ model: haiku, mode: 'plan' });
    expect(
      homeSessionParams({
        picked: {},
        remembered: { server: { model: gone } },
        catalogDefaults: { model: sonnet },
        models,
        modes: [],
        agentsDiscovered: false,
      })
    ).toEqual({ model: sonnet });
  });

  test('before the catalog answers nothing is guessed', () => {
    expect(
      homeSessionParams({
        picked: {},
        remembered: { server: { model: sonnet, mode: 'build' } },
        catalogDefaults: {},
        models: [],
        modes: [],
        agentsDiscovered: false,
      })
    ).toEqual({});
  });
});

describe('homeHiddenClientCommands', () => {
  test('only /models is offered before a session exists, and only with model choice', () => {
    expect(homeHiddenClientCommands({ modelSelection: true })).not.toContain('models');
    expect(homeHiddenClientCommands({ modelSelection: true })).toContain('undo');
    expect(homeHiddenClientCommands({ modelSelection: false })).toContain('models');
  });
});
