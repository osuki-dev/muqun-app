import { useCallback, useEffect, useRef, useState } from 'react';

import { summariseAwayEvents, wasAwayLongEnough, type AwayDigest } from '@/lib/away-digest';
import { demoAwayWindowStart, isDemoActive } from '@/lib/demo-gateway';
import { listAgentEvents } from '@/lib/gateway-client';
import { useServerLastViewed } from '@/stores/server-last-viewed';

export interface AwayDigestController {
  /** What to draw, or `null` for "draw nothing", which is most of the time. */
  digest: AwayDigest | null;
  /** Read it; it goes away. */
  dismiss: () => void;
}

export interface AwayDigestOptions {
  /** Local record id, the one the route uses to key stored per-server prefs. */
  serverId: string;
  sessionId: string;
  /** The gateway declared `agent_events`. False means this does nothing at all. */
  supported: boolean;
  /** The screen is on and connected. */
  enabled: boolean;
}

/**
 * The I/O around `away-digest.ts`: mark the visit, ask for the window, hand the
 * card a digest or nothing at all.
 *
 * Runs at most once per server per mount, and that is the whole design. The
 * mark is *consumed* when it is read (`visit` swaps it for now), so the window
 * this hook works from cannot be handed out twice -- a remount, a reconnect, a
 * second effect pass under React's development double-invoke, all of them find
 * a mark a few milliseconds old and correctly conclude that nobody was away.
 * That is why there is no polling and no refresh: the digest describes one
 * moment -- coming back -- and that moment happens once.
 *
 * Nothing here runs against a gateway that never declared the capability, which
 * is what "absent endpoint, invisible feature" means in practice: no request,
 * no mark, no card, and no code path that could produce one. The mark is only
 * ever written by a server that could have used it.
 *
 * Every failure path ends in `null`. A gateway that dropped the request, a ring
 * that has already rolled past the window, a server with nothing to report:
 * none of them are worth a card, and none of them are worth an error. The
 * promise is "if something happened while you were gone, you will be told"; it
 * is not "you will be told whether something happened".
 */
export function useAwayDigest({
  serverId,
  sessionId,
  supported,
  enabled,
}: AwayDigestOptions): AwayDigestController {
  const [digest, setDigest] = useState<AwayDigest | null>(null);
  const visit = useServerLastViewed((state) => state.visit);
  // One attempt per server per mount. The consumed mark already makes a second
  // attempt harmless, but harmless is not the same as free: without this, every
  // reconnect would spend a request to be told there is nothing to say.
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supported || !enabled || !serverId || !sessionId) return;
    if (attemptedRef.current === serverId) return;
    attemptedRef.current = serverId;

    let live = true;
    void (async () => {
      try {
        const nowMs = Date.now();
        const previous = await visit(serverId, nowMs);
        // Demo mode has no history to have been away from -- the mark it just
        // consumed was written seconds ago by this same launch -- so it is
        // handed a fabricated window, once per launch, and only where the real
        // one would not have produced a card anyway.
        const sinceMs = wasAwayLongEnough(previous, nowMs)
          ? previous
          : isDemoActive()
            ? demoAwayWindowStart(nowMs)
            : null;
        if (sinceMs === null || !wasAwayLongEnough(sinceMs, nowMs)) return;

        // The whole ring, not a window: the endpoint's own cursor is a sequence
        // number this app has no memory of. See `listAgentEvents`.
        const events = await listAgentEvents(sessionId);
        if (!live) return;
        setDigest(summariseAwayEvents(events, { sinceMs, nowMs: Date.now() }));
      } catch {
        // See the docblock: silence is the correct answer to a digest that
        // could not be built. The screen behind this is already saying whatever
        // there is to say about the connection.
      }
    })();

    return () => {
      live = false;
    };
  }, [enabled, serverId, sessionId, supported, visit]);

  const dismiss = useCallback(() => setDigest(null), []);

  return { digest, dismiss };
}
