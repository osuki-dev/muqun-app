import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { declaration, productionSource, walk } from '@/test-support/production-source';
import {
  capMarkdown,
  inlineMarkdown,
  MARKDOWN_CHUNK_CHARS,
  MARKDOWN_NATIVE_CEILING,
} from '@/lib/markdown-cap';
import { splitBlockImages, rewriteMessageImages, messageImageResolver } from '@/lib/message-images';
import { normalizeAssistantMarkdown } from '@/lib/assistant-markdown';
import { buildTimelineEntries } from '@/lib/agent-reasoning';
import { groupRoutineToolEntries } from '@/lib/agent-tool-groups';

type Element = { type: unknown; key: string | null; props: Record<string, any> };
const require = createRequire(import.meta.url);
function render(path: string, name: string, props: object): Element {
  const source = productionSource(path);
  const expressions = new Map<string, string>();
  walk(source.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.init &&
      [name, 'PROGRESSIVE_STREAMING', 'STANDALONE_PART_TYPES'].includes(node.id.name)
    )
      expressions.set(node.id.name, source.code(node.init));
  });
  const code =
    [...expressions].map(([key, value]) => `const ${key} = ${value};`).join('\n') +
    (name === 'MessageTextPart'
      ? declaration(path, 'splitDiffFences') + declaration(path, 'groupBlockImages')
      : '') +
    (name === 'AgentAssistantMessage'
      ? declaration(path, 'renderTimelinePart') + declaration(path, 'previousItemAt')
      : '') +
    `\nexports.render = ${name};`;
  const exports: { render?: (props: object) => Element } = {};
  runInNewContext(
    require('@babel/core').transformSync(code, {
      filename: 'streaming-render.tsx',
      babelrc: false,
      configFile: false,
      presets: ['@react-native/babel-preset'],
    }).code,
    {
      exports,
      require,
      styles: {},
      memo: (value: unknown) => value,
      useMemo: (fn: () => unknown) => fn(),
      useState: (value: unknown) => [value, () => {}],
      useLingui: () => ({ t: (parts: string[]) => parts.join('') }),
      useThemeTokens: () => ({ colors: { primary: '#abcdef', text: '#123456' } }),
      useToast: () => ({ showToast: () => {} }),
      useMonoFontFamily: () => 'FixtureMono',
      useMessageImages: () => ({ uris: new Map(), pending: new Set() }),
      capMarkdown,
      inlineMarkdown,
      MARKDOWN_CHUNK_CHARS,
      MARKDOWN_NATIVE_CEILING,
      splitBlockImages,
      rewriteMessageImages,
      messageImageResolver,
      normalizeAssistantMarkdown,
      buildTimelineEntries,
      groupRoutineToolEntries,
      useTranscriptPlate: () => ({}),
      usePaneChatMarkdownStyle: () => ({}),
      splitDiagramMarkdown: () => [],
      splitAudioMarkdown: () => [],
      StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
      AGENT_TYPE: { mono: { size: 14, lineHeight: 20 }, micro: { size: 12 } },
      Fragment: require('react').Fragment,
      View: 'View',
      DiagramMarkdown: 'NativeMarkdown',
      BoundedMarkdown: 'BoundedMarkdown',
      InlinePatch: 'InlinePatch',
      MessageTextPart: 'MessageTextPart',
      ToolPartCard: 'ToolPartCard',
    }
  );
  return exports.render!(props);
}
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}

test('live Markdown enables native progressive row measurement and appended-only fade, while history remains plain', () => {
  const props = { markdown: '| Item | Value |\n| --- | --- |\n| CPU | still', markdownStyle: {} };
  const live = nodes(
    render('src/components/bounded-markdown.tsx', 'BoundedMarkdown', { ...props, streaming: true })
  );
  const native = live.find((node) => node.type === 'NativeMarkdown')!;
  expect(native.props.markdown).toBe(props.markdown);
  expect(native.props.streamingAnimation).toBe(true);
  expect(native.props.streamingConfig).toEqual({
    tableMode: 'progressive',
    codeBlockMode: 'progressive',
  });
  const history = nodes(render('src/components/bounded-markdown.tsx', 'BoundedMarkdown', props));
  expect(history.find((node) => node.type === 'NativeMarkdown')!.props.streamingAnimation).toBe(
    false
  );
});

test('a multi-part assistant message animates only the exact live text, never earlier settled text', () => {
  const text = (id: string) => ({ id, role: 'assistant', part: { type: 'text', text: id } });
  const group = {
    key: 'group',
    role: 'assistant',
    items: [
      text('settled'),
      {
        id: 'tool',
        role: 'assistant',
        part: {
          type: 'tool',
          id: 'call',
          name: 'read',
          state: 'completed',
          input: {},
          output: '',
          content: [],
          metadata: {},
        },
      },
      text('live'),
    ],
  };
  const output = nodes(
    render('src/components/agent-message-block.tsx', 'AgentAssistantMessage', {
      group,
      showReasoning: false,
      streamingItemId: 'live',
      actions: {},
    })
  );
  const parts = output.filter((node) => node.type === 'MessageTextPart');
  expect(parts.map((node) => [node.props.text, node.props.streaming])).toEqual([
    ['settled', false],
    ['live', true],
  ]);
});

test('closing a streamed diff fence preserves the parent and native identity of preceding Markdown', () => {
  const props = { role: 'assistant', markdownStyle: {}, streaming: true };
  const prefix = 'A response already being read.\n\n';
  const before = render('src/components/agent-message-block.tsx', 'MessageTextPart', {
    ...props,
    text: `${prefix}\`\`\`diff\n+added\n`,
  });
  const after = render('src/components/agent-message-block.tsx', 'MessageTextPart', {
    ...props,
    text: `${prefix}\`\`\`diff\n+added\n\`\`\`\n\nMore text`,
  });
  expect(before.type).toBe(after.type);
  const first = nodes(before).find((node) => node.type === 'BoundedMarkdown')!;
  const second = nodes(after).find((node) => node.type === 'BoundedMarkdown')!;
  expect(first.key).toBe(second.key);
  expect(second.props.markdown).toBe(prefix);
  expect(second.props.streaming).toBe(true);
  expect(nodes(after).filter((node) => node.type === 'InlinePatch')).toHaveLength(1);
});
