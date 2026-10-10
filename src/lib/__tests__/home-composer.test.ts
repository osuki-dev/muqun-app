import { describe, expect, test } from 'bun:test';

import type { ModeInfo, ModelInfo } from '../agent-session';
import type { GatewayRecord } from '../gateway-storage';
import {
  homeGuideParams,
  homeHiddenClientCommands,
  homeSessionParams,
  homeSessionReuse,
  ledgerModelId,
  sameComputer,
  resolveHomeComposerTarget,
  type HomeStartedSession,
  homeFolderLabel,
  homeFolderName,
  homeModelChoiceKey,
  keepHomeModelChoices,
  homeFolderPick,
} from '../home-composer';

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

  test.each([
    {
      name: 'the pick is sent, the agent only on a discovering gateway',
      picked: { model: sonnet, mode: 'build' },
      defaults: { model: haiku },
      discovered: true,
      params: { model: sonnet, mode: 'build', agentId: 'opencode' },
      shown: { model: sonnet, mode: 'build' },
    },
    {
      name: 'a picked mode brings its own model',
      picked: { mode: 'plan' },
      defaults: { model: sonnet },
      discovered: false,
      params: { model: haiku, mode: 'plan' },
      shown: { model: haiku, mode: 'plan' },
    },
    {
      name: 'nothing picked sends the shown host default',
      picked: {},
      defaults: { model: haiku, mode: 'build' },
      discovered: false,
      params: { model: haiku },
      shown: { model: haiku, mode: 'build' },
    },
    {
      name: 'a default this server refused gives way to the first usable model',
      picked: {},
      defaults: { model: haiku },
      refused: new Set(['anthropic\u0000haiku']),
      discovered: false,
      params: { model: sonnet },
      shown: { model: sonnet },
    },
    {
      name: 'a pick the catalog dropped falls back the same way',
      picked: { model: gone },
      defaults: {},
      discovered: false,
      params: { model: sonnet },
      shown: { model: sonnet },
    },
    {
      name: 'before the catalog answers, or when it fails, the pick is sent as stored',
      picked: { model: gone, mode: 'review' },
      defaults: {},
      unread: true,
      discovered: true,
      params: { model: gone, mode: 'review', agentId: 'opencode' },
      shown: { model: gone, mode: 'review' },
    },
  ])('$name', ({ picked, defaults, refused, unread, discovered, params, shown }) => {
    expect(
      homeSessionParams({
        picked,
        catalogDefaults: defaults,
        ...(refused ? { refused } : {}),
        ...(unread ? { catalogRead: false } : {}),
        models: unread ? [] : models,
        modes: unread ? [] : modes,
        agentId: 'opencode',
        agentsDiscovered: discovered,
      })
    ).toEqual({ params, shown });
  });
});

describe('homeHiddenClientCommands', () => {
  test('only /models is offered before a session exists, and only with model choice', () => {
    expect(homeHiddenClientCommands({ modelSelection: true })).not.toContain('models');
    expect(homeHiddenClientCommands({ modelSelection: true })).toContain('undo');
    expect(homeHiddenClientCommands({ modelSelection: false })).toContain('models');
  });
});

describe('homeSessionReuse', () => {
  const sonnet = { provider_id: 'anthropic', model_id: 'sonnet' };
  const haiku = { provider_id: 'anthropic', model_id: 'haiku' };
  const started: HomeStartedSession = {
    key: 'studio\u0000opencode',
    asid: 'as-1',
    params: { mode: 'build', model: sonnet, agentId: 'opencode' },
  };

  test('nothing left over, or another computer or agent: a new session', () => {
    expect(homeSessionReuse(null, started.key, started.params)).toEqual({ kind: 'create' });
    expect(homeSessionReuse(started, 'laptop\u0000opencode', started.params)).toEqual({
      kind: 'create',
    });
  });

  test('the same pills reuse the session as it is', () => {
    expect(homeSessionReuse(started, started.key, { ...started.params })).toEqual({
      kind: 'reuse',
      started,
    });
  });

  test('a mode or model changed since is switched on the reused session', () => {
    expect(
      homeSessionReuse(started, started.key, { mode: 'plan', model: haiku, agentId: 'opencode' })
    ).toEqual({ kind: 'reuse', started, switchMode: 'plan', switchModel: haiku });
    expect(
      homeSessionReuse(started, started.key, {
        mode: 'build',
        model: { ...sonnet, variant: 'thinking' },
      })
    ).toMatchObject({ switchModel: { ...sonnet, variant: 'thinking' } });
  });
});

describe('homeGuideParams', () => {
  const server = { serverId: 'studio', label: 'Studio' };
  const common = { capabilities: [], agentId: 'claude' };

  test('a ready agent keeps the failure inline', () => {
    expect(homeGuideParams({ status: 'ready', ...common }, server)).toBeNull();
  });

  test('every other state opens the guide, which comes back to Home', () => {
    for (const status of ['not-installed', 'needs-setup', 'needs-update', 'unsupported'] as const)
      expect(homeGuideParams({ status, ...common }, server)).toEqual({
        serverId: 'studio',
        label: 'Studio',
        agentId: 'claude',
        status,
        origin: 'home',
      });
    expect(
      homeGuideParams({ status: 'offline', cause: 'service', ...common }, { serverId: 'studio' })
    ).toEqual({
      serverId: 'studio',
      agentId: 'claude',
      status: 'offline',
      cause: 'service',
      origin: 'home',
    });
  });
});

describe('ledgerModelId', () => {
  test('provider/model, or the bare catalog id', () => {
    expect(ledgerModelId({ provider_id: 'anthropic', model_id: 'claude-haiku-5-5' })).toBe(
      'anthropic/claude-haiku-5-5'
    );
    expect(ledgerModelId({ provider_id: '', model_id: 'm' })).toBe('m');
  });
});

describe('sameComputer', () => {
  const owner = { serverId: 'a', url: 'https://a.invalid', transportKey: 'k' };

  test('a republished copy of the same record is the same computer', () => {
    expect(sameComputer({ ...owner }, owner)).toBe(true);
  });

  test('another computer, a re-paired one, or none is not', () => {
    expect(sameComputer({ ...owner, serverId: 'b' }, owner)).toBe(false);
    expect(sameComputer({ ...owner, transportKey: 'k2' }, owner)).toBe(false);
    expect(sameComputer({ ...owner, url: 'https://moved.invalid' }, owner)).toBe(false);
    expect(sameComputer(null, owner)).toBe(false);
  });
});

describe('keepHomeModelChoices', () => {
  const choices = {
    [homeModelChoiceKey('a', 'opencode')]: { mode: 'build' },
    [homeModelChoiceKey('a', undefined)]: { mode: 'plan' },
    [homeModelChoiceKey('ab', 'opencode')]: { mode: 'build' },
  };
  // paired computers -> picks kept (by computer); a prefix of another id is not it
  test.each<[string[], string[]]>([
    [['a'], ['a', 'a']],
    [['ab'], ['ab']],
    [[], []],
  ])('%p', (paired, kept) => {
    const left = keepHomeModelChoices(choices, paired);
    expect(Object.keys(left).map((key) => key.split('\u0000')[0])).toEqual(kept);
  });
});

describe('the folder segment', () => {
  // what the picker answered -> what is stored -> what the bar says
  test.each<[string, string | undefined, string | undefined]>([
    ['/Users/me/Work/app', '/Users/me/Work/app', 'app'],
    ['~/Work/app/', '~/Work/app', 'app'],
    ['~/', '~', '~'],
    ['  ', undefined, undefined],
    ['/', '/', '/'],
  ])('%p', (picked, stored, label) => {
    expect(homeFolderPick(picked)).toBe(stored);
    expect(stored === undefined ? undefined : homeFolderLabel(stored)).toBe(label);
  });

  // A folder the segment names in words rather than by basename.
  test.each<[string | undefined, string]>([
    ['~', 'Home folder'],
    [undefined, 'Last folder'],
  ])('%p', (folder, shown) => {
    expect(homeFolderName(folder, { last: 'Last folder', home: 'Home folder' })).toBe(shown);
  });
});
