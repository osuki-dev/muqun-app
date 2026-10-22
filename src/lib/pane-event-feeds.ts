/**
 * The session event feeds this app has open, by gateway and session, so a
 * reader that only needs to know *when* a pane printed (the Home Stage
 * subtitle) can listen to a feed a screen already holds instead of opening a
 * second stream to the same computer.
 *
 * Every `usePaneEvents` connection registers here and reports which panes
 * printed and whether it is connected. A screen's feed (the reply drawer's, the
 * terminal's) is *shared*; a reader's own fallback feed is a *borrower*, opened
 * only while no shared feed is registered for its key, so at most one stream
 * per session serves it. Watchers hear every feed's changes for the key and
 * whether any of them is connected.
 */

type Feed = { borrower: boolean; connected: boolean };

export type PaneFeedWatcher = {
  /** Whether any feed for the key is connected; called at once on watch. */
  onLive: (live: boolean) => void;
  /** A pane printed. Its revision is not passed: Herdr's can stand still while it prints. */
  onChanged: (paneId: string) => void;
};

type Hub = { feeds: Set<Feed>; watchers: Set<PaneFeedWatcher>; live: boolean };

export type PaneFeedHandle = {
  connected: (up: boolean) => void;
  changed: (paneId: string) => void;
  close: () => void;
};

const hubs = new Map<string, Hub>();
const sharedListeners = new Set<() => void>();

export function paneFeedKey(gatewayUrl: string, sessionId: string): string {
  return `${gatewayUrl.replace(/\/$/, '')}\n${sessionId}`;
}

function hubFor(key: string): Hub {
  let hub = hubs.get(key);
  if (!hub) {
    hub = { feeds: new Set(), watchers: new Set(), live: false };
    hubs.set(key, hub);
  }
  return hub;
}

function forget(key: string, hub: Hub): void {
  if (hub.feeds.size === 0 && hub.watchers.size === 0) hubs.delete(key);
}

function settleLive(hub: Hub): void {
  let live = false;
  for (const feed of hub.feeds) live ||= feed.connected;
  if (live === hub.live) return;
  hub.live = live;
  for (const watcher of hub.watchers) watcher.onLive(live);
}

function sharedChanged(): void {
  for (const listener of sharedListeners) listener();
}

/** Register a connection; `close` it when the connection is torn down. */
export function openPaneFeed(key: string, borrower: boolean): PaneFeedHandle {
  const hub = hubFor(key);
  const feed: Feed = { borrower, connected: false };
  hub.feeds.add(feed);
  if (!borrower) sharedChanged();
  return {
    connected: (up) => {
      if (!hub.feeds.has(feed) || feed.connected === up) return;
      feed.connected = up;
      settleLive(hub);
    },
    changed: (paneId) => {
      if (!hub.feeds.has(feed)) return;
      for (const watcher of hub.watchers) watcher.onChanged(paneId);
    },
    close: () => {
      if (!hub.feeds.delete(feed)) return;
      settleLive(hub);
      forget(key, hub);
      if (!borrower) sharedChanged();
    },
  };
}

export function watchPaneFeed(key: string, watcher: PaneFeedWatcher): () => void {
  const hub = hubFor(key);
  hub.watchers.add(watcher);
  watcher.onLive(hub.live);
  return () => {
    hub.watchers.delete(watcher);
    forget(key, hub);
  };
}

/** Whether a screen holds a feed for `key` (connected or reconnecting). */
export function hasSharedPaneFeed(key: string): boolean {
  for (const feed of hubs.get(key)?.feeds ?? []) if (!feed.borrower) return true;
  return false;
}

/** Called whenever a shared feed opens or closes anywhere. */
export function subscribeSharedPaneFeeds(listener: () => void): () => void {
  sharedListeners.add(listener);
  return () => {
    sharedListeners.delete(listener);
  };
}
