import { describe, expect, test } from 'bun:test';

import {
  failureKey,
  linkLines,
  LINK_RETRY_MS,
  parseFleetPeers,
  planFleetLinks,
  planRenames,
  type FleetComputer,
  type FleetPeers,
} from '../fleet-peers';

const NOW = 1_000_000_000;

/** A computer's `GET /api/peers` answer; each linked peer is named after its server id. */
function peers(accept: boolean, linked: [string, boolean][] = []): FleetPeers {
  return {
    acceptDelegations: accept,
    peers: linked.map(([serverId, reachable]) => ({
      peerId: `peer-${serverId}`,
      serverId,
      name: serverId,
      url: `http://${serverId}`,
      reachable,
    })),
  };
}

function computer(serverId: string, answer: FleetPeers | null): FleetComputer {
  return { serverId, label: serverId, url: `http://${serverId}:23847`, peers: answer };
}

describe('parseFleetPeers', () => {
  test('reads the gateway answer, and a body without a peers array is no answer', () => {
    expect(
      parseFleetPeers({
        accept_delegations: false,
        peers: [
          {
            peer_id: 'peer-1',
            server_id: 'srv-mini',
            name: 'mini',
            url: 'http://127.0.0.1:23847',
            reachable: true,
            last_seen_ms: 5,
          },
        ],
      })
    ).toEqual({
      acceptDelegations: false,
      peers: [
        {
          peerId: 'peer-1',
          serverId: 'srv-mini',
          name: 'mini',
          url: 'http://127.0.0.1:23847',
          reachable: true,
          lastSeenMs: 5,
        },
      ],
    });
    expect(parseFleetPeers({ accept_delegations: true })).toBeNull();
  });
});

describe('planFleetLinks: every ordered pair that should be linked and is not', () => {
  test.each([
    [
      'two fresh computers link both ways',
      [computer('coding', peers(true)), computer('mini', peers(true))],
      {},
      [
        { from: 'coding', to: 'mini' },
        { from: 'mini', to: 'coding' },
      ],
    ],
    [
      'a computer that refuses work is never linked to',
      [computer('coding', peers(true)), computer('mini', peers(false))],
      {},
      [{ from: 'mini', to: 'coding' }],
    ],
    [
      'a side already linked is left alone',
      [computer('coding', peers(true, [['mini', true]])), computer('mini', peers(true))],
      {},
      [{ from: 'mini', to: 'coding' }],
    ],
    [
      'a linked but unreachable peer is not re-linked',
      [
        computer('coding', peers(true, [['mini', false]])),
        computer('mini', peers(true, [['coding', true]])),
      ],
      {},
      [],
    ],
    [
      'a computer that did not answer is skipped both ways',
      [computer('coding', peers(true)), computer('mini', null)],
      {},
      [],
    ],
    [
      'a pair that failed within the retry window waits',
      [computer('coding', peers(true)), computer('mini', peers(true))],
      { [failureKey('coding', 'mini')]: NOW - LINK_RETRY_MS + 1 },
      [{ from: 'mini', to: 'coding' }],
    ],
    [
      'a pair that failed before the retry window is tried again',
      [computer('coding', peers(true)), computer('mini', peers(true))],
      { [failureKey('coding', 'mini')]: NOW - LINK_RETRY_MS },
      [
        { from: 'coding', to: 'mini' },
        { from: 'mini', to: 'coding' },
      ],
    ],
    ['one computer has nothing to link', [computer('coding', peers(true))], {}, []],
  ] as const)('%s', (_name, computers, failures, expected) => {
    expect(planFleetLinks(computers, failures, NOW)).toEqual([...expected]);
  });
});

describe("planRenames: the phone's label for a computer wins on every other computer", () => {
  const renamed = { ...computer('mini', peers(true, [['coding', true]])), label: 'mac mini' };
  test.each([
    [
      'a peer named before the phone renamed it',
      [computer('coding', peers(true, [['mini', true]])), renamed],
      [{ from: 'coding', peerId: 'peer-mini', name: 'mac mini' }],
    ],
    [
      'names already in step',
      [computer('coding', peers(true, [['mini', true]])), computer('mini', peers(true))],
      [],
    ],
    [
      'a peer this phone does not have is left as named',
      [computer('coding', peers(true, [['nas', true]]))],
      [],
    ],
    [
      'a computer that did not answer has nothing to rename',
      [computer('coding', null), renamed],
      [],
    ],
  ] as const)('%s', (_name, computers, expected) => {
    expect(planRenames(computers)).toEqual([...expected]);
  });
});

describe('linkLines: the one line Settings shows per computer', () => {
  const both = [
    computer('coding', peers(true, [['mini', true]])),
    { ...computer('mini', peers(true, [['coding', false]])), label: 'mac mini' },
  ];
  test.each([
    [
      'linked and answering, named by the phone',
      'coding',
      both,
      {},
      { linked: ['mac mini'], cannotReach: [] },
    ],
    ['linked but the peer is quiet', 'mini', both, {}, { linked: [], cannotReach: ['coding'] }],
    [
      'a link that failed this run',
      'coding',
      [computer('coding', peers(true)), computer('mini', peers(true))],
      { [failureKey('coding', 'mini')]: NOW },
      { linked: [], cannotReach: ['mini'] },
    ],
    [
      'a peer this phone does not have keeps its gateway name',
      'coding',
      [computer('coding', peers(true, [['nas', true]]))],
      {},
      { linked: ['nas'], cannotReach: [] },
    ],
    [
      'nothing to say',
      'coding',
      [computer('coding', peers(true))],
      {},
      { linked: [], cannotReach: [] },
    ],
  ] as const)('%s', (_name, serverId, computers, failures, expected) => {
    expect(linkLines(serverId, computers, failures, NOW)).toEqual({
      linked: [...expected.linked],
      cannotReach: [...expected.cannotReach],
    });
  });
});
