import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import { productionSource, transpile, walk } from '../../test-support/production-source';

test('the actual pill pressable uses a 45dp minimum without changing adjacent spacing', () => {
  const source = productionSource('src/components/agent-compaction-pill.tsx');
  let initializer = '';
  let pillStyle = '';
  walk(source.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === 'styles' &&
      node.init
    ) {
      initializer = source.code(node.init);
    }
    if (
      node.type !== 'JSXOpeningElement' ||
      node.name.type !== 'JSXIdentifier' ||
      node.name.name !== 'PressableScale'
    )
      return;
    const target = node.attributes.some(
      (attribute) =>
        attribute.type === 'JSXAttribute' &&
        attribute.name.type === 'JSXIdentifier' &&
        attribute.name.name === 'testID' &&
        attribute.value?.type === 'Literal' &&
        attribute.value.value === 'agent-composer-compaction-pill'
    );
    if (!target) return;
    for (const attribute of node.attributes) {
      if (
        attribute.type === 'JSXAttribute' &&
        attribute.name.type === 'JSXIdentifier' &&
        attribute.name.name === 'style' &&
        attribute.value?.type === 'JSXExpressionContainer'
      )
        pillStyle = source.code(attribute.value.expression);
    }
  });
  expect(pillStyle).toBe('styles.pill');
  const styles = runInNewContext(transpile(`(${initializer});`), {
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 / 2.625 },
  }) as Record<string, Record<string, unknown>>;
  expect(styles.pill).toEqual({
    minHeight: 45,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
  });
  expect(styles.action.minHeight).toBe(44);
  expect(styles.copy.minHeight).toBe(44);
  expect(styles.wrap.marginBottom).toBe(6);
  // Source/style contract only: native hit bounds still require device measurement.
});
