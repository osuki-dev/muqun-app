import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import { productionSource, transpile, walk } from '@/test-support/production-source';

const source = productionSource('src/components/agent-composer.tsx');
let onLayout = '';
let report = '';
walk(source.program, (node) => {
  if (
    node.type === 'JSXAttribute' &&
    node.name.type === 'JSXIdentifier' &&
    node.name.name === 'onLayout' &&
    node.value?.type === 'JSXExpressionContainer' &&
    source.code(node.value.expression).includes('setSurfaceHeight')
  ) {
    onLayout = source.code(node.value.expression);
  }
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'useEffect' &&
    node.arguments[0] &&
    source
      .code(node.arguments[0])
      .includes('reportDockHeight(dockHeight + decorationClearance, dockHeight)')
  ) {
    report = source.code(node.arguments[0]);
  }
});

function measurement() {
  const reported: number[] = [];
  const clipHeights: number[] = [];
  const local: number[] = [];
  const context = {
    accessoryHeightAnimating: false,
    surfaceHeight: 0,
    dockHeight: 0,
    dockFoot: 20,
    decorationClearance: 0,
    setSurfaceHeight: (height: number) => {
      context.surfaceHeight = height;
      context.dockHeight = height + context.dockFoot;
      local.push(height);
    },
    reportDockHeight: (height: number, clipHeight: number) => {
      reported.push(height);
      clipHeights.push(clipHeight);
    },
  };
  const layout = runInNewContext(transpile(`(${onLayout});`), context) as (event: {
    nativeEvent: { layout: { height: number } };
  }) => void;
  const update = runInNewContext(transpile(`(${report});`), context) as () => void;
  return {
    reported,
    clipHeights,
    local,
    layout: (height: number) => {
      layout({ nativeEvent: { layout: { height } } });
      update();
    },
    animating: (value: boolean) => {
      context.accessoryHeightAnimating = value;
      update();
    },
    insets: (foot: number, clearance: number) => {
      context.dockFoot = foot;
      context.dockHeight = context.surfaceHeight + foot;
      context.decorationClearance = clearance;
      update();
    },
  };
}

test('accessory animation keeps popup measurements current without reflowing Home every frame', () => {
  const dock = measurement();
  dock.layout(180);
  dock.animating(true);
  for (const height of [190, 230, 300, 420]) dock.layout(height);
  expect(dock.local).toEqual([180, 190, 230, 300, 420]);
  expect(dock.reported).toEqual([200]);
  dock.animating(false);
  expect(dock.reported).toEqual([200, 440]);
});

test('an interrupted open/close sequence reports its final height including the dock foot', () => {
  const dock = measurement();
  dock.animating(true);
  for (const height of [220, 280, 250, 300, 420]) dock.layout(height);
  expect(dock.reported).toEqual([]);
  dock.animating(false);
  expect(dock.reported).toEqual([440]);
  dock.animating(true);
  dock.layout(180);
  dock.animating(false);
  expect(dock.reported).toEqual([440, 200]);
});

test('ordinary draft and instantaneous layout changes still report immediately', () => {
  const dock = measurement();
  dock.layout(180);
  dock.layout(210);
  dock.layout(450);
  expect(dock.reported).toEqual([200, 230, 470]);
});

test('content and inset changes during a reveal are included in its settled report', () => {
  const dock = measurement();
  dock.animating(true);
  dock.layout(300);
  dock.insets(40, 15);
  dock.layout(460);
  expect(dock.reported).toEqual([]);
  dock.animating(false);
  expect(dock.reported).toEqual([515]);
  expect(dock.clipHeights).toEqual([500]);
});

test('transparent decoration keeps its scroll clearance without clipping the page above the field', () => {
  const dock = measurement();
  dock.insets(20, 48);
  dock.layout(180);
  expect(dock.reported).toEqual([248]);
  expect(dock.clipHeights).toEqual([200]);
  // Menus and voice hide the decoration, while the field keeps the same boundary.
  dock.insets(20, 0);
  expect(dock.reported).toEqual([248, 200]);
  expect(dock.clipHeights).toEqual([200, 200]);
});
