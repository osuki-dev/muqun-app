import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { productionSource, walk } from '../../test-support/production-source';
import { plainFromMarkdown } from '../../lib/markdown-text';
import { isFormFieldVisible, validateFormField } from '../../lib/agent-protocol';
import { settleAfter } from '../../lib/compiler-safe-control-flow';

type Element = { type: string | ((props: object) => unknown); props: Record<string, any> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [
    node,
    ...nodes(typeof node.type === 'function' ? node.type(node.props) : node.props.children),
  ];
}

/** Run both actual renderers, isolating only the native boundaries. */
function renderer(file: string, component: string) {
  const source = productionSource(file);
  const expressions = new Map<string, string>();
  walk(source.program, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
      if (node.id.name === component || node.id.name === 'styles')
        expressions.set(node.id.name, source.code(node.init));
    }
  });
  const require = createRequire(import.meta.url);
  const code = require('@babel/core').transformSync(
    `const styles = ${expressions.get('styles')}; exports.render = ${expressions.get(component)};`,
    {
      filename: 'question-render.tsx',
      babelrc: false,
      configFile: false,
      presets: ['@react-native/babel-preset'],
    }
  ).code;
  const exports: { render?: (props: object) => unknown } = {};
  const state: unknown[] = [];
  let cursor = 0;
  const colors = {
    text: '#ffffff',
    textSubtle: '#aaaaaa',
    primary: '#ffaa88',
    border: '#777777',
    surface: '#111111',
    surfaceRaised: '#222222',
  };
  runInNewContext(code, {
    exports,
    require,
    memo: (fn: unknown) => fn,
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [
        state[index],
        (update: unknown) => {
          state[index] = typeof update === 'function' ? update(state[index]) : update;
        },
      ];
    },
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    useLingui: () => ({ t: (parts: string[]) => parts.join('') }),
    useThemeTokens: () => ({ colors, fonts: {}, typeStyles: { body: {} } }),
    useAppearanceProfile: () => ({ chrome: { control: 12, card: 12 } }),
    usePaneChatColors: () => ({ accent: colors.primary, border: colors.border }),
    useCompactMarkdownStyle: () => ({}),
    useSurfaceBackground: () => (value: unknown) => value,
    resolveFontStyle: () => ({}),
    withAlpha: (color: string) => color,
    plainFromMarkdown,
    isFormFieldVisible,
    validateFormField,
    settleAfter,
    AGENT_TYPE: { micro: { size: 12 }, meta: { size: 14 } },
    QUESTION_MAX: 16,
    QUESTION_OPTION_MAX: 16,
    ...Object.fromEntries(
      [
        'View',
        'Text',
        'Check',
        'BoundedMarkdown',
        'PressableScale',
        'FormInput',
        'Send',
        'Trans',
        'Plural',
        'FontedTextInput',
      ].map((name) => [name, name])
    ),
  });
  if (!exports.render) throw new Error('Missing renderer');
  const render = exports.render;
  return (props: object) => {
    cursor = 0;
    return render(props);
  };
}

const label = 'A long option title that needs multiple lines on a narrow phone';
const description =
  'The full explanation belongs below the title and must wrap naturally instead of being truncated at the right edge.';

test('only advertised custom answers have an input, sharing validated values with option selection', async () => {
  for (const custom of [undefined, false, true]) {
    const render = renderer('src/components/agent-form-card.tsx', 'AgentFormCard');
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    const props = {
      request: {
        title: 'Question',
        fields: [
          {
            key: 'answer',
            title: '',
            type: 'string',
            when: [],
            options: [{ value: 'selected', label, description }],
            default: 'selected',
            custom,
            min_length: 5,
          },
        ],
      },
      onSubmit: async (answers: unknown) => {
        replies.push(answers);
      },
      onDraftChange: (...args: unknown[]) => edits.push(args),
    };
    let tree = nodes(render(props));
    let input = tree.find((node) => node.type === 'FontedTextInput');
    expect(Boolean(input)).toBe(custom === true);
    if (!input) continue;
    expect(input.props.value).toBe('');
    input.props.onChangeText('new');
    tree = nodes(render(props));
    const submit = () =>
      tree
        .find((node) => node.type === 'PressableScale' && !node.props.accessibilityRole)
        ?.props.onPress();
    await submit();
    expect(replies).toEqual([]);
    input = tree.find((node) => node.type === 'FontedTextInput');
    input?.props.onChangeText('My custom answer');
    tree = nodes(render(props));
    expect(
      tree.find((node) => node.props.accessibilityRole === 'radio')?.props.accessibilityState
    ).toEqual({ selected: false });
    await submit();
    expect(replies).toEqual([{ answer: 'My custom answer' }]);
    tree.find((node) => node.props.accessibilityRole === 'radio')?.props.onPress();
    tree = nodes(render(props));
    expect(tree.find((node) => node.type === 'FontedTextInput')?.props.value).toBe('');
    await submit();
    expect(replies).toEqual([{ answer: 'My custom answer' }, { answer: 'selected' }]);
    expect(edits).toEqual([
      ['answer', 'new'],
      ['answer', 'My custom answer'],
      ['answer', 'selected'],
    ]);
  }
});
