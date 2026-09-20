import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

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

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('tree and detail routes are full-detent native sheets that retain their workbench owner', () => {
  for (const route of ['agent-session-tree', 'agent-subagent-detail']) {
    expect(sheetRouteOptions(route).presentation).toBe('formSheet');
    expect(sheetRouteDetents[route]).toBe('full');
    expect(sheetRouteContent[route]).toBe('list');
    expect(isAgentWorkbenchOwnedRootRoute(route)).toBe(true);
    expect(isAgentWorkbenchOwnedOverlayPath(`/${route}`)).toBe(true);
    expect(source('app/_layout.tsx')).toContain(`name="${route}"`);
  }
  for (const platform of ['ios', 'android'])
    expect(resolveDetents('full', 'list', platform)).toEqual([1]);
});

test('tree keeps its virtualized list while descendants open detail without selecting the workbench', () => {
  const sheet = source('components/agent-session-tree-sheet.tsx');
  expect(sheet).toContain("from '@legendapp/list/react-native'");
  expect(sheet).toContain('function SessionTreeRow(');
  expect(sheet).toContain('recycleItems');
  expect(sheet).not.toContain('<ScrollView');
  const route = source('app/agent-session-tree.tsx');
  expect(route).toContain('if (node.depth === 0)');
  expect(route).toContain('selectSession(node.session.asid)');
  expect(route).toContain("pathname: '/agent-subagent-detail'");
  expect(route).toContain('router.back()');
});

test('detail replaces nested targets in place and cannot form a deeper native stack', () => {
  const layout = source('app/_layout.tsx');
  const detailRegistration = layout.slice(layout.indexOf('name="agent-subagent-detail"'));
  expect(detailRegistration).toContain('dangerouslySingular');
  const route = source('app/agent-subagent-detail.tsx');
  expect(route).toContain('router.setParams({');
  expect(route).not.toContain('router.push(');
  const detail = source('components/agent-subagent-detail-sheet.tsx');
  expect(detail).toContain('readOnly: true');
  expect(detail).toContain('initialScrollAtEnd={false}');
  expect(detail).toContain('maintainScrollAtEnd={false}');
  const messages = source('components/agent-message-block.tsx');
  expect(messages).toContain('usePermissionForToolCall(part.id, !readOnly)');
  expect(messages).toContain('usePermissionDecider(!readOnly)');
});

test('native toolbar and accessibility traversal follow the same exact chip order', () => {
  const composer = source('components/agent-composer.tsx');
  const toolbar = composer.slice(composer.indexOf("chipIds.has('sessions')"));
  const markers = [
    "chipIds.has('sessions')",
    "chipIds.has('inbox')",
    "chipIds.has('background')",
    "chipIds.has('tasks')",
    "chipIds.has('delivery')",
    "chipIds.has('stop')",
    "chipIds.has('context')",
    "chipIds.has('diff')",
    'testID="agent-composer-mode-btn"',
    "chipIds.has('model')",
  ];
  const positions = markers.map((marker) => toolbar.indexOf(marker));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});

test('current root opens its tree on one tap and keeps the explicit screen-reader action', () => {
  const composer = source('components/agent-composer.tsx');
  expect(composer).toContain("name: 'openSessionTree'");
  expect(composer).toContain('onOpenTree(session.asid)');
  expect(composer).toContain('current && node.hasChildren && onOpenTree');
  expect(composer).toContain('current={node.session.asid === activeAsid}');
  expect(composer).not.toContain('lastPressRef');
  expect(composer).not.toContain('Date.now()');
  expect(composer).toContain('selectedRootAsid');
  const workbench = source('components/agent-workbench.tsx');
  expect(workbench).toContain('treeSheetOpeningRef.current = true');
  const load = workbench.indexOf('void refreshChildren(rootAsid)');
  const navigate = workbench.indexOf("pathname: '/agent-session-tree'");
  expect(load).toBeGreaterThan(0);
  expect(navigate).toBeGreaterThan(load);
  expect(workbench).toContain("pathname: '/agent-session-tree'");
  expect(workbench).toContain('sessionStrip={rootStrip.nodes}');
  expect(workbench).toContain('buildSessionStrip(workspaceRoots, childrenByParent, activeAsid)');
  expect(workbench).toContain('onOpenChildSession: openSubagentDetail');
});

test('child inventory transport captures the full Gateway endpoint instead of deduping by path', () => {
  const sessions = source('lib/agent-session.ts');
  const start = sessions.indexOf('export async function listAgentSessionChildrenObserved');
  const end = sessions.indexOf('export async function listAgentSessionChildren(', start);
  const childRead = sessions.slice(start, end);
  expect(childRead).toContain('const url = gatewayUrl(path)');
  expect(childRead).toContain('const headers = gatewayAuthHeaders()');
  expect(childRead).toContain("gatewayFetch(url, { method: 'GET', headers })");
  expect(childRead).not.toContain('dedupeInFlight(');
});
