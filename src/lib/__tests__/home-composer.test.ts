import { describe, expect, test } from 'bun:test';

import { findFileMentionTrigger as findHomeComposerMention } from '../file-mentions';
import type { GatewayRecord } from '../gateway-storage';
import {
  homeComposerAgent,
  homeComposerMentionCandidates,
  removeHomeComposerMention,
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

describe('homeComposerMentionCandidates', () => {
  const reachability = { studio: 'live', laptop: 'offline', build: 'unknown' } as const;

  test('live computers plus the connected one', () => {
    expect(
      homeComposerMentionCandidates({
        servers: [studio, laptop, build],
        reachabilityByServer: reachability,
        currentServerId: 'build',
        query: '',
      }).map((server) => server.serverId)
    ).toEqual(['studio', 'build']);
  });

  test('filters by label or id, ignoring case', () => {
    expect(
      homeComposerMentionCandidates({
        servers: [studio, laptop, build],
        reachabilityByServer: reachability,
        currentServerId: 'build',
        query: 'BOX',
      }).map((server) => server.serverId)
    ).toEqual(['build']);
  });

  test('the demo workspace is the single row in demo mode', () => {
    const demo = computer('muqun-demo', 'Demo workspace');
    expect(
      homeComposerMentionCandidates({
        servers: [demo],
        reachabilityByServer: {},
        currentServerId: 'muqun-demo',
        query: '',
      })
    ).toEqual([demo]);
  });
});

describe('mention token removal', () => {
  test('a leading @query goes with its following space', () => {
    const text = '@stu fix the build';
    const trigger = findHomeComposerMention(text, 4)!;
    expect(removeHomeComposerMention(text, trigger)).toEqual({ text: 'fix the build', caret: 0 });
  });

  test('a mid-sentence @query leaves a single space', () => {
    const text = 'fix @stu the build';
    const trigger = findHomeComposerMention(text, 8)!;
    expect(removeHomeComposerMention(text, trigger)).toEqual({ text: 'fix the build', caret: 4 });
  });

  test('a trailing @ keeps the space before it for the next word', () => {
    const text = 'fix the build @';
    const trigger = findHomeComposerMention(text, text.length)!;
    expect(removeHomeComposerMention(text, trigger)).toEqual({
      text: 'fix the build ',
      caret: 14,
    });
  });

  test('an @ inside a word is not a mention', () => {
    expect(findHomeComposerMention('mail me@host', 12)).toBeNull();
  });
});
