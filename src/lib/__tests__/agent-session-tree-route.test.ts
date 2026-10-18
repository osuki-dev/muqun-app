import { expect, test } from 'bun:test';

import {
  sheetRouteOptions,
  sheetRouteDetents,
  sheetRouteContent,
  resolveDetents,
} from '../route-presentation';
import {
  isAgentWorkbenchOwnedRootRoute,
  isAgentWorkbenchOwnedOverlayPath,
} from '../agent-workbench-global-owner';

test('tree and detail routes are full-detent native sheets that retain their workbench owner', () => {
  for (const route of ['agent-session-tree', 'agent-subagent-detail']) {
    expect(sheetRouteOptions(route).presentation).toBe('formSheet');
    expect(sheetRouteDetents[route]).toBe('full');
    expect(sheetRouteContent[route]).toBe('list');
    expect(isAgentWorkbenchOwnedRootRoute(route)).toBe(true);
    expect(isAgentWorkbenchOwnedOverlayPath(`/${route}`)).toBe(true);
  }
  for (const platform of ['ios', 'android'])
    expect(resolveDetents('full', 'list', platform)).toEqual([1]);
});
