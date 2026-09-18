// Reading the gateway's batched session answer, without the transport.
//
// `lib/gateway-client` owns the request and the per-gateway memory of whether
// the route exists; what is here is the two decisions that can be wrong on
// their own -- which array is which, and which failure means "no such route" --
// so they can be tested without a fetch, a native module, or a process-wide
// module mock.

import { normalizeGatewayEntities, type GatewayEntity } from '@/lib/gateway-entities';

/** The three lists that describe a session's shape. */
export interface SessionSnapshot {
  workspaces: GatewayEntity[];
  tabs: GatewayEntity[];
  panes: GatewayEntity[];
}

/**
 * Whether a refusal means this gateway build has no such route.
 *
 * `api/http-request` raises `HTTP <status>: <body>` for every non-ok answer, so
 * the status is what there is to read. 404 is the one a router emits for a path
 * it does not know; 405 and 501 are included because a proxy or an older build
 * in front of the gateway can answer either for the same thing.
 *
 * Nothing else qualifies. A 500, a 403, a timeout: those are a gateway that has
 * the route and could not serve it, and pretending otherwise would silently
 * downgrade every later request to a machine having a bad minute.
 */
export function endpointIsAbsent(error: unknown): boolean {
  return /^HTTP (404|405|501)\b/.test(error instanceof Error ? error.message : '');
}

/**
 * Pull the three entity lists out of the batched answer.
 *
 * The batched route uses the same envelope as the single-entity routes --
 * `{ result: { type: 'session_snapshot', workspaces, tabs, panes, agents } }`
 * against `{ result: { type: 'pane_list', panes } }` -- so this is the same
 * normaliser reading the same keys, and an entity from either route is the same
 * entity. That is the property worth holding down: the caller must never be
 * able to tell which route answered.
 *
 * The answer's `agents` is deliberately ignored here; `loadSessionSnapshot`
 * says why.
 */
export function sessionSnapshotFromAnswer(answer: unknown): SessionSnapshot {
  return {
    workspaces: normalizeGatewayEntities(answer, ['workspaces', 'items']),
    tabs: normalizeGatewayEntities(answer, ['tabs', 'items']),
    panes: normalizeGatewayEntities(answer, ['panes', 'items']),
  };
}
