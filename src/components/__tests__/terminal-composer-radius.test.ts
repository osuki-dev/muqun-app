import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { productionSource, transpile, walk } from '@/test-support/production-source';

const composer = productionSource('src/components/terminal-composer.tsx');
let radiusExpression = '';
walk(composer.program, (node) => {
  if (
    node.type === 'VariableDeclarator' &&
    node.id.type === 'Identifier' &&
    node.id.name === 'fieldRadius' &&
    node.init
  )
    radiusExpression = composer.code(node.init);
});

function corners(props: Record<string, unknown>) {
  return runInNewContext(transpile(`(${radiusExpression})`), {
    profile: { chrome: { composerField: 13 } },
    squareBottom: false,
    nested: false,
    ...props,
  });
}

for (const file of ['agent-composer', 'ssh-terminal-workspace', 'server-terminal-workspace']) {
  test(`${file} preserves the themed field radius`, () => {
    const caller = productionSource(`src/components/${file}.tsx`);
    const props: Record<string, unknown> = {};
    let found = false;
    walk(caller.program, (node) => {
      if (
        node.type !== 'JSXOpeningElement' ||
        node.name.type !== 'JSXIdentifier' ||
        node.name.name !== 'TerminalComposer'
      )
        return;
      found = true;
      for (const attribute of node.attributes) {
        if (
          attribute.type !== 'JSXAttribute' ||
          attribute.name.type !== 'JSXIdentifier' ||
          !['nested', 'squareBottom'].includes(attribute.name.name)
        )
          continue;
        props[attribute.name.name] =
          attribute.value?.type === 'JSXExpressionContainer'
            ? runInNewContext(transpile(`(${caller.code(attribute.value.expression)})`), {
                flushField: false,
              })
            : true;
      }
    });
    expect(found).toBe(true);
    const style = corners(props);
    for (const corner of ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'])
      expect(style[`border${corner}Radius`] ?? style.borderRadius).toBe(13);
  });
}

test('explicit square-bottom keeps themed top corners', () => {
  const style = corners({ squareBottom: true });
  expect(style.borderTopLeftRadius).toBe(13);
  expect(style.borderTopRightRadius).toBe(13);
  expect(style.borderBottomLeftRadius).toBe(0);
  expect(style.borderBottomRightRadius).toBe(0);
});
