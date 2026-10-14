import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { productionSource, declaration, walk } from '../../test-support/production-source';
import { isSessionUnread, sessionTitleOr } from '../../lib/agent-protocol';
import type { SessionNode } from '../../lib/agent-session-tree';

/** Execute the production row, replacing only native, store and localization boundaries. */
function rowRenderer() {
  const path = 'src/components/agent-session-tree-sheet.tsx';
  const source = productionSource(path);
  let styles = '';
  walk(source.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === 'styles' &&
      node.init
    ) {
      styles = source.code(node.init);
    }
  });
  const require = createRequire(import.meta.url);
  const code = require('@babel/core').transformSync(
    `const styles = ${styles}; ${declaration(path, 'SessionTreeRow')}; exports.render = SessionTreeRow;`,
    {
      filename: 'tree-render.tsx',
      babelrc: false,
      configFile: false,
      presets: ['@react-native/babel-preset'],
    }
  ).code;
  const exports: { render?: (props: object) => any } = {};
  runInNewContext(code, {
    exports,
    require,
    isSessionUnread,
    sessionTitleOr,
    useLingui: () => ({
      t: (parts: string[], ...values: unknown[]) =>
        parts.reduce((text, part, i) => text + part + (values[i] ?? ''), ''),
    }),
    useThemeTokens: () => ({ colors: { border: 'border' } }),
    useAgentSheetBridge: (select: (state: object) => unknown) => select({ activeAsid: 'child' }),
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    View: 'View',
    SheetSceneRow: 'SheetSceneRow',
    AgentUnreadDot: 'AgentUnreadDot',
  });
  if (!exports.render) throw new Error('Missing tree row renderer');
  return exports.render;
}

test('tree captions keep identity and observed status without repeating level or parent; row interactions survive recycling', () => {
  const render = rowRenderer();
  const opened: SessionNode[] = [];
  const child: SessionNode = {
    depth: 2,
    hasChildren: false,
    session: {
      asid: 'child',
      backend_session_id: 'child',
      agent_id: 'opencode',
      parent_id: 'parent',
      title: 'Review task',
      agent_name: 'Reviewer',
      agent_role: 'Security',
      mode: 'build',
      status: 'busy',
      model: null,
      updated_ms: 2,
      time_idle: 2,
      time_viewed: 1,
    },
  };
  const branch = render({
    node: child,
    parentTitle: 'Parent task',
    onPress: (node: SessionNode) => opened.push(node),
  });
  const row = branch.props.children[1];
  expect(row.props.title).toBe('Review task');
  expect(row.props.caption).toBe('Reviewer · Security · Running');
  expect(row.props.accessibilityValue).toEqual({ text: row.props.caption });
  expect(row.props.selected).toBe(true);
  expect(row.props.busy).toBe(true);
  expect(row.props.accessibilityLabel).toBe('Review task — finished while you were away');
  expect(row.props.meta.props.testID).toBe('agent-session-tree-unread-child');
  expect(branch.props.style[1].marginLeft).toBe(32);
  expect(branch.props.children[0].props.pointerEvents).toBe('none');
  row.props.onPress();
  expect(opened).toEqual([child]);
  expect(opened[0]).toBe(child);
  expect(opened[0]?.session.parent_id).toBe('parent');

  const root: SessionNode = {
    ...child,
    depth: 0,
    session: {
      ...child.session,
      asid: 'root',
      title: '',
      agent_name: undefined,
      agent_role: undefined,
      status: 'idle',
      time_viewed: 2,
    },
  };
  const recycled = render({ node: root, onPress: (node: SessionNode) => opened.push(node) });
  const rootRow = recycled.props.children[1];
  expect(rootRow.props.title).toBe('Untitled session');
  expect(rootRow.props.caption).toBe('build · Idle');
  expect(rootRow.props.selected).toBe(false);
  expect(rootRow.props.busy).toBe(false);
  expect(rootRow.props.meta).toBeUndefined();
  expect(rootRow.props.accessibilityLabel).toBe('Untitled session');
  expect(recycled.props.style[1].marginLeft).toBe(0);
  expect(recycled.props.children[0]).toBeNull();
});
