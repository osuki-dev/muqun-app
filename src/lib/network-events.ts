/**
 * One listener for the device's network changing under the app.
 *
 * A phone that walks from Wi-Fi onto cellular keeps every socket it had open
 * on the old route, and those sockets do not fail -- they go quiet. Nothing
 * reconnects until a ping or a read timeout gives up on them, tens of seconds
 * later. So a change of connectivity or of network type is treated as what it
 * is: every live channel is suspect, reopen them now.
 *
 * One native subscription for the whole app, shared by every caller and
 * removed when the last one leaves. `expo-network` is required rather than
 * imported, exactly like the socket module: an OTA bundle can reach a binary
 * built before the native module existed, and there the feature is simply
 * absent instead of the bundle failing to load.
 */

export interface NetworkSnapshot {
  isConnected: boolean | undefined;
  type: string | undefined;
}

/**
 * Whether a new network state is a change worth reconnecting for.
 *
 * The first report is a baseline, not a change. After that, connectivity or
 * the kind of network changing is; `isInternetReachable` flickering on its own
 * is not -- it is the platform's guess, revised on its own schedule, and
 * reconnecting on every revision would be churn.
 */
export function isNetworkChange(previous: NetworkSnapshot | null, next: NetworkSnapshot): boolean {
  if (!previous) return false;
  return previous.isConnected !== next.isConnected || previous.type !== next.type;
}

type ExpoNetworkModule = {
  addNetworkStateListener: (
    listener: (event: { isConnected?: boolean; type?: string }) => void
  ) => { remove: () => void };
  getNetworkStateAsync: () => Promise<{ isConnected?: boolean; type?: string }>;
};

function expoNetwork(): ExpoNetworkModule | null {
  try {
    // oxlint-disable-next-line typescript/no-require-imports -- guarded native import, see above
    return require('expo-network') as ExpoNetworkModule;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let release: (() => void) | null = null;
let last: NetworkSnapshot | null = null;

function start(): void {
  const network = expoNetwork();
  if (!network) return;
  try {
    const subscription = network.addNetworkStateListener((event) => {
      const next = { isConnected: event.isConnected, type: event.type };
      const changed = isNetworkChange(last, next);
      last = next;
      if (!changed) return;
      for (const listener of [...listeners]) listener();
    });
    release = () => subscription.remove();
    // The baseline, so the first real event can be compared with something.
    void network
      .getNetworkStateAsync()
      .then((state) => {
        last ??= { isConnected: state.isConnected, type: state.type };
      })
      .catch(() => {});
  } catch {
    release = null;
  }
}

/** Called after the network changed. The returned function unsubscribes. */
export function onNetworkChange(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && !release) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    release?.();
    release = null;
    last = null;
  };
}
