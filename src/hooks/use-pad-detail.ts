import { useEffect, useReducer, useRef } from 'react';
import {
  initialPadShellState,
  padRouteKey,
  padShellReducer,
  shouldApplyRoute,
  type PadRouteParams,
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
  const routeKey = padRouteKey(serverId, params);
  const appliedRouteKey = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldApplyRoute(appliedRouteKey.current, routeKey)) return;
    appliedRouteKey.current = routeKey;
    dispatch({ type: 'route', params, serverId });
  }, [params, routeKey, serverId]);
  return { state, dispatch };
}
