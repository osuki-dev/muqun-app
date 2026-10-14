import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { isCenteredSettingsSheetRoute, sheetRouteOptions } from '@/lib/route-presentation';
import { declaration, productionSource, walk } from '@/test-support/production-source';

const nodeRequire = createRequire(import.meta.url);
const { transformSync } = nodeRequire('@babel/core') as {
  transformSync: (source: string, options: Record<string, unknown>) => { code: string };
};
function execute(source: string, context: Record<string, unknown>) {
  const code = transformSync(source, {
    filename: 'fullscreen-scene.tsx',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }).code;
  return runInNewContext(code, { require: nodeRequire, ...context });
}

type Element = ReactElement<{
  children?: ReactNode;
  value?: boolean;
  style?: unknown;
  trailing?: ReactNode;
}>;
function elements(value: ReactNode): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

const layout = productionSource('src/app/_layout.tsx');
let screenLayout = '';
walk(layout.program, (node) => {
  if (
    node.type === 'JSXAttribute' &&
    node.name.type === 'JSXIdentifier' &&
    node.name.name === 'screenLayout' &&
    node.value?.type === 'JSXExpressionContainer'
  )
    screenLayout = layout.code(node.value.expression);
});

function routeContext(route: string, isPad: boolean) {
  const element = execute(`(${screenLayout})(props)`, {
    props: {
      route: { name: route },
      options: sheetRouteOptions(route, undefined, false, isPad),
      children: createElement('child'),
    },
    isPad,
    isCenteredSettingsSheetRoute,
    RouteScene: 'RouteScene',
    SheetRouteFrame: 'SheetRouteFrame',
    SheetFullscreenProvider: 'SheetFullscreenProvider',
  }) as Element;
  return elements(element).find((node) => node.type === 'SheetFullscreenProvider')?.props.value;
}

function scene(fullscreen: boolean, topInset = 0) {
  return execute(
    `${declaration('src/components/sheet-scene.tsx', 'SheetScene')}\nSheetScene(props)`,
    {
      props: { title: 'Diagram', children: createElement('content'), topInset },
      useSheetIsFullscreen: () => fullscreen,
      useSafeAreaInsets: () => ({ top: 48 }),
      styles: { fixedTop: {}, scene: {} },
      SHEET_LADDER: { gap: 8 },
      SheetFrame: 'SheetFrame',
      View: 'View',
      SheetHandle: 'SheetHandle',
      SheetSceneHeading: 'SheetSceneHeading',
      SheetSceneClose: 'SheetSceneClose',
    }
  ) as Element;
}

test('the real stack gives a fullscreen sheet safe-area and close semantics on phone and Pad', () => {
  for (const isPad of [false, true]) {
    const fullscreen = routeContext('diagram-viewer', isPad);
    expect(fullscreen).toBe(true);
    const nodes = elements(scene(fullscreen!));
    const top = nodes.find((node) => Array.isArray(node.props.style));
    expect(top?.props.style).toEqual([{}, { paddingTop: 56 }]);
    const heading = nodes.find((node) => node.type === 'SheetSceneHeading');
    expect(elements(heading?.props.trailing).some((node) => node.type === 'SheetSceneClose')).toBe(
      true
    );
  }
});

test('ordinary sheets keep native insets and dismissal; Pad work surfaces retain full-screen semantics', () => {
  expect(routeContext('agent-model', false)).toBeUndefined();
  expect(routeContext('agent-model', true)).toBeUndefined();
  expect(routeContext('settings-servers', true)).toBeUndefined();
  expect(routeContext('git-diff', true)).toBe(true);
  const nodes = elements(scene(false, 12));
  expect(nodes.find((node) => Array.isArray(node.props.style))?.props.style).toEqual([
    {},
    { paddingTop: 20 },
  ]);
  expect(nodes.find((node) => node.type === 'SheetSceneHeading')?.props.trailing).toBeUndefined();
});

test('full-screen clearance does not double an existing explicit top inset', () => {
  const nodes = elements(scene(true, 60));
  expect(nodes.find((node) => Array.isArray(node.props.style))?.props.style).toEqual([
    {},
    { paddingTop: 68 },
  ]);
});

test('a fullscreen sheet has no draggable handle on Android', () => {
  const handle = execute(
    `${declaration('src/components/sheet-route-frame.tsx', 'SheetHandle')}\nSheetHandle({})`,
    {
      useSheetIsFullscreen: () => routeContext('diagram-viewer', false),
      useAppearanceProfile: () => ({}),
      useThemeTokens: () => ({ colors: {} }),
      process: { env: { EXPO_OS: 'android' } },
    }
  );
  expect(handle).toBeNull();
});
