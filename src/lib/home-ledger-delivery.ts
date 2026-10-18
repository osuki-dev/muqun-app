import { createMMKV } from 'react-native-mmkv';
import QuickCrypto from 'react-native-quick-crypto';

import {
  createLedgerTask,
  deliverLedgerTask,
  fetchTaskList,
  type CreatedLedgerTask,
  type LedgerTaskDelivery,
  type LedgerTaskRequest,
  type TaskEndpoint,
  type TaskView,
} from './task-ledger';

export type HomeDeliveryScope = { serverId: string; deviceId?: string };
export type UnconfirmedHomeTask = { goal: string; clientRef: string };
let storage: ReturnType<typeof createMMKV> | undefined;
const KEY_PREFIX = 'home-task-delivery.v1:';

function deliveryKey(scope: HomeDeliveryScope): string {
  return `${KEY_PREFIX}${JSON.stringify(scope.serverId)}:${scope.deviceId ?? ''}`;
}

/** Persisted drafts contain no credentials and are removed when this computer is unpaired. */
export function loadUnconfirmedHomeTasks(scope: HomeDeliveryScope): UnconfirmedHomeTask[] {
  // Losing this storage can cause duplicate work. Fail before POST rather than
  // silently degrading to memory-only protection.
  storage ??= createMMKV({ id: 'muqun.home-task-delivery' });
  const raw = storage.getString(deliveryKey(scope));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (item) =>
        item &&
        typeof item.goal === 'string' &&
        typeof item.clientRef === 'string' &&
        /^home-[a-f0-9]{32}$/.test(item.clientRef)
    )
  )
    throw new Error('The previous send could not be checked.');
  return parsed as UnconfirmedHomeTask[];
}

function saveUnconfirmedHomeTasks(scope: HomeDeliveryScope, tasks: UnconfirmedHomeTask[]): void {
  storage ??= createMMKV({ id: 'muqun.home-task-delivery' });
  if (tasks.length) storage.set(deliveryKey(scope), JSON.stringify(tasks));
  else storage.remove(deliveryKey(scope));
}

export function forgetHomeLedgerTask(scope: HomeDeliveryScope, clientRef: string): void {
  saveUnconfirmedHomeTasks(
    scope,
    loadUnconfirmedHomeTasks(scope).filter((task) => task.clientRef !== clientRef)
  );
}

export function forgetHomeLedgerDeliveries(serverId: string): void {
  try {
    storage ??= createMMKV({ id: 'muqun.home-task-delivery' });
    const prefix = `${KEY_PREFIX}${JSON.stringify(serverId)}:`;
    for (const key of storage.getAllKeys()) if (key.startsWith(prefix)) storage.remove(key);
  } catch {
    // Native storage may be unavailable in a binary that never sent ledger tasks.
  }
}

export function taskForHomeDelivery(
  tasks: readonly TaskView[],
  clientRef: string,
  deviceId?: string
): CreatedLedgerTask | null {
  const task = tasks.find(
    (task) =>
      task.clientRef === clientRef &&
      task.origin === 'device' &&
      (!deviceId || task.requestedBy?.id === deviceId)
  );
  if (!task) return null;
  return {
    task,
    ...(task.binding.kind === 'agent_session' ? { asid: task.binding.asid } : {}),
    ...(task.binding.kind === 'pane' ? { paneId: task.binding.paneId } : {}),
  };
}

/** Reads only: absence from a bounded list never proves that creation was refused. */
export async function reconcileHomeLedgerTask(
  options: HomeDeliveryScope & {
    clientRef: string;
    endpoint?: TaskEndpoint;
    isCurrent: () => boolean;
    knownTasks: () => readonly TaskView[];
  }
): Promise<CreatedLedgerTask | null> {
  const { clientRef, deviceId, endpoint, isCurrent, knownTasks } = options;
  const known = taskForHomeDelivery(knownTasks(), clientRef, deviceId);
  if (known) return known;
  if (!endpoint && !isCurrent()) return null;
  const tasks = await fetchTaskList({ limit: 200, ...(endpoint ? { endpoint } : {}) });
  return tasks ? taskForHomeDelivery(tasks, clientRef, deviceId) : null;
}

/**
 * A manual retry with the same goal checks the original request, even if launch
 * options changed. Older gateways that omit client_ref remain unknown; no
 * version is interpreted as an idempotency guarantee.
 */
export async function createHomeLedgerTask(
  options: HomeDeliveryScope & {
    endpoint?: TaskEndpoint;
    request: LedgerTaskRequest;
    isCurrent: () => boolean;
    knownTasks: () => readonly TaskView[];
  }
): Promise<LedgerTaskDelivery> {
  const { request, isCurrent } = options;
  const previous = loadUnconfirmedHomeTasks(options).find(
    (task) => task.goal.trim() === request.goal.trim()
  );
  return deliverLedgerTask({
    previousRef: previous?.clientRef,
    newRef: () => `home-${QuickCrypto.randomBytes(16).toString('hex')}`,
    remember: (clientRef) =>
      saveUnconfirmedHomeTasks(options, [
        ...loadUnconfirmedHomeTasks(options),
        { goal: request.goal, clientRef },
      ]),
    forget: (clientRef) => forgetHomeLedgerTask(options, clientRef),
    create: (clientRef) => createLedgerTask({ ...request, clientRef }, isCurrent),
    find: (clientRef) => reconcileHomeLedgerTask({ ...options, clientRef }),
  });
}
