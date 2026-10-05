import { describe, expect, test } from 'bun:test';

import {
  escapeMarkdownText,
  isHostPathSource,
  messageImageResolver,
  parseMessageImageAssets,
  rewriteMessageImages,
  type ImageResolution,
} from '../message-images';

const GW = 'https://gw.test';
const caption = (alt: string) => `_[no image: ${escapeMarkdownText(alt)}]_`;

/** Resolve from a plain map of src -> URI; everything else follows the transcript rule. */
function rewrite(markdown: string, uris: Record<string, string>, pending: string[] = []) {
  return rewriteMessageImages(
    markdown,
    messageImageResolver(new Map(Object.entries(uris)), new Set(pending)),
    caption
  );
}

describe('parseMessageImageAssets', () => {
  test('keeps well-formed gateway entries and drops anything pointing elsewhere', () => {
    expect(
      parseMessageImageAssets([
        {
          src: './a.png',
          asset_id: 'as_1',
          url: '/api/assets/as_1/content',
          mime: 'image/png',
          width: 640,
          height: 480,
        },
        { src: 'b.png', asset_id: 'as_2', url: 'https://evil.test/steal', mime: 'image/png' },
        { src: '', asset_id: 'as_3', url: '/api/assets/as_3/content' },
        null,
        'nope',
      ])
    ).toEqual([
      {
        src: './a.png',
        asset_id: 'as_1',
        url: '/api/assets/as_1/content',
        mime: 'image/png',
        width: 640,
        height: 480,
      },
    ]);
    expect(parseMessageImageAssets(undefined)).toEqual([]);
  });
});

describe('isHostPathSource', () => {
  test.each<[string, boolean]>([
    ['./shot.png', true],
    ['out/flow.png', true],
    ['/home/ryu/Work/x.png', true],
    ['file:///home/ryu/x.png', true],
    ['FILE:///x.png', true],
    ['图 表/深色 流程.png', true],
    ['https://example.com/a.png', false],
    ['http://example.com/a.png', false],
    ['data:image/png;base64,AAAA', false],
    ['//cdn.example.com/a.png', false],
    ['', false],
  ])('%s -> %p', (src, expected) => {
    expect(isHostPathSource(src)).toBe(expected);
  });
});

describe('rewriteMessageImages', () => {
  test('a relative source the gateway resolved is swapped for its URL', () => {
    expect(rewrite('![shot](./shot.png)', { './shot.png': `${GW}/api/assets/as_1/content` })).toBe(
      `![shot](${GW}/api/assets/as_1/content)`
    );
  });

  test('absolute and file:// sources are swapped the same way', () => {
    const md = '![a](/tmp/mdimg/shot.png)\n![b](file:///tmp/mdimg/shot.png)\n';
    expect(
      rewrite(md, {
        '/tmp/mdimg/shot.png': 'U1',
        'file:///tmp/mdimg/shot.png': 'U2',
      })
    ).toBe('![a](U1)\n![b](U2)\n');
  });

  test('a title survives and only the destination changes', () => {
    expect(rewrite('![a](p.png "the title") after', { 'p.png': 'U' })).toBe(
      '![a](U "the title") after'
    );
    expect(rewrite("![a](p.png 'single')", { 'p.png': 'U' })).toBe("![a](U 'single')");
  });

  test('spaces and CJK in an angle-bracket destination are matched verbatim', () => {
    expect(rewrite('![流程](<图 表/深色 流程.png>)', { '图 表/深色 流程.png': 'U' })).toBe(
      '![流程](<U>)'
    );
  });

  test('a traversal the gateway refused becomes a caption, not an empty box', () => {
    expect(rewrite('before ![secret *x*](../../etc/secret.png) after', {})).toBe(
      'before _[no image: secret \\*x\\*]_ after'
    );
  });

  test('http and data URIs are left exactly as written', () => {
    const md = '![w](https://example.com/a.png) ![d](data:image/png;base64,AAAA)';
    expect(rewrite(md, {})).toBe(md);
  });

  test('a source still being fetched is left as written', () => {
    expect(rewrite('![a](./a.png)', {}, ['./a.png'])).toBe('![a](./a.png)');
  });

  test('code fences and inline code are never touched', () => {
    const md = [
      '```md',
      '![x](./a.png)',
      '```',
      'inline `![x](./a.png)` and ![y](./a.png)',
      '~~~~',
      '![z](./a.png)',
      '~~~~',
    ].join('\n');
    expect(rewrite(md, { './a.png': 'U' })).toBe(
      [
        '```md',
        '![x](./a.png)',
        '```',
        'inline `![x](./a.png)` and ![y](U)',
        '~~~~',
        '![z](./a.png)',
        '~~~~',
      ].join('\n')
    );
  });

  test('<img src> is swapped, and an unservable one becomes a caption', () => {
    expect(
      rewrite('<img alt="flow" src="out/flow.png" width="300">', { 'out/flow.png': 'U' })
    ).toBe('<img alt="flow" src="U" width="300">');
    expect(rewrite("<IMG SRC='/nope.png' alt='gone'>", {})).toBe('_[no image: gone]_');
  });

  test('images inside links and with nested brackets in the alt are found', () => {
    expect(rewrite('[![a [b]](p.png)](https://x.test)', { 'p.png': 'U' })).toBe(
      '[![a [b]](U)](https://x.test)'
    );
    expect(rewrite('![d](dir/(1).png)', { 'dir/(1).png': 'U' })).toBe('![d](U)');
  });

  test('an already rewritten text is unchanged by a second pass', () => {
    const once = rewrite('![a](./a.png)', { './a.png': `${GW}/api/assets/as_1/content` });
    expect(rewrite(once, { './a.png': `${GW}/api/assets/as_1/content` })).toBe(once);
  });

  test('text with no images is returned as the same string', () => {
    const md = 'just prose, [a link](./a.png) and `code`';
    const resolve = (): ImageResolution => ({ kind: 'caption' });
    expect(rewriteMessageImages(md, resolve, caption)).toBe(md);
  });

  test('CRLF line endings are preserved', () => {
    expect(rewrite('![a](x.png)\r\nnext\r\n', { 'x.png': 'U' })).toBe('![a](U)\r\nnext\r\n');
  });
});

describe('parseTimelineItem', () => {
  test('carries image_assets from the wire and keeps the text as written', async () => {
    const { parseTimelineItem } = await import('../agent-protocol');
    const text = '![flow](./out/flow.png "Flow")';
    const item = parseTimelineItem({
      id: 'm1:t0',
      message_id: 'm1',
      role: 'assistant',
      part: { type: 'text', text },
      seq: 1,
      updated_ms: 0,
      image_assets: [
        {
          src: './out/flow.png',
          asset_id: 'as_1',
          url: '/api/assets/as_1/content',
          mime: 'image/png',
        },
      ],
    });
    expect(item?.part).toEqual({ type: 'text', text });
    expect(item?.image_assets?.map((asset) => asset.src)).toEqual(['./out/flow.png']);
    const bare = parseTimelineItem({ id: 'x', part: { type: 'text', text: 'hi' } });
    expect(bare && 'image_assets' in bare).toBe(false);
  });
});
