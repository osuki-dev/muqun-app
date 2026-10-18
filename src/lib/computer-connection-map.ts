import type { FleetPeers } from './fleet-peers';
import type { ConnectionStatus } from './server-reachability';

export const MAP_COMPUTER_LIMIT = 12;
export const MAP_PEER_EDGE_LIMIT = 36;
export const APP_NODE_ID = 'app';
export type MapPosition = [number, number, number];
export interface ConnectionMapNode {
  id: string;
  serverId?: string;
  label: string;
  status: ConnectionStatus;
  position: MapPosition;
}
export interface ConnectionMapEdge {
  id: string;
  from: string;
  to: string;
  kind: 'app' | 'peer';
  status: ConnectionStatus;
}
export interface ConnectionMap {
  nodes: ConnectionMapNode[];
  edges: ConnectionMapEdge[];
  omittedComputers: number;
  omittedPeerEdges: number;
}

/** Read-only projection. Peer reports are always last-known, never live phone evidence. */
export function computerConnectionMap(
  computers: readonly { serverId: string; label: string }[],
  statuses: Readonly<Record<string, ConnectionStatus>>,
  peers: Readonly<Record<string, FleetPeers>>,
  appLabel: string
): ConnectionMap {
  const ordered = [...computers].sort((a, b) => a.serverId.localeCompare(b.serverId));
  const visible = ordered.slice(0, MAP_COMPUTER_LIMIT);
  const nodes: ConnectionMapNode[] = [
    { id: APP_NODE_ID, label: appLabel, status: 'live', position: [0, 0, 0] },
    ...visible.map((computer, index): ConnectionMapNode => {
      const angle = (index / visible.length) * Math.PI * 2;
      return {
        id: `computer:${computer.serverId}`,
        serverId: computer.serverId,
        label: computer.label,
        status: statuses[computer.serverId] ?? 'unknown',
        position: [Math.sin(angle) * 3.5, 0, Math.cos(angle) * 3.5],
      };
    }),
  ];
  const nodeIds = new Map(
    nodes.filter((node) => node.serverId).map((node) => [node.serverId, node.id])
  );
  const appEdges: ConnectionMapEdge[] = nodes.slice(1).map((node) => ({
    id: `app:${node.id}`,
    from: APP_NODE_ID,
    to: node.id,
    kind: 'app',
    status: node.status,
  }));
  const peerEdges: ConnectionMapEdge[] = [];
  for (const computer of visible) {
    const seen = new Set<string>();
    for (const peer of peers[computer.serverId]?.peers ?? []) {
      const from = nodeIds.get(computer.serverId);
      const to = nodeIds.get(peer.serverId);
      if (!from || !to || from === to || seen.has(to)) continue;
      seen.add(to);
      peerEdges.push({
        id: `peer:${from}:${to}`,
        from,
        to,
        kind: 'peer',
        status: peer.unauthorized ? 'unauthorized' : peer.reachable ? 'live' : 'offline',
      });
    }
  }
  return {
    nodes,
    edges: [...appEdges, ...peerEdges.slice(0, MAP_PEER_EDGE_LIMIT)],
    omittedComputers: Math.max(0, computers.length - MAP_COMPUTER_LIMIT),
    omittedPeerEdges: Math.max(0, peerEdges.length - MAP_PEER_EDGE_LIMIT),
  };
}
