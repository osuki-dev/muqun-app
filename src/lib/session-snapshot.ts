// Reading the gateway's batched session answer, without the transport.
//
// `lib/gateway-client` owns the request and the per-gateway memory of whether
// the route exists; what is here is the decisions that can be wrong on their
// own -- which array is which, whose agents may be believed, and which failure
// means "no such route" -- so they can be tested without a fetch, a native
// module, or a process-wide module mock.

import { normalizeGatewayEntities, type GatewayEntity } from '@/lib/gateway-entities';

/** What a gateway calls "I will answer workspaces, tabs, panes and agents at once". */
export const SESSION_SNAPSHOT_CAPABILITY = 'session_snapshot';

/**
 * A session's shape in one answer.
 *
 * `agents` is `null` rather than empty when this gateway's batched agents are
 * not the ones to use -- see `snapshotServesAgents`. Null means "ask `/agents`";
 * an empty array means "asked, and this session has none". Collapsing the two
 * would silently drop every agent on an older gateway.
 */
export interface SessionSnapshot {
  workspaces: GatewayEntity[];
  tabs: GatewayEntity[];
  panes: GatewayEntity[];
  agents: GatewayEntity[] | null;
}

/** Only the part of `/health` this decision reads. */
type CapabilityBearing = { capabilities?: unknown } | null | undefined;

/**
 * Whether this gateway's batched `agents` are the real agent list.
 *
 * ## Why this is asked at all
 *
 * The batched route used to derive its agents from the panes
 * (`agent_from_pane`), which gave them `pane_id`, `workspace_id`, `tab_id`,
 * `agent`, `display_agent` and `agent_status` -- and not `instance_id`, not
 * `target`, not `state_change_seq`. Two of those are read straight off this
 * array: `instance_id` is the opaque agent instance identity a collaboration
 * assignment binds to, deliberately not a pane id because panes are reused and
 * renumbered, and `target` is the opaque address a command is sent to. An
 * assignment built from a derived agent carried an empty instance id and was
 * dropped on the floor. So the app called `/agents` separately and threw the
 * batched agents away.
 *
 * Gateway `687a453` made the batched agents the same array `/agents` returns,
 * from the same backend call, and announced it as `session_snapshot` in
 * `/health`. When it is announced, one request does what two did.
 *
 * ## Why the capability and not the shape
 *
 * Both gateways answer 200 with an `agents` array, so the reply alone cannot
 * tell them apart: a derived agent and a real one differ by an absent field,
 * and "no `instance_id` on any of them" is also what a perfectly current
 * gateway says about a session whose agents are all plain shells. Guessing from
 * `gatewayVersion` is what AGENTS.md forbids. The capability is the gateway's
 * own answer to the question, which is the one thing here that cannot be
 * mistaken for something else.
 */
export function snapshotServesAgents(health: CapabilityBearing): boolean {
  const capabilities = health?.capabilities;
  return Array.isArray(capabilities) && capabilities.includes(SESSION_SNAPSHOT_CAPABILITY);
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
 * Pull the entity lists out of the batched answer.
 *
 * The batched route uses the same envelope as the single-entity routes --
 * `{ result: { type: 'session_snapshot', workspaces, tabs, panes, agents } }`
 * against `{ result: { type: 'pane_list', panes } }` -- so this is the same
 * normaliser reading the same keys, and an entity from either route is the same
 * entity. That is the property worth holding down: the caller must never be
 * able to tell which route answered.
 *
 * `agentsAreAuthoritative` is `snapshotServesAgents` for this gateway, and it
 * decides whether the answer's agents are returned or discarded. It is a
 * required argument rather than a defaulted one on purpose: a caller that has
 * not thought about which gateway it is talking to must not be able to get the
 * derived agents by accident.
 */
export function sessionSnapshotFromAnswer(
  answer: unknown,
  agentsAreAuthoritative: boolean
): SessionSnapshot {
  return {
    workspaces: normalizeGatewayEntities(answer, ['workspaces', 'items']),
    tabs: normalizeGatewayEntities(answer, ['tabs', 'items']),
    panes: normalizeGatewayEntities(answer, ['panes', 'items']),
    agents: agentsAreAuthoritative ? normalizeGatewayEntities(answer, ['agents', 'items']) : null,
  };
}
