import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type { ReactElement, ReactNode } from 'react';

import { appChrome } from '@/constants/appearance';
import { declaration, productionSource, walk } from '@/test-support/production-source';

const nodeRequire = createRequire(import.meta.url);
const { transformSync } = nodeRequire('@babel/core') as {
  transformSync: (source: string, options: Record<string, unknown>) => { code: string };
};
function execute(source: string, context: Record<string, unknown>) {
  const code = transformSync(source, {
    filename: 'composer-radius.tsx',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }).code;
  return runInNewContext(code, { require: nodeRequire, ...context });
}

type Element = ReactElement<{
  children?: ReactNode;
  style?: unknown;
  testID?: string;
}>;
function elements(value: ReactNode): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function flatten(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return Object.assign({}, ...value.map(flatten));
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

const path = 'src/components/terminal-composer.tsx';
const source = productionSource(path);
let styles = '';
walk(source.program, (node) => {
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
    if (node.id.name === 'composerStyles' && node.init) styles = source.code(node.init);
  }
});

// Execute the actual caller's corner props, without importing its native workspace.
function callerCorners(file: string, flushField = false) {
  const caller = productionSource(`src/components/${file}.tsx`);
  const attributes: string[] = [];
  let count = 0;
  walk(caller.program, (node) => {
    if (
      node.type !== 'JSXOpeningElement' ||
      node.name.type !== 'JSXIdentifier' ||
      node.name.name !== 'TerminalComposer'
    )
      return;
    count++;
    for (const attribute of node.attributes) {
      if (
        attribute.type === 'JSXAttribute' &&
        attribute.name.type === 'JSXIdentifier' &&
        ['nested', 'squareBottom'].includes(attribute.name.name)
      )
        attributes.push(caller.code(attribute));
    }
  });
  expect(count).toBe(1);
  return (
    execute(`<TerminalComposer ${attributes.join(' ')} />`, {
      TerminalComposer: 'TerminalComposer',
      flushField,
    }) as ReactElement<Record<string, unknown>>
  ).props;
}

function render(
  corners: Record<string, unknown>,
  radius: number,
  minLines: number,
  artwork: boolean
) {
  return elements(
    execute(
      `const composerStyles = ${styles}; ${declaration(path, 'TerminalComposer')}; TerminalComposer(props)`,
      {
        props: {
          ...corners,
          minLines,
          inputProps: { value: '' },
          send: { sending: false },
          ...(artwork
            ? {
                fieldBackground: 'artwork',
                fieldBackgroundOutset: { left: 0, right: 0, bottom: 0 },
              }
            : {}),
        },
        COMPOSER_ACTION_SIZE: 44,
        ONE_LINE_FIELD: 44,
        StyleSheet: {
          create: (value: unknown) => value,
          flatten,
          absoluteFill: { position: 'absolute' },
        },
        View: 'View',
        Animated: { View: 'Animated.View' },
        FontedTextInput: 'FontedTextInput',
        ComposerSendButton: 'ComposerSendButton',
        useLatestReader: (value: unknown) => () => value,
        useLingui: () => ({ t: (value: TemplateStringsArray) => value[0] }),
        useVoiceInputTrigger: () => ({ panel: null }),
        useEffect: () => {},
        useRef: (current: unknown) => ({ current }),
        useState: (value: unknown) => [value, () => {}],
        useSharedValue: (value: unknown) => ({ get: () => value }),
        useAnimatedStyle: (callback: () => unknown) => callback(),
        useAppearanceProfile: () => ({ chrome: { composerField: radius } }),
        useSurfaceBackground: () => () => 'surface-fill',
        useThemeTokens: () => ({
          colors: { text: 'ink', placeholder: 'muted', primary: 'accent' },
          components: { Input: { placeholder: 'placeholder' } },
        }),
        useMonoFontFamily: () => 'mono',
        useWindowDimensions: () => ({ fontScale: 1 }),
        appChrome,
        withAlpha: () => 'quiet-fill',
      }
    ) as ReactNode
  );
}

for (const file of ['agent-composer', 'ssh-terminal-workspace', 'server-terminal-workspace']) {
  test(`${file} keeps all field corners and background clipping in collapsed and expanded layouts`, () => {
    const corners = callerCorners(file);
    for (const radius of [appChrome.radius.composerField, 13]) {
      for (const minLines of [1, 3]) {
        for (const artwork of [false, true]) {
          const nodes = render(corners, radius, minLines, artwork);
          const shell = flatten(
            nodes.find((node) => node.props.testID === 'composer-field-shell')?.props.style
          );
          expect(shell.borderRadius).toBe(radius);
          expect(shell.borderBottomLeftRadius).toBeUndefined();
          expect(shell.borderBottomRightRadius).toBeUndefined();
          expect(shell.overflow).toBe('hidden');
          expect(shell.backgroundColor).toBe(artwork ? 'transparent' : 'surface-fill');
          if (artwork) {
            const fill = nodes
              .map((node) => flatten(node.props.style))
              .find((style) => style.backgroundColor === 'surface-fill');
            expect(fill?.borderRadius).toBe(radius);
            expect(fill?.borderCurve).toBe(shell.borderCurve);
          }
          const expanded = nodes.some((node) => node.props.testID === 'composer-expanded-actions');
          expect(expanded).toBe(minLines > 1);
          const content = nodes.find((node) => node.type === 'FontedTextInput');
          expect(flatten(content?.props.style).minHeight).toBe(minLines * 19 + 20);
        }
      }
    }
  });
}

test('Home flush caller remains unchanged and explicit square-bottom still works', () => {
  const flush = render(callerCorners('agent-composer', true), 13, 1, false);
  expect(
    flatten(flush.find((node) => node.props.testID === 'composer-field-shell')?.props.style)
      .borderRadius
  ).toBe(13);
  const square = render({ squareBottom: true }, 13, 1, true);
  const shell = flatten(
    square.find((node) => node.props.testID === 'composer-field-shell')?.props.style
  );
  expect(shell.borderTopLeftRadius).toBe(13);
  expect(shell.borderTopRightRadius).toBe(13);
  expect(shell.borderBottomLeftRadius).toBe(0);
  expect(shell.borderBottomRightRadius).toBe(0);
});
