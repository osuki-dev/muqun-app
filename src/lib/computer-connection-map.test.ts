import { describe, expect, test } from 'bun:test';
import {
  computerConnectionMap,
  MAP_COMPUTER_LIMIT,
  MAP_PEER_EDGE_LIMIT,
} from './computer-connection-map';

describe('computer connection map', () => {
  test('keeps phone state separate from directed last-known peer reports', () => {
    const map = computerConnectionMap(
      [
        { serverId: 'b', label: 'B' },
        { serverId: 'a', label: 'A' },
      ],
      { a: 'offline', b: 'reconnecting' },
      {
        a: {
          acceptDelegations: false,
          peers: [
            { peerId: 'local', serverId: 'b', name: 'B', url: '', reachable: true },
            { peerId: 'other', serverId: 'unpaired', name: 'Other', url: '', reachable: true },
          ],
        },
      },
      'This app'
    );
    expect(map.nodes.map((node) => node.id)).toEqual(['app', 'computer:a', 'computer:b']);
    expect(map.edges.map((edge) => [edge.kind, edge.from, edge.to, edge.status])).toEqual([
      ['app', 'app', 'computer:a', 'offline'],
      ['app', 'app', 'computer:b', 'reconnecting'],
      ['peer', 'computer:a', 'computer:b', 'live'],
    ]);
  });
  test('never invents connectivity and honors revoked links', () => {
    const map = computerConnectionMap(
      [
        { serverId: 'a', label: 'A' },
        { serverId: 'b', label: 'B' },
      ],
      {},
      {
        a: {
          acceptDelegations: true,
          peers: [
            { peerId: 'b', serverId: 'b', name: 'B', url: '', reachable: true, unauthorized: true },
          ],
        },
      },
      'App'
    );
    expect(map.nodes[1].status).toBe('unknown');
    expect(map.edges.at(-1)?.status).toBe('unauthorized');
  });
  test('caps scene work and keeps positions stable when records reorder', () => {
    const computers = Array.from({ length: 20 }, (_, i) => ({
      serverId: String(i),
      label: String(i),
    }));
    const peers = Object.fromEntries(
      computers.map((from) => [
        from.serverId,
        {
          acceptDelegations: true,
          peers: computers.map((to) => ({
            peerId: to.serverId,
            serverId: to.serverId,
            name: to.label,
            url: '',
            reachable: true,
          })),
        },
      ])
    );
    const map = computerConnectionMap(computers, {}, peers, 'App');
    expect(map.nodes).toHaveLength(MAP_COMPUTER_LIMIT + 1);
    expect(map.edges).toHaveLength(MAP_COMPUTER_LIMIT + MAP_PEER_EDGE_LIMIT);
    expect(map.omittedComputers).toBe(8);
    expect(map.omittedPeerEdges).toBeGreaterThan(0);
    expect(computerConnectionMap([...computers].reverse(), {}, peers, 'App')).toEqual(map);
  });
});
