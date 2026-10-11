import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { productionSource, transpile, walk } from '../../test-support/production-source';

const viewerPath = 'node_modules/@osuki-dev/skia-diagrams/src/react/index.tsx';

/** Run the actual viewer button callback without loading native Skia. */
function callback(marker: string, globals: Record<string, unknown>) {
  const source = productionSource(viewerPath);
  let expression: string | undefined;
  walk(source.program, (node) => {
    if (node.type !== 'JSXOpeningElement' || source.code(node.name) !== 'Pressable') return;
    const matches = node.attributes.some(
      (attribute) => attribute.type === 'JSXAttribute' && source.code(attribute).includes(marker)
    );
    if (!matches) return;
    for (const attribute of node.attributes) {
      if (
        attribute.type === 'JSXAttribute' &&
        source.code(attribute.name) === 'onPress' &&
        attribute.value?.type === 'JSXExpressionContainer'
      )
        expression = source.code(attribute.value.expression);
    }
  });
  if (!expression) throw new Error(`Missing diagram toolbar callback: ${marker}`);
  return runInNewContext(transpile(`(${expression})`), globals) as () => void;
}

test('the close and copy glyphs still invoke their distinct host actions', () => {
  const calls: string[] = [];
  const props = {
    onClose: () => calls.push('close'),
    onCopySource: () => calls.push('copy-source'),
  };
  callback('diagram-close', { props })();
  callback('props.labels?.copy', { props })();
  expect(calls).toEqual(['close', 'copy-source']);
});

test('fit and actual size still set their real scale and reset both pan coordinates', () => {
  for (const scale of [0.42, 1]) {
    const values: Record<string, number> = {};
    const shared = (name: string) => ({
      set: (value: number) => {
        values[name] = value;
      },
    });
    callback('diagram-fit', {
      scale,
      motionMode: 'system',
      withTiming: (value: number) => value,
      zoom: shared('zoom'),
      savedZoom: shared('savedZoom'),
      x: shared('x'),
      y: shared('y'),
      savedX: shared('savedX'),
      savedY: shared('savedY'),
    })();
    expect(values).toEqual({ zoom: scale, savedZoom: scale, x: 0, y: 0, savedX: 0, savedY: 0 });
  }
});

test('SVG and PNG remain identifiable and invoke their own export formats', () => {
  const kinds: string[] = [];
  const globals = {
    exportDiagram: (kind: string) => {
      kinds.push(kind);
    },
  };
  callback('diagram-svg', globals)();
  callback('diagram-png', globals)();
  expect(kinds).toEqual(['svg', 'png']);
  const source = productionSource(viewerPath).text;
  expect(source).toContain('["100%", 1]');
  expect(source).toContain('exported === "svg" ? "✓" : "SVG"');
  expect(source).toContain('exported === "png" ? "✓" : "PNG"');
});
