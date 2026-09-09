import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function source(name: string, local: boolean) {
  const path = local
    ? `src/components/themed-${name}.tsx`
    : `node_modules/@osuki-dev/ui/src/components/${name}.tsx`;
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

// Compare syntax rather than whitespace; these checks protect the native event
// and accessibility contract, not a substitute for actual keyboard/device QA.
function fragments(file: ts.SourceFile, select: (node: ts.Node) => boolean) {
  const result: string[] = [];
  const printer = ts.createPrinter({ removeComments: true });
  function visit(node: ts.Node) {
    if (select(node))
      result.push(printer.printNode(ts.EmitHint.Unspecified, node, file).replaceAll('"', "'"));
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}

test('input adapters retain the installed kit public props and native TextInput attributes', () => {
  for (const name of ['input', 'textarea', 'search-input']) {
    const local = source(name, true);
    const kit = source(name, false);
    expect(fragments(local, ts.isInterfaceDeclaration)).toEqual(
      fragments(kit, ts.isInterfaceDeclaration)
    );
    const nativeInput = (node: ts.Node) =>
      ts.isJsxSelfClosingElement(node) && ['TextInput', 'Input'].includes(node.tagName.getText());
    expect(fragments(local, nativeInput)).toEqual(fragments(kit, nativeInput));
  }
});

test('search clear callback ordering, touch target and accessibility remain unchanged', () => {
  const local = source('search-input', true);
  const kit = source('search-input', false);
  const clear = (node: ts.Node) =>
    ts.isVariableDeclaration(node) && node.name.getText() === 'handleClear';
  expect(fragments(local, clear)).toEqual(fragments(kit, clear));
  const pressable = (node: ts.Node) =>
    ts.isJsxOpeningElement(node) && node.tagName.getText() === 'Pressable';
  expect(fragments(local, pressable)).toEqual(fragments(kit, pressable));
});

test('appearance opacity is limited to control/error fills and has reactive memo dependencies', () => {
  for (const name of ['input', 'search-input']) {
    const text = source(name, true).text;
    expect(text).toContain('surfaceBackground(theme.colors[input.background])');
    expect(text).toContain('color: theme.colors[input.foreground]');
    expect(text).not.toContain('opacity:');
    const calls = fragments(
      source(name, true),
      (node) => ts.isCallExpression(node) && node.expression.getText() === 'useMemo'
    );
    const fill = calls.find((call) => call.includes('surfaceBackground('));
    expect(fill).toBeDefined();
    expect(/\[\s*surfaceBackground,/.test(fill ?? '')).toBe(true);
    expect(text).toContain('onFocus?.(');
    expect(text).toContain('onBlur?.(');
    expect(text).toContain('timing(140)');
    expect(text).toContain('timing(160)');
  }
});
