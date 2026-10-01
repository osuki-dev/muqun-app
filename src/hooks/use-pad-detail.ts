import { useEffect, useReducer, useRef } from 'react';
import {
  initialPadShellState,
  padShellReducer,
  type PadRouteParams,
  type PadShellEvent,
  type PadShellState,
} from '@/lib/pad-detail';

/**
 * The Pad shell's detail column and whether Home covers it.
 *
 * Route params are applied once per distinct value: a notification deep link
 * that lands with `asid` opens that session, and re-rendering with the same
 * params does not reopen it after the reader has moved on.
 */
export function usePadDetail(serverId: string, params: PadRouteParams) {
  const [state, dispatch] = useReducer(padShellReducer, initialPadShellState);
  const routeKey = [
    serverId,
    params.asid ?? '',
    params.sessionId ?? '',
    params.intent ?? '',
    params.overview ?? '',
  ].join('\u0000');
  const appliedRouteKey = useRef<string | null>(null);
  useEffect(() => {
    if (appliedRouteKey.current === routeKey) return;
    appliedRouteKey.current = routeKey;
    dispatch({ type: 'route', params, serverId });
  }, [params, routeKey, serverId]);
  return { state, dispatch } as { state: PadShellState; dispatch: (event: PadShellEvent) => void };
}
