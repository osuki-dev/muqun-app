import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('settings sheet owns an opaque scene floor while its wallpaper tint stays adjustable', () => {
  const text = readFileSync('src/components/settings-sheet.tsx', 'utf8');
  const source = ts.createSourceFile(
    'sheet.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const returns: ts.JsxElement[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      ts.isParenthesizedExpression(node.expression) &&
      ts.isJsxElement(node.expression.expression)
    )
      returns.push(node.expression.expression);
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(returns.length).toBe(1);
  const root = returns[0];
  expect(root.openingElement.tagName.getText(source)).toBe('ScrollScreen');
  expect(root.openingElement.getText(source)).toContain('backgroundColor: theme.colors.background');
  expect(root.openingElement.getText(source)).not.toContain('surfaceBackground(');
  expect(text).toContain('<ThemeArtwork slot="shell.background" />');
  expect(text).toContain('backgroundColor: surfaceBackground(theme.colors.surface)');
  expect(text).toContain('pointerEvents="none"');
  expect(text).toContain('importantForAccessibility="no-hide-descendants"');
  expect(text).toContain('contentContainerStyle={styles.canvas}');
  expect(text).toContain('style={[styles.content, { maxWidth: contentMaxWidth }]}');
  expect(text).not.toContain('opacity:');
});
