import type { LiveActivity, LiveActivityFactory } from 'expo-widgets';
import { Platform } from 'react-native';

import type { AgentActivityProps, AgentActivityStatus } from '@/lib/live-activity-layout';

/** What the caller knows about the agent it wants mirrored on the Lock Screen. */
export type AgentActivitySnapshot = {
  /** Identifies the run. A different id ends the old activity and starts a new one. */
  agentId: string;
  agentName: string;
  status: AgentActivityStatus;
  detail: string;
};

const KNOWN_STATUSES: readonly AgentActivityStatus[] = [
  'working',
  'idle',
  'blocked',
  'done',
  'unknown',
];

/**
 * Narrows the gateway's free-form `status` string. Anything the gateway starts
 * reporting that this build does not know about renders as `unknown` rather
 * than as an empty card.
 */
export function asAgentActivityStatus(status: string | undefined): AgentActivityStatus {
  const known = KNOWN_STATUSES.find((value) => value === status);
  return known ?? 'unknown';
}

/**
 * Statuses worth holding a Lock Screen slot for. `blocked` stays up on purpose:
 * an agent waiting on an answer is the one case where a glance saves the run.
 */
const LIVE_STATUSES: readonly AgentActivityStatus[] = ['working', 'blocked'];

/** How long a finished run stays visible before the system clears it. */
const FINISHED_LINGER_MS = 5 * 60 * 1000;

/** ActivityKit's floor. The generated widget extension is `@available(iOS 16.1, *)`. */
const MIN_IOS_VERSION = 16.1;

type Current = {
  agentId: string;
  startedAtMs: number;
  activity: LiveActivity<AgentActivityProps>;
};

let current: Current | null = null;
// `undefined` means "not resolved yet", `null` means "resolved to unavailable".
let factory: LiveActivityFactory<AgentActivityProps> | null | undefined;

/**
 * Live Activities need iOS 16.1 and a binary that actually contains the widget
 * extension. An OTA update can land this JS on an older build, so availability
 * is a runtime question rather than a compile-time one.
 */
export function isLiveActivitySupported(): boolean {
  if (Platform.OS !== 'ios') return false;
  return parseFloat(String(Platform.Version)) >= MIN_IOS_VERSION;
}

/**
 * Starts a Live Activity for `snapshot`, replacing any activity already
 * running. Returns whether one is now on screen.
 */
export function startAgentActivity(snapshot: AgentActivitySnapshot): boolean {
  const activityFactory = resolveFactory();
  if (!activityFactory) return false;

  // Cleared before the new card exists rather than through the async
  // `endAgentActivity`, whose sweep would otherwise run late enough to catch
  // the card started just below.
  current = null;
  discardEveryActivity(activityFactory);
  const startedAtMs = Date.now();
  try {
    const activity = activityFactory.start(toProps(snapshot, startedAtMs));
    current = { agentId: snapshot.agentId, startedAtMs, activity };
    return true;
  } catch {
    // The system caps how many activities an app may run and refuses outright
    // when the user has turned them off for Muqun. Neither is worth a toast.
    current = null;
    return false;
  }
}

/** Pushes new content into the running activity. No-op when none is running. */
export async function updateAgentActivity(snapshot: AgentActivitySnapshot): Promise<void> {
  if (!current || current.agentId !== snapshot.agentId) return;
  try {
    await current.activity.update(toProps(snapshot, current.startedAtMs));
  } catch {
    // A dismissed activity rejects its updates; drop it so the next working
    // agent starts a fresh one instead of writing into a dead handle.
    current = null;
  }
}

/**
 * Ends the running activity. `'immediate'` clears the Lock Screen outright,
 * which is what a teardown wants; `'linger'` lets a finished run stay readable
 * for a while.
 */
export async function endAgentActivity(
  dismissal: 'immediate' | 'linger' = 'immediate',
  finalSnapshot?: AgentActivitySnapshot
): Promise<void> {
  const running = current;
  current = null;
  if (running) {
    try {
      const props = finalSnapshot ? toProps(finalSnapshot, running.startedAtMs) : undefined;
      if (dismissal === 'linger') {
        await running.activity.end({ after: new Date(Date.now() + FINISHED_LINGER_MS) }, props);
      } else {
        await running.activity.end('immediate', props);
      }
    } catch {
      // Already gone.
    }
  }
  if (dismissal === 'linger') return;
  // `current` is not the whole picture. A Live Activity outlives the process
  // that started it, so a relaunch inherits a card it has no handle for -- one
  // that can no longer be updated or ended, and that would otherwise sit on the
  // Lock Screen frozen on its last status. A caller asking for an immediate
  // clear means the Lock Screen, not just this run's bookkeeping.
  const activityFactory = resolveFactory();
  if (activityFactory) discardEveryActivity(activityFactory);
}

/**
 * Reconciles the Lock Screen against the agent the user is watching. This is
 * the whole integration surface: callers describe the agent they care about
 * (or `null`) and the module works out whether that means start, update or end.
 */
export async function syncAgentActivity(snapshot: AgentActivitySnapshot | null): Promise<void> {
  if (!snapshot) {
    await endAgentActivity('immediate');
    return;
  }

  const shouldBeLive = LIVE_STATUSES.includes(snapshot.status);
  if (!shouldBeLive) {
    // A run that ended is worth seeing after the fact, so it lingers rather
    // than vanishing the moment the agent goes idle -- but only when the run
    // that ended is the one on screen. Looking at a *different* idle agent says
    // nothing about the one still holding the Lock Screen slot, and stamping
    // its name onto that card would leave a lingering card describing an agent
    // whose run never took place.
    if (current?.agentId === snapshot.agentId) {
      await endAgentActivity('linger', snapshot);
    } else {
      await endAgentActivity('immediate');
    }
    return;
  }

  if (current?.agentId === snapshot.agentId) {
    await updateAgentActivity(snapshot);
    return;
  }
  startAgentActivity(snapshot);
}

/**
 * Ends every card of this type still on screen, including any this run never
 * started. Deliberately synchronous and fire-and-forget: callers need the list
 * taken before they add to it, not the dismissals confirmed.
 */
function discardEveryActivity(activityFactory: LiveActivityFactory<AgentActivityProps>): void {
  try {
    for (const activity of activityFactory.getInstances()) {
      void activity.end('immediate').catch(() => {});
    }
  } catch {
    // A runtime without `getInstances` keeps the older, handle-only behaviour
    // rather than failing the call that asked for the sweep.
  }
}

function toProps(snapshot: AgentActivitySnapshot, startedAtMs: number): AgentActivityProps {
  return {
    agentName: snapshot.agentName,
    status: snapshot.status,
    detail: snapshot.detail,
    startedAtMs,
  };
}

/**
 * Registering the layout touches the native module, so it is deferred until
 * something actually asks for an activity -- on Android and on iOS builds
 * without the widget extension the module is never loaded at all.
 */
function resolveFactory(): LiveActivityFactory<AgentActivityProps> | null {
  if (factory !== undefined) return factory;
  if (!isLiveActivitySupported()) {
    factory = null;
    return factory;
  }
  try {
    // Deliberately `require`: a static import would register the layout with
    // the native module at startup on every platform, which is exactly what
    // the guards above exist to avoid.
    // oxlint-disable-next-line typescript/no-require-imports
    const module = require('./live-activity-layout') as {
      default: LiveActivityFactory<AgentActivityProps>;
    };
    factory = module.default ?? null;
  } catch {
    factory = null;
  }
  return factory;
}
