import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { PAD_SETTINGS_SHEET_WIDTH } from '@/lib/route-presentation';
import { declaration, productionSource } from '@/test-support/production-source';

const source = productionSource('src/components/sheet-route-frame.tsx');
const stylesNode = source.program.body.find(
  (node) => node.type === 'VariableDeclaration' && source.code(node).includes('routeFrameStyles =')
)!;
const nodeRequire = createRequire(import.meta.url);
const { transformSync } = nodeRequire('@babel/core') as {
  transformSync: (source: string, options: Record<string, unknown>) => { code: string };
};
const code = transformSync(
  `${source.code(stylesNode)}\n${declaration('src/components/sheet-route-frame.tsx', 'SheetRouteFrame')}\nSheetRouteFrame(props)`,
  {
    filename: 'sheet-frame.tsx',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }
).code;

type Element = ReactElement<{
  children?: ReactNode;
  style?: unknown;
  testID?: string;
  onPress?: () => void;
  accessible?: boolean;
  importantForAccessibility?: string;
}>;

function render(fitsContent: boolean) {
  let dismissed = 0;
  const child = createElement('scene');
  const element = runInNewContext(code, {
    require: nodeRequire,
    View: 'View',
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: object) => styles },
    PAD_SETTINGS_SHEET_WIDTH,
    useAppearanceProfile: () => ({ chrome: { sheet: 23 } }),
    useRouter: () => ({ back: () => dismissed++ }),
    props: { children: child, detents: fitsContent ? 'fitToContents' : [0.85] },
  }) as Element;
  return { element, child, dismissed: () => dismissed };
}

test('both side gutters dismiss the route; the centered scene is not a press target', () => {
  const result = render(true);
  const [card, left, right] = result.element.props.children as Element[];
  expect(card!.type).toBe('View');
  expect(card!.props.children).toBe(result.child);
  expect(card!.props.onPress).toBeUndefined();
  for (const target of [left!, right!]) {
    expect(target.type).toBe('Pressable');
    expect(target.props.accessible).toBe(false);
    expect(target.props.importantForAccessibility).toBe('no');
    target.props.onPress!();
  }
  expect(result.dismissed()).toBe(2);
  expect(left!.props.testID).toBe('sheet-dismiss-left-gutter');
  expect(right!.props.testID).toBe('sheet-dismiss-right-gutter');
});

test('fit-content height stays intrinsic; fixed detents fill their assigned space', () => {
  for (const fitsContent of [true, false]) {
    const { element } = render(fitsContent);
    const [card, left, right] = element.props.children as Element[];
    const sizing = fitsContent ? undefined : { flex: 1 };
    expect(element.props.style).toEqual(sizing);
    expect(card!.props.style).toEqual([
      { width: '100%', maxWidth: 640, alignSelf: 'center', overflow: 'hidden' },
      sizing,
      { borderTopLeftRadius: 23, borderTopRightRadius: 23 },
    ]);
    // Gutters cover only [0, center - 320] and [center + 320, width].
    // Physical edges keep these intervals correct in both LTR and RTL.
    expect(left!.props.style).toEqual([
      { position: 'absolute', top: 0, bottom: 0 },
      { left: 0, right: '50%', marginRight: 320 },
    ]);
    expect(right!.props.style).toEqual([
      { position: 'absolute', top: 0, bottom: 0 },
      { right: 0, left: '50%', marginLeft: 320 },
    ]);
  }
});
