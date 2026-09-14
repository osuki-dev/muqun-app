import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import { surfaceBackgroundFill } from '../surface-background';

/**
 * Every frame that draws a `presentation: 'formSheet'` route in
 * `src/app/_layout.tsx`, and therefore every frame that has to paint its own
 * ground: the route is transparent so the native sheet keeps its corners.
 *
 * Ten routes, eight frames -- `settings-theme`, `settings-language` and
 * `sessions` all wear `SettingsSheet`. A route added to `_layout.tsx` with
 * `presentation: 'formSheet'` belongs in this list, and the assertions below
 * are what stop it being drawn some other way.
 */
const SHEET_FRAMES = [
  // Theme, Language, and Machines and sessions all wear this one.
  'src/components/settings-sheet.tsx',
  'src/components/theme-browse-sheet.tsx',
  'src/app/commands.tsx',
  'src/components/session-map.tsx',
  'src/components/session-artifacts.tsx',
  'src/components/git-diff-view.tsx',
  'src/components/new-task-sheet.tsx',
  'src/components/open-web-service-sheet.tsx',
];

test('the sheet ground paints its wallpaper above its tint, never under it', () => {
  const text = readFileSync('src/components/sheet-ground.tsx', 'utf8');
  const floor = text.indexOf('backgroundColor: theme.colors.background');
  const tint = text.indexOf('backgroundColor: surfaceBackground(');
  const artwork = text.indexOf('<ThemeArtwork slot="shell.background" />');
  expect(floor).toBeGreaterThan(-1);
  expect(tint).toBeGreaterThan(floor);
  expect(artwork).toBeGreaterThan(tint);

  // Why the order is the contract rather than a preference. The tint is opaque
  // at the default alpha, so a picture painted before it is a picture nobody
  // sees -- which is exactly what every sheet did until this component existed.
  expect(surfaceBackgroundFill('#1a1b26', 1)).toBe('#1a1b26');
  expect(surfaceBackgroundFill('#1a1b26', 0.6)).toBe('rgba(26, 27, 38, 0.6)');

  // Decoration, so it takes no touches and no accessibility nodes.
  expect(text).toContain('pointerEvents="none"');
  expect(text).toContain('importantForAccessibility="no-hide-descendants"');
  // The picture's own alpha, not a contrast clamp: `safeArtworkOpacity` answers
  // ~0 for real palettes, so a sheet that used it would draw nothing at all.
  // Readability is `useSheetGroundPlate`'s job instead.
  // Named in this file's docblock, which explains why; never rendered.
  expect(text).not.toContain('<ThemedSurfaceArtwork');
});

test('every form sheet is built in the one shared frame', () => {
  for (const file of SHEET_FRAMES) {
    const text = readFileSync(file, 'utf8');
    // `SheetFrame`, not a `SheetGround` mounted by hand: one frame is what
    // makes the ground a single place to change rather than eight.
    expect(text).toContain('<SheetFrame');
    expect(text).not.toContain('<SheetGround');
    // And none of them paints a second surface of its own over it. The scroll
    // root keeps an opaque floor or nothing; the tint belongs to the ground.
    expect(text).not.toContain('styles.sheet, { backgroundColor: surfaceBackground(');
  }
  // The frame is the only thing that mounts the ground.
  const ground = readFileSync('src/components/sheet-ground.tsx', 'utf8');
  expect(ground).toContain('<SheetGround testID={testID} tint={tint} />');
});

test('the settings sheet keeps the native scroll root a form sheet needs', () => {
  const text = readFileSync('src/components/settings-sheet.tsx', 'utf8');
  const source = ts.createSourceFile(
    'sheet.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  function unwrap(expression: ts.Expression): ts.Expression {
    return ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
  }
  const component = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'SettingsSheet'
  );
  if (!component?.body) throw new Error('SettingsSheet must remain an inspectable component');
  const parameter = component.parameters[0].name;
  if (!ts.isObjectBindingPattern(parameter)) throw new Error('Expected named frame options');
  const fullScreen = parameter.elements.find(
    (element) => element.name.getText(source) === 'fullScreen'
  );
  expect(fullScreen?.initializer?.kind).toBe(ts.SyntaxKind.FalseKeyword);

  const declarations = component.body.statements.flatMap((statement) =>
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []
  );
  const content = declarations.find(
    (declaration) => declaration.name.getText(source) === 'content'
  );
  if (!content?.initializer) throw new Error('Expected the shared scroll content');
  const root = unwrap(content.initializer);
  if (!ts.isJsxElement(root)) throw new Error('Shared content must have one JSX root');
  const returns = component.body.statements.filter(ts.isReturnStatement);
  expect(returns.length).toBe(1);
  if (!returns[0].expression) throw new Error('Frame must return content');
  const branches = unwrap(returns[0].expression);
  if (!ts.isConditionalExpression(branches))
    throw new Error('Expected explicit presentation branches');
  expect(branches.condition.getText(source)).toBe('fullScreen');
  // The default native form sheet receives the scroll view itself, with no
  // SafeAreaView or sibling introduced above its required native root.
  expect(unwrap(branches.whenFalse).getText(source)).toBe('content');
  const fullScreenRoot = unwrap(branches.whenTrue);
  if (!ts.isJsxElement(fullScreenRoot)) throw new Error('Full-screen frame must have one root');
  expect(fullScreenRoot.openingElement.tagName.getText(source)).toBe('SafeAreaView');
  const renderedChildren = fullScreenRoot.children.filter(
    (child) => !ts.isJsxText(child) || child.text.trim().length > 0
  );
  expect(renderedChildren.length).toBe(1);
  const child = renderedChildren[0];
  if (!ts.isJsxExpression(child))
    throw new Error('Only shared content belongs inside the safe viewport');
  expect(child.expression?.getText(source)).toBe('content');
  const edges = fullScreenRoot.openingElement.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'edges'
  );
  if (
    !edges ||
    !ts.isJsxAttribute(edges) ||
    !edges.initializer ||
    !ts.isJsxExpression(edges.initializer) ||
    !edges.initializer.expression
  )
    throw new Error('Full-screen viewport must inset both system edges');
  const edgeValues = unwrap(edges.initializer.expression);
  if (!ts.isArrayLiteralExpression(edgeValues))
    throw new Error('Expected explicit safe-area edges');
  expect(edgeValues.elements.map((edge) => (ts.isStringLiteral(edge) ? edge.text : null))).toEqual([
    'top',
    'bottom',
  ]);
  expect(root.openingElement.tagName.getText(source)).toBe('ScrollScreen');
  const safeArea = root.openingElement.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'safeArea'
  );
  if (
    !safeArea ||
    !ts.isJsxAttribute(safeArea) ||
    !safeArea.initializer ||
    !ts.isJsxExpression(safeArea.initializer) ||
    !safeArea.initializer.expression
  )
    throw new Error('Scroll safe-area policy must be explicit');
  const scrollInsets = unwrap(safeArea.initializer.expression);
  if (!ts.isConditionalExpression(scrollInsets))
    throw new Error('Scroll insets depend on presentation');
  expect(scrollInsets.condition.getText(source)).toBe('fullScreen');
  expect(ts.isStringLiteral(scrollInsets.whenTrue) ? scrollInsets.whenTrue.text : null).toBe(
    'none'
  );
  expect(ts.isStringLiteral(scrollInsets.whenFalse) ? scrollInsets.whenFalse.text : null).toBe(
    'bottom'
  );
  // Opaque, and not the slider's business: a sheet is a new scene rather than a
  // window onto the route it was opened from.
  expect(root.openingElement.getText(source)).toContain('backgroundColor: theme.colors.background');
  expect(root.openingElement.getText(source)).not.toContain('surfaceBackground(');
  // The flow that opens this sheet anchors on the scene node, so it keeps the
  // id it has always had.
  expect(text).toContain('<SheetFrame testID="settings-sheet-scene">');
  // The content container carries no padding, which is what lets the ground's
  // `absoluteFill` reach the sheet's own edges instead of stopping at the
  // form's gutter. The padding lives on the column inside it.
  expect(text).toContain('contentContainerStyle={styles.canvas}');
  expect(text).toContain("canvas: { flexGrow: 1, width: '100%' }");
  expect(text).toContain('style={[styles.content, { maxWidth: contentMaxWidth }]}');
  expect(text).not.toContain('opacity:');
});

test('text drawn straight onto a sheet ground takes the plate the shell gives it', () => {
  const ground = readFileSync('src/components/sheet-ground.tsx', 'utf8');
  // The plate is only there when there is a picture to be protected from.
  expect(ground).toContain("useHasThemeArtwork('shell.background')");

  // One plate, and this is the file that decides what it is. `SettingsSection`
  // used to mix its own from `colors.background`, which is right on the
  // settings page and a visibly different grey on a `surface`-tinted sheet --
  // two mechanisms plating the same labels. The settings label now asks here.
  const chrome = readFileSync('src/components/settings-chrome.tsx', 'utf8');
  expect(chrome).toContain("import { useSheetGroundPlate } from '@/components/sheet-ground'");
  expect(chrome).toContain('const plate = useSheetGroundPlate();');
  expect(chrome).not.toContain("useHasThemeArtwork('shell.background')");

  // And the geometry is the settings page's, which is the one that was already
  // shipping: `LADDER.gap` across, `LADDER.tight` down, radius 8.
  expect(ground).toContain('export const SHEET_GROUND_PLATE_RADIUS = 8;');
  expect(ground).toContain('export const SHEET_GROUND_PLATE_PADDING_HORIZONTAL = 8;');
  expect(ground).toContain('export const SHEET_GROUND_PLATE_PADDING_VERTICAL = 4;');

  // The tint is the ground's, taken from the frame rather than defaulted to
  // `surface` wherever the hook happens to be called.
  expect(ground).toContain('createContext<SheetGroundTint>');
  expect(ground).toContain('<SheetGroundTintContext.Provider value={tint ?? ');
  expect(ground).toContain('sheetGroundTintColor(theme.colors, tint ?? ground)');

  // Every sheet has at least one label with nothing under it: a header, a
  // section eyebrow, or a day heading. It takes the plate directly, or it is a
  // `SectionLabel`, which takes the same plate from the same frame.
  for (const file of SHEET_FRAMES) {
    const text = readFileSync(file, 'utf8');
    const direct = text.includes('useSheetGroundPlate(') && text.includes(', plate]');
    const viaLabel = text.includes('<SectionLabel');
    expect({ file, plated: direct || viaLabel }).toEqual({ file, plated: true });
  }
});
