import { describe, expect, test } from 'bun:test';

import {
  failureKey,
  isLoopbackUrl,
  linkLines,
  LINK_RETRY_MS,
  planFleetLinks,
  planPeerMoves,
  removalOutcome,
  keptUnpairs,
  UNPAIR_FOLLOW_UP_MS,
  unpairLines,
  type UnpairRecord,
  pairingsAnswer,
  ownedBy,
  parseFleetPeers,
  unpairProgressAfter,
  unpairSeenDown,
  unpairStepsDue,
  UNPAIR_STEP_ATTEMPTS,
  type UnpairProgress,
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
      [computer('atlas', peers(true)), computer('cedar', peers(true))],
      {},
      [
        { from: 'atlas', to: 'cedar' },
        { from: 'cedar', to: 'atlas' },
      ],
    ],
    [
      'a computer that refuses work is never linked to',
      [computer('atlas', peers(true)), computer('cedar', peers(false))],
      {},
      [{ from: 'cedar', to: 'atlas' }],
    ],
    [
      'a side already linked is left alone',
      [computer('atlas', peers(true, [['cedar', true]])), computer('cedar', peers(true))],
      {},
      [{ from: 'cedar', to: 'atlas' }],
    ],
    [
      'a linked but unreachable peer is not re-linked',
      [
        computer('atlas', peers(true, [['cedar', false]])),
        computer('cedar', peers(true, [['atlas', true]])),
      ],
      {},
      [],
    ],
    [
      'a computer that did not answer is skipped both ways',
      [computer('atlas', peers(true)), computer('cedar', null)],
      {},
      [],
    ],
    [
      'a pair that failed within the retry window waits',
      [computer('atlas', peers(true)), computer('cedar', peers(true))],
      { [failureKey('atlas', 'cedar')]: NOW - LINK_RETRY_MS + 1 },
      [{ from: 'cedar', to: 'atlas' }],
    ],
    [
      'a pair that failed before the retry window is tried again',
      [computer('atlas', peers(true)), computer('cedar', peers(true))],
      { [failureKey('atlas', 'cedar')]: NOW - LINK_RETRY_MS },
      [
        { from: 'atlas', to: 'cedar' },
        { from: 'cedar', to: 'atlas' },
      ],
    ],
    [
      'a peer with the same name but another server id does not count as linked',
      [
        computer('atlas', {
          acceptDelegations: true,
          peers: [
            {
              peerId: 'peer-old',
              serverId: 'srv-old',
              name: 'cedar',
              url: 'http://x',
              reachable: false,
            },
          ],
        }),
        computer('cedar', peers(true, [['atlas', true]])),
      ],
      {},
      [{ from: 'atlas', to: 'cedar' }],
    ],
    [
      'a computer at a loopback address is never handed on',
      [
        computer('atlas', peers(true)),
        { ...computer('cedar', peers(true)), url: 'http://10.0.2.2:23847' },
      ],
      {},
      [{ from: 'cedar', to: 'atlas' }],
    ],
  ] as const)('%s', (_name, computers, failures, expected) => {
    expect(planFleetLinks(computers, failures, NOW)).toEqual([...expected]);
  });

  // A4 D5: matched by server id, never by label (each device names computers
  // its own way); a link the other side revoked is linked again; and nothing
  // here ever unlinks or renames.
  test.each([
    [
      'revoked on cedar: the next pass links atlas to cedar again',
      [
        computer('atlas', {
          acceptDelegations: true,
          peers: [
            {
              peerId: 'p',
              serverId: 'cedar',
              name: 'cedar',
              url: 'http://cedar',
              reachable: false,
              unauthorized: true,
            },
          ],
        }),
        computer('cedar', peers(true, [['atlas', true]])),
      ],
      [{ from: 'atlas', to: 'cedar' }],
    ],
    [
      "two devices' labels differ: a link under the other device's name still counts",
      [
        { ...computer('atlas', peers(true, [['cedar', true]])), label: 'harbor' },
        { ...computer('cedar', peers(true, [['atlas', true]])), label: 'mac cedar' },
      ],
      [],
    ],
  ] as const)('%s', (_name, computers, expected) => {
    expect(planFleetLinks(computers, {}, NOW)).toEqual([...expected]);
  });

  test('a pair whose names collide is not tried again', () => {
    const conflicts = {
      [failureKey('atlas', 'cedar')]: { name: 'cedar', against: 'peer', with: 'cedar' } as const,
    };
    expect(
      planFleetLinks(
        [computer('atlas', peers(true)), computer('cedar', peers(true))],
        {},
        NOW,
        conflicts
      )
    ).toEqual([{ from: 'cedar', to: 'atlas' }]);
  });
});

describe('linkLines: the one line Settings shows per computer', () => {
  const both = [
    computer('atlas', peers(true, [['cedar', true]])),
    { ...computer('cedar', peers(true, [['atlas', false]])), label: 'mac cedar' },
  ];
  test.each([
    [
      'linked and answering, named by the phone',
      'atlas',
      both,
      {},
      { linked: ['mac cedar'], noWork: [], cannotReach: [], sameName: [] },
    ],
    [
      'linked but the peer is quiet',
      'cedar',
      both,
      {},
      { linked: [], noWork: [], cannotReach: ['atlas'], sameName: [] },
    ],
    [
      'a linked computer that takes no work says so',
      'atlas',
      [computer('atlas', peers(true, [['cedar', true]])), computer('cedar', peers(false))],
      {},
      { linked: ['cedar'], noWork: ['cedar'], cannotReach: [], sameName: [] },
    ],
    [
      'a link that failed this run',
      'atlas',
      [computer('atlas', peers(true)), computer('cedar', peers(true))],
      { [failureKey('atlas', 'cedar')]: NOW },
      { linked: [], noWork: [], cannotReach: ['cedar'], sameName: [] },
    ],
    [
      'a peer this phone does not have keeps its gateway name',
      'atlas',
      [computer('atlas', peers(true, [['nas', true]]))],
      {},
      { linked: ['nas'], noWork: [], cannotReach: [], sameName: [] },
    ],
    [
      'a link the other side revoked: re-linking, not "cannot reach"',
      'atlas',
      [
        computer('atlas', {
          acceptDelegations: true,
          peers: [
            {
              peerId: 'p',
              serverId: 'cedar',
              name: 'cedar',
              url: 'http://cedar',
              reachable: false,
              unauthorized: true,
            },
          ],
        }),
        computer('cedar', peers(true)),
      ],
      { [failureKey('atlas', 'cedar')]: NOW },
      { linked: [], noWork: [], revoked: ['cedar'], cannotReach: [], sameName: [] },
    ],
  ] as const)('%s', (_name, serverId, computers, failures, expected) => {
    expect(linkLines(serverId, computers, failures, NOW)).toEqual({
      linked: [...expected.linked],
      noWork: [...expected.noWork],
      revoked: 'revoked' in expected ? [...expected.revoked] : [],
      cannotReach: [...expected.cannotReach],
      sameName: [...expected.sameName],
    });
  });

  // A name collision is its own line, not "cannot reach", and names the
  // computers by their own labels (this device calls them atlas and cedar).
  test.each<[string, NameConflict, { name: string; with: string; from: string; stale: boolean }]>([
    [
      'two computers with one name',
      { name: 'Mac', against: 'self', with: 'Mac', fromName: 'Mac' },
      { name: 'Mac', with: 'Mac', from: 'Mac', stale: false },
    ],
    [
      'an older entry for the same machine (a reinstall)',
      { name: 'cedar', against: 'peer', with: 'cedar', fromName: 'studio', stale: true },
      { name: 'cedar', with: 'cedar', from: 'studio', stale: true },
    ],
  ])('%s', (_name, conflict, line) => {
    const computers = [computer('atlas', peers(true)), computer('cedar', peers(true))];
    expect(
      linkLines('atlas', computers, { [failureKey('atlas', 'cedar')]: NOW }, NOW, {
        [failureKey('atlas', 'cedar')]: conflict,
      })
    ).toEqual({ linked: [], noWork: [], revoked: [], cannotReach: [], sameName: [line] });
  });
});

describe("planPeerMoves: a quiet peer whose address moved is told this device's address", () => {
  const moved = { ...computer('cedar', peers(true)), url: 'http://cedar-new:23847' };
  test.each([
    [
      'unreachable at an old address: moved',
      [computer('atlas', peers(true, [['cedar', false]])), moved],
      {},
      [{ from: 'atlas', peerId: 'peer-cedar', url: 'http://cedar-new:23847' }],
    ],
    [
      'the moved computer did not answer this pass: nothing to prove the address against',
      [computer('atlas', peers(true, [['cedar', false]])), { ...moved, peers: null }],
      {},
      [],
    ],
    [
      'a trailing slash or upper-case host is no move',
      [
        computer('atlas', {
          acceptDelegations: true,
          peers: [
            {
              peerId: 'p',
              serverId: 'cedar',
              name: 'cedar',
              url: 'HTTP://Cedar-New:23847/',
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
      [computer('atlas', peers(true, [['cedar', true]])), moved],
      {},
      [],
    ],
    [
      'the same address: nothing to say',
      [
        computer('atlas', {
          acceptDelegations: true,
          peers: [
            {
              peerId: 'p',
              serverId: 'cedar',
              name: 'cedar',
              url: 'http://cedar-new:23847',
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
      [computer('atlas', peers(true, [['cedar', false]])), moved],
      { [failureKey('atlas', 'peer-cedar')]: NOW },
      [],
    ],
    [
      'a loopback address is never handed on',
      [
        computer('atlas', peers(true, [['cedar', false]])),
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

describe('an unpairing this device could not finish (A5 D6)', () => {
  const entry = (over: Partial<UnpairRecord> = {}): UnpairRecord => ({
    serverId: 'cedar',
    label: 'cedar',
    atMs: NOW,
    pending: ['atlas'],
    stillListedBy: [],
    ...over,
  });
  test.each([
    ['followed up while something is left', entry(), [], NOW + 1, true],
    ['dropped once nothing is pending or to tell', entry({ pending: [] }), [], NOW + 1, false],
    ['dropped when this device pairs that computer again', entry(), ['cedar'], NOW + 1, false],
    ['dropped after a month', entry(), [], NOW + UNPAIR_FOLLOW_UP_MS, false],
  ] as const)('%s', (_name, record, paired, nowMs, kept) => {
    expect(keptUnpairs([record], paired, nowMs).length === 1).toBe(kept);
  });

  test("each computer's Settings line says what is left on it", () => {
    const entries = [entry({ pending: ['atlas', 'harbor'], stillListedBy: ['nas'] })];
    const undecided = {
      ...entries[0]!,
      progress: {
        harbor: { done: ['rows' as const], failures: 1, needsNewerGateway: true as const },
      },
    };
    expect(unpairLines('atlas', entries)).toEqual({
      stillLinked: ['cedar'],
      stillListedBy: [],
      needsNewerGateway: false,
    });
    expect(unpairLines('nas', entries)).toEqual({
      stillLinked: [],
      stillListedBy: ['cedar'],
      needsNewerGateway: false,
    });
    expect(unpairLines('harbor', [undecided])).toEqual({
      stillLinked: [],
      stillListedBy: [],
      needsNewerGateway: true,
    });
  });
});

describe('an unpair follow-up runs only what is left, and stops fighting', () => {
  test('confirmed steps never run again; a step failing in a row waits for the computer to change', () => {
    const PAIRED = 7;
    // The first pass took the rows off; the login revoke failed.
    let progress: UnpairProgress | undefined = unpairProgressAfter(undefined, ['rows'], PAIRED);
    expect(unpairStepsDue(progress, PAIRED)).toEqual(['logins']);
    // A pass that confirmed a step is progress: the count starts from there.
    expect(progress.failures).toBe(0);
    for (let pass = 0; pass < UNPAIR_STEP_ATTEMPTS; pass += 1) {
      progress = unpairProgressAfter(progress, [], PAIRED);
    }
    // Parked: nothing on this pairing, until it is paired again or seen down.
    expect(unpairStepsDue(progress, PAIRED)).toEqual([]);
    expect(unpairStepsDue(progress, PAIRED + 1)).toEqual(['logins']);
    expect(unpairStepsDue(unpairSeenDown(progress), PAIRED)).toEqual(['logins']);
    // Resumed and failing once more starts its count over rather than parking at once.
    expect(unpairProgressAfter(progress, [], PAIRED + 1).parkedOn).toBeUndefined();
  });
});

describe("an older gateway's rows and logins carry no server id: matched by a unique name", () => {
  const login = (deviceId: string, serverId: string | null, name: string) => ({
    deviceId,
    serverId,
    name,
  });
  test.each([
    ['its own server id decides', [login('d1', 'srv-beta', 'other')], ['d1'], false],
    [
      'no server id: the one login with a name it goes by',
      [login('d1', null, 'Beta '), login('d2', null, 'gamma')],
      ['d1'],
      false,
    ],
    // A label that differs is not "nothing to revoke": it stays pending.
    ['no server id and no name it goes by', [login('d2', null, 'gamma')], [], true],
    // Two logins share the name: neither is revoked.
    ['a namesake', [login('d1', null, 'beta'), login('d2', null, 'beta')], [], true],
    ['no logins without an id: nothing to do', [login('d2', 'srv-gamma', 'beta')], [], false],
  ] as const)('%s', (_name, logins, revoked, undecided) => {
    const owned = ownedBy([...logins], 'srv-beta', ['beta']);
    expect([owned.matched.map((entry) => entry.deviceId), owned.undecided]).toEqual([
      [...revoked],
      undecided,
    ]);
  });

  test('a peer row without one is kept aside for the unpair, not shown as a peer', () => {
    const answer = parseFleetPeers({ peers: [{ peer_id: 'p1', name: 'beta' }] });
    expect(answer?.peers).toEqual([]);
    expect(answer?.unidentified).toEqual([{ peerId: 'p1', name: 'beta' }]);
  });
});

describe('removalOutcome: an unpaired computer is let go only on a confirmed removal', () => {
  test.each([
    ['delete answered 200: done', 200, 'done'],
    ['nothing there to delete (404): done', 404, 'done'],
    ['server error (500): still pending', 500, 'retry'],
    ["this device's token refused (403): still pending", 403, 'retry'],
    ['no answer: still pending', 'network', 'retry'],
  ] as const)('%s', (_name, status, outcome) => {
    expect(removalOutcome(status)).toBe(outcome);
  });
});
