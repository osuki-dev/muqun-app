import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { panePartsFromResponse, reconcilePaneParts } from '../pane-parts';
import { buildPaneChatItems } from '../pane-chat';

const image = 'data:image/png;base64,iVBORw0KGgo=';
const envelope = (parts: unknown[]) => ({ schema_version: '1.5.0', data: { parts } });
const prompt = (attachments?: unknown, text = '[Image #1] Check the icon') => ({
  type: 'prompt',
  text,
  fallback_text: text,
  attachments,
});

test('terminal prompts preserve displayable attachments without interpreting image labels or host paths', () => {
  const { parts } = panePartsFromResponse(
    envelope([
      prompt([
        image,
        'https://producer.invalid/image',
        '/tmp/clipboard.png',
        'file:///tmp/image.png',
        'data:text/plain;base64,YQ==',
        '[Image #1]',
        42,
      ]),
      prompt(),
      prompt([image], ''),
      prompt(['/tmp/clipboard.png'], ''),
    ])
  );
  expect(parts).toHaveLength(3);
  expect(parts[0]).toMatchObject({ attachments: [image, 'https://producer.invalid/image'] });
  expect('attachments' in parts[1]).toBe(false);
  expect(parts[2]).toMatchObject({ text: '', attachments: [image] });
  expect(buildPaneChatItems(parts, { detail: 'simplified' })).toHaveLength(3);
});

test('image arrival and replacement invalidate only the changed prompt row', () => {
  const before = panePartsFromResponse(
    envelope([prompt(), { type: 'text', markdown: 'Reply', fallback_text: 'Reply' }])
  ).parts;
  const rows = buildPaneChatItems(before, { detail: 'simplified' });
  const withImage = panePartsFromResponse(envelope([prompt([image]), before[1]])).parts;
  const next = buildPaneChatItems(withImage, { detail: 'simplified' }, rows);
  expect(next[0]).not.toBe(rows[0]);
  expect(next[1]).toBe(rows[1]);
  expect(buildPaneChatItems(withImage, { detail: 'simplified' }, next)[0]).toBe(next[0]);
  const longImage = `data:image/png;base64,${'A'.repeat(200)}B${'A'.repeat(200)}`;
  const first = panePartsFromResponse(envelope([prompt([longImage])])).parts;
  const changed = panePartsFromResponse(envelope([prompt([longImage.replace('B', 'C')])])).parts;
  const firstRows = buildPaneChatItems(first, { detail: 'simplified' });
  expect(buildPaneChatItems(changed, { detail: 'simplified' }, firstRows)[0]).not.toBe(
    firstRows[0]
  );
});

test('same image label on adjacent real prompts does not swallow their attachments', () => {
  const parts = panePartsFromResponse(
    envelope([prompt([image]), prompt(['data:image/png;base64,YQ=='])])
  ).parts;
  expect(buildPaneChatItems(parts, { detail: 'simplified' })).toHaveLength(2);
});

test('screen reconciliation keeps image-only prompts and blocks that differ only by attachment', () => {
  const block = (uri: string) => [
    prompt([uri]),
    ...['one', 'two', 'three'].map((text) => ({
      type: 'text',
      markdown: text,
      fallback_text: text,
    })),
  ];
  const parts = panePartsFromResponse(
    envelope([...block(image), ...block('data:image/png;base64,YQ=='), prompt([image], '')])
  ).parts;
  const reconciled = reconcilePaneParts([], 0, parts).parts;
  expect(reconciled.filter((part) => part.type === 'prompt')).toHaveLength(3);
});

type Element = { type: string; props: Record<string, any> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [node, ...nodes(node.props.children)];
}

const require = createRequire(import.meta.url);
/** Execute production host components with child/native boundaries replaced. */
function component(path: string, name: string) {
  const code = require('@babel/core').transformSync(readFileSync(path, 'utf8'), {
    filename: path,
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }).code;
  let cursor = 0;
  const states: unknown[] = [];
  const exports: Record<string, (props: object) => unknown> = {};
  const colors = { text: '#111', textSubtle: '#777', primary: '#248' };
  runInNewContext(code, {
    exports,
    require: (module: string) => {
      if (module === 'react/jsx-runtime' || module.startsWith('@babel/runtime/'))
        return require(module);
      if (module === 'react')
        return {
          memo: (fn: unknown) => fn,
          useMemo: (read: () => unknown) => read(),
          useEffect: () => {},
          useState: (initial: unknown) => {
            const slot = cursor++;
            if (!(slot in states))
              states[slot] = typeof initial === 'function' ? initial() : initial;
            return [
              states[slot],
              (value: unknown) => {
                states[slot] = value;
              },
            ];
          },
        };
      if (module === 'react-native')
        return { View: 'View', StyleSheet: { create: (value: unknown) => value } };
      if (module === '@osuki-dev/ui') return { useThemeTokens: () => ({ colors }) };
      if (module === '@lingui/react/macro')
        return { useLingui: () => ({ t: (parts: string[]) => parts.join('') }) };
      if (module === '@/components/appearance-profile-provider')
        return { useAppearanceProfile: () => ({ chrome: { transcriptPlate: 12, surface: 12 } }) };
      if (module === '@/hooks/use-surface-background')
        return { useSurfaceBackground: () => (value: unknown) => value };
      if (module === '@/components/attachment-image') return { AttachmentImage: 'AttachmentImage' };
      if (module === '@/components/content-image') return { ContentImage: 'ContentImage' };
      if (module === '@/lib/content-image-layout') return require('../content-image-layout');
      if (module === '@/components/image-preview-modal')
        return { ImagePreviewModal: 'ImagePreviewModal' };
      if (module === '@/components/pressable-scale') return { PressableScale: 'PressableScale' };
      if (module === '@/components/text') return { Text: 'Text' };
      if (module === 'expo-image') return { Image: 'Image' };
      if (module === '@/constants/transcript-grid')
        return require('../../constants/transcript-grid');
      return {};
    },
  });
  return (props: object) => {
    cursor = 0;
    return nodes(exports[name](props));
  };
}

test('a recovered image-only prompt renders a thumbnail and opens then closes the shared viewer', () => {
  const { parts } = panePartsFromResponse(envelope([prompt([image], '')]));
  const item = buildPaneChatItems(parts, { detail: 'simplified' })[0];
  if (item.kind !== 'prompt') throw new Error('Expected prompt');
  const render = component('src/components/pane-chat-blocks.tsx', 'PaneChatPromptRow');
  const props = { text: item.text, attachments: item.part.attachments, colors: { bubble: '#abc' } };
  const row = render(props);
  expect(row.some((node) => node.type === 'Text')).toBe(false);
  const thumbnail = row.find((node) => node.type === 'AttachmentImage')!;
  expect(thumbnail.props.uri).toBe(image);
  const renderThumbnail = component('src/components/attachment-image.tsx', 'AttachmentImage');
  const imageNodes = renderThumbnail(thumbnail.props);
  const contentImage = imageNodes.find((node) => node.type === 'ContentImage')!;
  expect(contentImage.props.source).toEqual({
    uri: image,
    cacheKey: image,
  });
  expect(contentImage.props.previewable).toBe(true);
  imageNodes.find((node) => node.type === 'PressableScale')!.props.onPress();
  const viewer = render(props).find((node) => node.type === 'ImagePreviewModal')!;
  expect(viewer.props.images).toEqual([{ id: image, uri: image }]);
  viewer.props.onClose();
  expect(render(props).some((node) => node.type === 'ImagePreviewModal')).toBe(false);
});
