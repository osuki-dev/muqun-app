import type { PaneOutputSource } from '@/lib/gateway-client';

/**
 * The last window any screen read of a pane, so the next screen to show that
 * pane paints it on its first frame instead of after a round trip.
 *
 * Three readers paint the same pane in this app -- the terminal workspace,
 * Home's reply drawer and the workspace prewarm -- and until now each held its
 * own window and started blank. Opening a pane the drawer was showing a moment
 * ago re-read the whole screen before drawing anything, which is the wait this
 * removes: the drawer's window is the pane as it was, the terminal paints it,
 * and its own read (issued on the same mount) corrects or confirms it.
 *
 * Only a first frame. Nothing here is truth: every reader still reads at once,
 * the stream's next frame folds over it, and a gateway restart forgets it
 * (`forgetWarmWorkspace`). It is in memory only and never persisted -- a pane's
 * text is the reader's, and it leaves with the process.
 *
 * The shape travels with the window, as it does in `lib/pane-cache`: a pane
 * read as an editor's screen is not the same picture as its scrollback, and a
 * window of another shape is declined rather than painted wrong.
 */
export type MirroredPaneWindow = {
  shape: string;
  output: string;
  atMs: number;
};

/**
 * How long a remembered window may still be painted as a first frame.
 *
 * Longer than the warm cache's 45 s on purpose: that window decides whether a
 * workspace is painted as *connected*, which a stale answer would misstate.
 * This decides only what the terminal shows for the few hundred milliseconds
 * before its own read lands, and a pane's last screen is a better first frame
 * than a blank one for as long as the reader would still recognise it.
 */
export const PANE_WINDOW_MIRROR_TTL_MS = 5 * 60_000;

/** Enough for the panes a reader moves between; this is not a history. */
const MAX_WINDOWS = 12;

const windows = new Map<string, MirroredPaneWindow>();

function key(serverId: string, sessionId: string, paneId: string): string {
  return `${serverId}\u0000${sessionId}\u0000${paneId}`;
}

/**
 * The one spelling of a window's shape, shared by every reader so that a
 * window remembered by one is recognised by another. Format, source and which
 * screen (`alt` while a program owns it), colon-separated.
 */
export function paneWindowShape(
  format: 'ansi' | 'text',
  source: PaneOutputSource,
  ownsScreen: boolean
): string {
  return `${format}:${source}:${ownsScreen ? 'alt' : 'main'}`;
}

export function rememberMirroredPaneWindow(
  serverId: string,
  sessionId: string,
  paneId: string,
  shape: string,
  output: string,
  nowMs = Date.now()
): void {
  if (!serverId || !sessionId || !paneId || !output) return;
  const id = key(serverId, sessionId, paneId);
  // Re-insert so the most recently written pane is last in iteration order.
  windows.delete(id);
  windows.set(id, { shape, output, atMs: nowMs });
  while (windows.size > MAX_WINDOWS) {
    const oldest = windows.keys().next();
    if (oldest.done) break;
    windows.delete(oldest.value);
  }
}

/** The pane's last window if it is recent enough to paint, else `null`. */
export function mirroredPaneWindow(
  serverId: string,
  sessionId: string,
  paneId: string,
  nowMs = Date.now()
): MirroredPaneWindow | null {
  const found = windows.get(key(serverId, sessionId, paneId));
  if (!found) return null;
  if (nowMs - found.atMs > PANE_WINDOW_MIRROR_TTL_MS || nowMs < found.atMs) {
    windows.delete(key(serverId, sessionId, paneId));
    return null;
  }
  return found;
}

/** Forget one server's panes, or every pane. */
export function forgetMirroredPaneWindows(serverId?: string): void {
  if (serverId === undefined) {
    windows.clear();
    return;
  }
  for (const id of Array.from(windows.keys())) {
    if (id.startsWith(`${serverId}\u0000`)) windows.delete(id);
  }
}
