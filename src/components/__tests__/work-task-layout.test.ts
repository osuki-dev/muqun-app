import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as metrics from '../../lib/work-task-layout';

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function find(tree: Node, id: string) {
  const result = nodes(tree).find((node) => node.props.testID === id);
  if (!result) throw new Error(id);
  return result;
}
test('actual pane tree retains reading and composer nodes while measured width changes placement', () => {
  const states: unknown[] = [];
  let index = 0;
  let scale = 1;
  let keyboardSources = 0;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const imports: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const slot = index++;
        if (!(slot in states)) states[slot] = initial;
        return [
          states[slot],
          (value: unknown) => {
            states[slot] = value;
          },
        ];
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      ScrollView: 'ScrollView',
      View: 'View',
      StyleSheet: { create: (value: unknown) => value },
      useWindowDimensions: () => ({ fontScale: scale }),
    },
    'react-native-safe-area-context': {
      SafeAreaView: 'SafeAreaView',
      useSafeAreaInsets: () => ({ bottom: 20 }),
    },
    'react-native-reanimated': {
      default: { View: 'AnimatedView' },
      useAnimatedStyle: (fn: () => unknown) => fn(),
    },
    'react-native-keyboard-controller': {
      useReanimatedKeyboardAnimation: () => {
        keyboardSources++;
        return { height: { value: 0 } };
      },
    },
    '@osuki-dev/ui': {
      Text: 'Text',
      useThemeTokens: () => ({ colors: { background: 'white', text: 'black' } }),
    },
    'lucide-react-native': { X: 'X' },
    './sheet-ground': { SheetFrame: 'SheetFrame', useSheetGroundPlate: () => ({}) },
    './glass-chrome': { GlassChrome: 'GlassChrome' },
    './pressable-scale': { PressableScale: 'PressableScale' },
    './work-task-scroll': { WorkTaskScroll: 'WorkTaskScroll' },
    '@/lib/work-task-layout': metrics,
  };
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  const compiled = ts.transpileModule(
    readFileSync(new URL('../work-task-layout.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', compiled)((name: string) => {
    if (!(name in imports)) throw new Error(name);
    return imports[name];
  }, exports);
  const reading = jsx('Reading', {});
  const composer = jsx('Composer', {});
  let closes = 0;
  const props = {
    title: 'Task',
    caption: 'Server',
    closeLabel: 'Close',
    onClose: () => closes++,
    view: 'detail',
    list: jsx('List', {}),
    children: reading,
    creation: jsx('Creation', {}),
    composer,
    creationComposer: null,
    detailKey: 'task1',
    notice: null as Node | null,
  };
  const render = () => {
    index = 0;
    return exports.WorkTaskLayout(props);
  };
  let tree = render();
  (find(tree, 'task-layout-compact').props.onLayout as (event: unknown) => void)({
    nativeEvent: { layout: { width: 1000 } },
  });
  tree = render();
  expect(find(tree, 'task-layout-split')).toBeDefined();
  expect(find(tree, 'task-list-scroll').props.visible).toBe(true);
  expect(find(tree, 'task-detail-scroll').props.children).toBe(reading);
  expect(nodes(tree).filter((node) => node === composer)).toHaveLength(1);
  scale = 2;
  tree = render();
  expect(find(tree, 'task-layout-compact')).toBeDefined();
  expect(find(tree, 'task-list-scroll').props.visible).toBe(false);
  expect(find(tree, 'task-detail-scroll').props.children).toBe(reading);
  expect(nodes(tree).filter((node) => node === composer)).toHaveLength(1);
  expect(keyboardSources).toBe(3);
  const notice = jsx('ErrorNotice', { children: 'Revision conflict' });
  props.notice = notice;
  const beforeGeometry = find(tree, 'task-detail-scroll').props.geometry;
  tree = render();
  expect(find(tree, 'task-action-notice').props.children).toBe(notice);
  expect(nodes(tree).filter((node) => node === notice)).toHaveLength(1);
  for (const scroll of nodes(tree).filter((node) =>
    ['ScrollView', 'WorkTaskScroll'].includes(String(node.type))
  )) {
    expect(nodes(scroll.props.children)).not.toContain(notice);
  }
  expect(find(tree, 'task-detail-scroll').props.children).toBe(reading);
  expect(find(tree, 'task-detail-scroll').props.geometry).toBe(beforeGeometry);
  expect(nodes(tree).filter((node) => node === composer)).toHaveLength(1);
  expect(closes).toBe(0);
});

test('primary action errors have one live announcement owner in the fixed notice slot', () => {
  const source = readFileSync(new URL('../work-task-workspace.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile(
    'workspace.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const owners: ts.JsxOpeningElement[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isJsxOpeningElement(node) &&
      node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(tree) === 'testID' &&
          attribute.initializer &&
          ts.isStringLiteral(attribute.initializer) &&
          attribute.initializer.text === 'task-action-error'
      )
    )
      owners.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  expect(owners).toHaveLength(1);
  expect(owners[0].getText(tree)).toContain('accessibilityLiveRegion="polite"');
  let parent: ts.Node | undefined = owners[0];
  while (parent && !ts.isJsxAttribute(parent)) parent = parent.parent;
  expect(parent && ts.isJsxAttribute(parent) ? parent.name.getText(tree) : null).toBe('notice');
});

test('mounted task panes never emit extracted literal string children under native containers', () => {
  const failures: string[] = [];
  for (const file of [
    'work-task-layout.tsx',
    'work-task-workspace.tsx',
    'work-task-detail.tsx',
    'work-task-list.tsx',
  ]) {
    const source = ts.createSourceFile(
      file,
      readFileSync(new URL('../' + file, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    function visit(node: ts.Node) {
      if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteral(node.expression)) {
        const parent = node.parent;
        if (
          ts.isJsxFragment(parent) ||
          (ts.isJsxElement(parent) &&
            !['Text', 'Button'].includes(parent.openingElement.tagName.getText(source)))
        ) {
          failures.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(failures).toEqual([]);
});
