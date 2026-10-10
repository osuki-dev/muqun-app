import { describe, expect, test } from 'bun:test';

import {
  failureKey,
  isLoopbackUrl,
  linkLines,
  LINK_RETRY_MS,
  planFleetLinks,
  planPeerMoves,
  pairingsAnswer,
  type FleetComputer,
  type NameConflict,
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
    [
      'a peer with the same name but another server id does not count as linked',
      [
        computer('coding', {
          acceptDelegations: true,
          peers: [
            {
              peerId: 'peer-old',
              serverId: 'srv-old',
              name: 'mini',
              url: 'http://x',
              reachable: false,
            },
          ],
        }),
        computer('mini', peers(true, [['coding', true]])),
      ],
      {},
      [{ from: 'coding', to: 'mini' }],
    ],
    [
      'a computer at a loopback address is never handed on',
      [
        computer('coding', peers(true)),
        { ...computer('mini', peers(true)), url: 'http://10.0.2.2:23847' },
      ],
      {},
      [{ from: 'mini', to: 'coding' }],
    ],
  ] as const)('%s', (_name, computers, failures, expected) => {
    expect(planFleetLinks(computers, failures, NOW)).toEqual([...expected]);
  });

  test('a pair whose names collide is not tried again', () => {
    const conflicts = {
      [failureKey('coding', 'mini')]: { name: 'mini', against: 'peer', with: 'mini' } as const,
    };
    expect(
      planFleetLinks(
        [computer('coding', peers(true)), computer('mini', peers(true))],
        {},
        NOW,
        conflicts
      )
    ).toEqual([{ from: 'mini', to: 'coding' }]);
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
      { linked: ['mac mini'], noWork: [], cannotReach: [], sameName: [] },
    ],
    [
      'linked but the peer is quiet',
      'mini',
      both,
      {},
      { linked: [], noWork: [], cannotReach: ['coding'], sameName: [] },
    ],
    [
      'a linked computer that takes no work says so',
      'coding',
      [computer('coding', peers(true, [['mini', true]])), computer('mini', peers(false))],
      {},
      { linked: ['mini'], noWork: ['mini'], cannotReach: [], sameName: [] },
    ],
    [
      'a link that failed this run',
      'coding',
      [computer('coding', peers(true)), computer('mini', peers(true))],
      { [failureKey('coding', 'mini')]: NOW },
      { linked: [], noWork: [], cannotReach: ['mini'], sameName: [] },
    ],
    [
      'a peer this phone does not have keeps its gateway name',
      'coding',
      [computer('coding', peers(true, [['nas', true]]))],
      {},
      { linked: ['nas'], noWork: [], cannotReach: [], sameName: [] },
    ],
  ] as const)('%s', (_name, serverId, computers, failures, expected) => {
    expect(linkLines(serverId, computers, failures, NOW)).toEqual({
      linked: [...expected.linked],
      noWork: [...expected.noWork],
      cannotReach: [...expected.cannotReach],
      sameName: [...expected.sameName],
    });
  });

  // A name collision is its own line, not "cannot reach", and names the
  // computers by their own labels (this device calls them coding and mini).
  test.each<[string, NameConflict, { name: string; with: string; from: string; stale: boolean }]>([
    [
      'two computers with one name',
      { name: 'Mac', against: 'self', with: 'Mac', fromName: 'Mac' },
      { name: 'Mac', with: 'Mac', from: 'Mac', stale: false },
    ],
    [
      'an older entry for the same machine (a reinstall)',
      { name: 'mini', against: 'peer', with: 'mini', fromName: 'studio', stale: true },
      { name: 'mini', with: 'mini', from: 'studio', stale: true },
    ],
  ])('%s', (_name, conflict, line) => {
    const computers = [computer('coding', peers(true)), computer('mini', peers(true))];
    expect(
      linkLines('coding', computers, { [failureKey('coding', 'mini')]: NOW }, NOW, {
        [failureKey('coding', 'mini')]: conflict,
      })
    ).toEqual({ linked: [], noWork: [], cannotReach: [], sameName: [line] });
  });
});

describe("planPeerMoves: a quiet peer whose address moved is told this device's address", () => {
  const moved = { ...computer('mini', peers(true)), url: 'http://mini-new:23847' };
  test.each([
    [
      'unreachable at an old address: moved',
      [computer('coding', peers(true, [['mini', false]])), moved],
      {},
      [{ from: 'coding', peerId: 'peer-mini', url: 'http://mini-new:23847' }],
    ],
    [
      'the moved computer did not answer this pass: nothing to prove the address against',
      [computer('coding', peers(true, [['mini', false]])), { ...moved, peers: null }],
      {},
      [],
    ],
    [
      'a trailing slash or upper-case host is no move',
      [
        computer('coding', {
          acceptDelegations: true,
          peers: [
            {
              peerId: 'p',
              serverId: 'mini',
              name: 'mini',
              url: 'HTTP://Mini-New:23847/',
              reachable: false,
            },
          ],
        }),
        moved,
      ],
      {},
      [],
    ],
    [
      'answering over another route: left alone',
      [computer('coding', peers(true, [['mini', true]])), moved],
      {},
      [],
    ],
    [
      'the same address: nothing to say',
      [
        computer('coding', {
          acceptDelegations: true,
          peers: [
            {
              peerId: 'p',
              serverId: 'mini',
              name: 'mini',
              url: 'http://mini-new:23847',
              reachable: false,
            },
          ],
        }),
        moved,
      ],
      {},
      [],
    ],
    [
      'a move that failed waits out the retry window',
      [computer('coding', peers(true, [['mini', false]])), moved],
      { [failureKey('coding', 'peer-mini')]: NOW },
      [],
    ],
    [
      'a loopback address is never handed on',
      [
        computer('coding', peers(true, [['mini', false]])),
        { ...moved, url: 'http://127.0.0.1:23847' },
      ],
      {},
      [],
    ],
  ] as const)('%s', (_name, computers, failures, expected) => {
    expect(planPeerMoves(computers, failures, NOW)).toEqual([...expected]);
  });

  test('loopback hosts', () => {
    expect(
      [
        'http://localhost:1',
        'http://127.0.0.1',
        'http://[::1]:2',
        'http://10.0.2.2:3',
        'http://10.0.0.9',
      ].map(isLoopbackUrl)
    ).toEqual([true, true, true, true, false]);
  });
});

describe('pairingsAnswer: a 404 means nothing to revoke only when the gateway says so', () => {
  test.each([
    ['a 404 from a gateway without the list: nothing to revoke', 'no-route', ['fleet_peers'], []],
    [
      'a 404 where the gateway has the list (a proxy): retried',
      'no-route',
      ['device_revocation'],
      null,
    ],
    ['a 404 with no capabilities this run: retried', 'no-route', null, null],
  ] as const)('%s', (_name, listed, capabilities, expected) => {
    expect(pairingsAnswer(typeof listed === 'string' ? listed : [...listed], capabilities)).toEqual(
      expected === null ? null : [...expected]
    );
  });
});
