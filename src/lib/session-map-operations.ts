/**
 * The small ownership boundary used by SessionMap's structural mutations.
 *
 * The rendered `busy` flag is deliberately not part of this contract. A
 * second press can arrive before React commits that flag, so ownership must be
 * decided synchronously by the event handler.
 *
 * The registry is process-local and keyed by the complete server/session
 * scope. A remounted picker therefore cannot repeat an ambiguous mutation
 * while the first request is still in flight, while unrelated servers and
 * gateway sessions keep independent slots. A Gateway idempotency contract
 * would additionally be needed to guarantee exactly-once delivery across
 * process restarts.
 */
export interface SessionMapOperationScope {
  scope: string;
  generation: number;
}

export interface SessionMapOperation extends SessionMapOperationScope {
  id: number;
}

export type SessionMapOutcome = 'unknown-create';

/**
 * The configured gateway, including the process-global demo record, must still
 * be the server the picker was opened for.
 */
export function ownsSessionMapGateway(
  expectedServerId: string,
  currentServerId: string | undefined
): boolean {
  return currentServerId === expectedServerId;
}

const activeOperations = new Map<string, SessionMapOperation>();
const outcomes = new Map<string, SessionMapOutcome>();
const outcomeListeners = new Map<string, Set<() => void>>();
let nextOperationId = 1;

/**
 * Start one mutation synchronously. A second picker in the same server/session
 * scope receives no token until the existing request settles.
 */
export function beginSessionMapOperation(
  current: SessionMapOperationScope,
  kind: 'structural' | 'create' = 'structural'
): SessionMapOperation | null {
  if (activeOperations.has(current.scope)) return null;
  if (kind === 'create' && outcomes.has(current.scope)) return null;
  const operation: SessionMapOperation = { ...current, id: nextOperationId++ };
  activeOperations.set(current.scope, operation);
  return operation;
}

/** A create response may have been lost after the gateway accepted the POST. */
export function markSessionMapOutcomeUnknown(current: SessionMapOperationScope): void {
  if (outcomes.get(current.scope) === 'unknown-create') return;
  outcomes.set(current.scope, 'unknown-create');
  outcomeListeners.get(current.scope)?.forEach((listener) => listener());
}

export function subscribeSessionMapOutcome(scope: string, listener: () => void): () => void {
  const listeners = outcomeListeners.get(scope) ?? new Set<() => void>();
  listeners.add(listener);
  outcomeListeners.set(scope, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) outcomeListeners.delete(scope);
  };
}

export function hasSessionMapOutcome(
  current: SessionMapOperationScope,
  outcome: SessionMapOutcome = 'unknown-create'
): boolean {
  return outcomes.get(current.scope) === outcome;
}

/** Clear an unknown create only after an explicit authoritative refresh. */
export function clearSessionMapOutcome(
  current: SessionMapOperationScope,
  outcome: SessionMapOutcome = 'unknown-create'
): boolean {
  if (outcomes.get(current.scope) !== outcome) return false;
  outcomes.delete(current.scope);
  outcomeListeners.get(current.scope)?.forEach((listener) => listener());
  return true;
}

export function ownsSessionMapOperation(
  operation: SessionMapOperation,
  current: SessionMapOperationScope
): boolean {
  return (
    activeOperations.get(operation.scope) === operation &&
    operation.scope === current.scope &&
    operation.generation === current.generation
  );
}

/**
 * Release only the operation that owns the registry slot. A late completion
 * from an older token cannot clear a newer owner for the same scope.
 */
export function finishSessionMapOperation(operation: SessionMapOperation): void {
  if (activeOperations.get(operation.scope) === operation) {
    activeOperations.delete(operation.scope);
  }
}
