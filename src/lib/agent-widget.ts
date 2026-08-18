import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The Android home-screen mirror of agent status.
 *
 * A widget cannot hold the gateway's SSE stream open, and it must not be able
 * to open one either: the pairing token is the whole key to a developer's
 * machine. So nothing here talks to the gateway. The app writes a summary of
 * what it already knows into a small store, and the widget renders that summary
 * and nothing else. The worst a compromised widget process can leak is the list
 * of agent names the user already put on their home screen.
 *
 * Concretely, the snapshot below carries no URL, no token, and no pane output --
 * only ids the app needs to route a tap back to the right panel.
 */

/** Names the config plugin registers; the task handler dispatches on them. */
export const AGENT_WIDGET_SQUARE = 'AgentStatusSquare';
export const AGENT_WIDGET_ROW = 'AgentStatusRow';
export const AGENT_WIDGET_NAMES = [AGENT_WIDGET_SQUARE, AGENT_WIDGET_ROW] as const;
export type AgentWidgetName = (typeof AGENT_WIDGET_NAMES)[number];

export type AgentWidgetStatus = 'working' | 'blocked' | 'idle' | 'done' | 'unknown';

export type AgentWidgetEntry = {
  /** Gateway agent id. Opaque; used only to key the row. */
  id: string;
  name: string;
  status: AgentWidgetStatus;
  /** Pane the agent runs in, so a tap lands on the panel rather than the app. */
  paneId: string;
};

export type AgentWidgetSnapshot = {
  version: 1;
  /** Local record id, which is what `/servers/[serverId]` routes on. */
  serverId: string;
  serverLabel: string;
  sessionId: string;
  /** When the app last confirmed these statuses with the gateway. */
  checkedAtMs: number;
  agents: AgentWidgetEntry[];
};

const STORAGE_KEY = 'muqun.agent-widget.v1';

/**
 * Secure storage is not sized for bulk data and a 2x2 tile shows three rows, so
 * the mirror is capped well below anything a launcher could display. Names are
 * clipped for the same reason: a widget truncates them anyway.
 */
const MAX_AGENTS = 8;
const MAX_NAME_LENGTH = 32;

/**
 * How long an unchanged snapshot may sit before the app rewrites it. The
 * backstop poll runs every 12s; without this the widget would be redrawn five
 * times a minute to move a "just now" label that has not moved.
 */
const REFRESH_INTERVAL_MS = 60 * 1000;

/** After this, the widget stops claiming the statuses are current. */
export const AGENT_WIDGET_STALE_AFTER_MS = 30 * 60 * 1000;

const KNOWN_STATUSES: readonly AgentWidgetStatus[] = [
  'working',
  'blocked',
  'idle',
  'done',
  'unknown',
];

/** Narrows the gateway's free-form status the way the Live Activity does. */
export function asAgentWidgetStatus(status: string | undefined): AgentWidgetStatus {
  return KNOWN_STATUSES.find((value) => value === status) ?? 'unknown';
}

/**
 * Widgets exist on Android only. iOS has the Live Activity instead, and the web
 * build has neither, so callers can ask before doing any work.
 */
export function isAgentWidgetSupported(): boolean {
  return Platform.OS === 'android';
}

/** Reads the mirror. Returns `null` when nothing has been written or it is unreadable. */
export async function readAgentWidgetSnapshot(): Promise<AgentWidgetSnapshot | null> {
  try {
    const value = await SecureStore.getItemAsync(STORAGE_KEY);
    return value ? parseSnapshot(value) : null;
  } catch {
    // A widget that cannot read the mirror renders its empty state; there is no
    // user-facing surface here to report an error to.
    return null;
  }
}

/**
 * Reconciles the home screen against the agents the app currently knows about.
 * This is the whole integration surface: hand it the agent list (or `null` when
 * the feature is off or no server is connected) and it works out whether that
 * means a rewrite, a redraw, or nothing at all.
 */
export async function syncAgentWidget(snapshot: AgentWidgetSnapshot | null): Promise<void> {
  if (!isAgentWidgetSupported()) return;

  if (!snapshot) {
    await clearAgentWidget();
    return;
  }

  const next = normalizeSnapshot(snapshot);
  if (!shouldWrite(next)) return;
  lastWritten = next;

  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Fall through and still redraw: the widget reads the snapshot it is handed
    // when the app pushes, so one failed write costs freshness, not the tile.
  }
  await drawAgentWidgets(next);
}

/**
 * Drops the mirror and repaints the empty state. Called when the setting is
 * switched off or the last server is unpaired -- a tile left showing yesterday's
 * agents is worse than one that says it has nothing.
 */
export async function clearAgentWidget(): Promise<void> {
  if (!isAgentWidgetSupported()) return;
  lastWritten = null;
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch {
    // Nothing stored, or storage is unavailable. Redraw regardless.
  }
  await drawAgentWidgets(null);
}

/**
 * Deep link for a tap. Panels are addressed the same way a notification
 * addresses them, so the widget reuses the route the app already handles.
 */
export function agentWidgetUri(snapshot: AgentWidgetSnapshot, entry?: AgentWidgetEntry): string {
  // Built by hand rather than with `URLSearchParams`: React Native's polyfill
  // does not implement `toString`, and this runs inside the widget task too.
  const query = [`sessionId=${encodeURIComponent(snapshot.sessionId)}`];
  if (entry?.paneId) query.push(`paneId=${encodeURIComponent(entry.paneId)}`);
  return `muqun://servers/${encodeURIComponent(snapshot.serverId)}?${query.join('&')}`;
}

/** Whether the mirror is old enough that the widget should say so. */
export function isAgentWidgetStale(snapshot: AgentWidgetSnapshot, nowMs = Date.now()): boolean {
  return nowMs - snapshot.checkedAtMs > AGENT_WIDGET_STALE_AFTER_MS;
}

/**
 * How old the mirror is, as a bucket and a count -- "just now", "4m ago", "2h
 * ago", which is all a tile has room for.
 *
 * Parts rather than a sentence, the same split `serverAgentsAgeParts` makes and
 * for the same two reasons. "5m ago" is English's abbreviation, and a translator
 * needs the whole phrase rather than a unit letter dropped into a hole; and this
 * module is a pure rule that other code imports, while the wording belongs with
 * the thing doing the drawing. `agent-widget-layout` says it out loud.
 */
export function agentWidgetAgeParts(
  snapshot: AgentWidgetSnapshot,
  nowMs = Date.now()
): { unit: 'now' | 'minute' | 'hour' | 'day'; value: number } {
  const seconds = Math.max(0, Math.round((nowMs - snapshot.checkedAtMs) / 1000));
  if (seconds < 90) return { unit: 'now', value: 0 };
  if (seconds < 3600) return { unit: 'minute', value: Math.floor(seconds / 60) };
  if (seconds < 86400) return { unit: 'hour', value: Math.floor(seconds / 3600) };
  return { unit: 'day', value: Math.floor(seconds / 86400) };
}

/**
 * What the app last pushed, so a poll that changed nothing costs no keychain
 * write and no RemoteViews round-trip.
 */
let lastWritten: AgentWidgetSnapshot | null = null;

function shouldWrite(next: AgentWidgetSnapshot): boolean {
  const previous = lastWritten;
  if (!previous) return true;
  if (next.checkedAtMs - previous.checkedAtMs >= REFRESH_INTERVAL_MS) return true;
  return !sameContent(previous, next);
}

function sameContent(a: AgentWidgetSnapshot, b: AgentWidgetSnapshot): boolean {
  if (a.serverId !== b.serverId) return false;
  if (a.serverLabel !== b.serverLabel) return false;
  if (a.sessionId !== b.sessionId) return false;
  if (a.agents.length !== b.agents.length) return false;
  return a.agents.every((agent, index) => {
    const other = b.agents[index];
    return agent.id === other.id
      && agent.name === other.name
      && agent.status === other.status
      && agent.paneId === other.paneId;
  });
}

function normalizeSnapshot(snapshot: AgentWidgetSnapshot): AgentWidgetSnapshot {
  return {
    ...snapshot,
    version: 1,
    agents: snapshot.agents.slice(0, MAX_AGENTS).map((agent) => ({
      id: agent.id,
      name: agent.name.slice(0, MAX_NAME_LENGTH),
      status: agent.status,
      paneId: agent.paneId,
    })),
  };
}

/**
 * Anything read back out of storage is untrusted input: an older build may have
 * written a different shape, and a half-parsed snapshot would render as a tile
 * full of `undefined`.
 */
function parseSnapshot(value: string): AgentWidgetSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) return null;
    if (typeof record.serverId !== 'string' || !record.serverId) return null;
    if (typeof record.sessionId !== 'string') return null;
    if (typeof record.checkedAtMs !== 'number') return null;
    if (!Array.isArray(record.agents)) return null;
    return {
      version: 1,
      serverId: record.serverId,
      serverLabel: typeof record.serverLabel === 'string' ? record.serverLabel : 'Muqun',
      sessionId: record.sessionId,
      checkedAtMs: record.checkedAtMs,
      agents: record.agents.flatMap((item) => {
        if (typeof item !== 'object' || item === null) return [];
        const agent = item as Record<string, unknown>;
        if (typeof agent.id !== 'string' || typeof agent.name !== 'string') return [];
        return [{
          id: agent.id,
          name: agent.name,
          status: asAgentWidgetStatus(
            typeof agent.status === 'string' ? agent.status : undefined
          ),
          paneId: typeof agent.paneId === 'string' ? agent.paneId : '',
        }];
      }),
    };
  } catch {
    return null;
  }
}

/**
 * Redraws every widget instance on the home screen.
 *
 * Deliberately a `require`: `react-native-android-widget` resolves its native
 * TurboModule at import time and throws when the binary predates it, which is
 * every install until the next store build lands. A static import would take
 * the app down at startup instead of quietly skipping a home-screen tile.
 */
async function drawAgentWidgets(snapshot: AgentWidgetSnapshot | null): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bridge = require('./agent-widget-bridge') as {
      pushAgentWidgets: (value: AgentWidgetSnapshot | null) => Promise<void>;
    };
    await bridge.pushAgentWidgets(snapshot);
  } catch {
    // No widget module in this binary, or no widget on the home screen.
  }
}
