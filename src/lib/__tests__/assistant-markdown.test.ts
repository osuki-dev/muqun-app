import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseMarkdown } from '../../../node_modules/react-native-enriched-markdown/src/web/parseMarkdown';
import { normalizeAssistantMarkdown } from '../assistant-markdown';

type Node = { type: string; content?: string; children?: Node[] };
function nodesOfType(node: Node, type: string): Node[] {
  return [
    ...(node.type === type ? [node] : []),
    ...(node.children?.flatMap((child) => nodesOfType(child, type)) ?? []),
  ];
}

describe('assistant Chinese strong display tolerance', () => {
  test('the paired session fixture renders all nine intended strong spans', async () => {
    const source = readFileSync(
      new URL('./fixtures/chinese-assistant-response.md', import.meta.url),
      'utf8'
    );
    const display = normalizeAssistantMarkdown(source);
    expect(nodesOfType(await parseMarkdown(source), 'Strong')).toHaveLength(3);
    const ast = await parseMarkdown(display);
    expect(nodesOfType(ast, 'Strong')).toHaveLength(9);
    expect(nodesOfType(ast, 'Text').some((node) => node.content?.includes('**'))).toBe(false);
    expect(display.replaceAll('**', '')).toBe(source.replaceAll('**', ''));
  });
  test('the actual renderer parses the photographed list item as strong, with no added space', async () => {
    const source =
      '- **固定方向，不勒枝。**如果有绑扎，留一点松量；新枝长出来后，往左右引导，别都挤到中间。';
    const display = normalizeAssistantMarkdown(source);
    expect(display).toBe(source.replace('枝。**', '枝**。'));
    expect(nodesOfType(await parseMarkdown(source), 'Strong')).toHaveLength(0);
    const ast = await parseMarkdown(display);
    expect(nodesOfType(ast, 'Strong')).toEqual([
      { type: 'Strong', children: [{ type: 'Text', content: '固定方向，不勒枝' }] },
    ]);
    expect(
      nodesOfType(ast, 'Text')
        .map((node) => node.content)
        .join('')
    ).toBe(source.slice(2).replaceAll('**', ''));
    // The caller retains this original value for copying/exporting.
    expect(source).toContain('枝。**如果');
  });

  test('multiple broken spans and already valid emphasis coexist in one answer', async () => {
    const source =
      '对，**先整理骨架，这个节奏很好。**照片清爽了。\n\n' +
      '**现在先别继续追着剪。**接下来注意：\n\n' +
      '- **尽量有足够直射光。**隔着纱窗会削弱光照。\n\n' +
      '不能仅凭这张图判断是**缺肥还是水分问题**，先观察。';
    const display = normalizeAssistantMarkdown(source);
    const ast = await parseMarkdown(display);
    expect(nodesOfType(ast, 'Strong')).toHaveLength(4);
    expect(nodesOfType(ast, 'Text').some((node) => node.content?.includes('**'))).toBe(false);
    expect(display).toContain('**缺肥还是水分问题**，');
    expect(normalizeAssistantMarkdown(display)).toBe(display);
  });

  test.each([
    '**甲**和**乙**；**丙**。',
    '**甲。** **乙。** **丙。**',
    '**甲**，**乙。** 中文',
    '**甲**说明。**乙**更多。**丙**末尾',
    '**甲 *斜体* 乙**和**丙**',
    '***甲***和**乙**以及***丙***',
  ])('keeps adjacent valid strong delimiters and their AST unchanged: %s', async (source) => {
    const original = await parseMarkdown(source);
    expect(nodesOfType(original, 'Strong').length).toBeGreaterThanOrEqual(2);
    const display = normalizeAssistantMarkdown(source);
    expect(display).toBe(source);
    expect(await parseMarkdown(display)).toEqual(original);
  });

  test.each([
    'x <code>**固定。**后文</code>',
    'x <code>\n**固定。**后文\n</code>',
    'x <pre>\n\n**固定。**后文\n\n</pre>',
    'x <span title="**固定。**后文">**固定。**后文</span>',
    'x <!-- **固定。**后文 -->',
    'x <code\n**固定。**后文',
  ])('does not reinterpret inline or multiline HTML content: %s', async (source) => {
    const display = normalizeAssistantMarkdown(source);
    expect(display).toBe(source);
    expect(await parseMarkdown(display)).toEqual(await parseMarkdown(source));
  });

  test.each([
    '**正常加粗**中文',
    '**标点。** 中文',
    '**标点。**\n中文',
    '**标点。**',
    '**English.**words',
    '***重要。***后续',
    '**“引号内容。”**后续',
    '**空白 。**后续',
    '**未闭合。',
    '**未闭合。*后续',
    '**跨行\n内容。**后续',
  ])('leaves valid, incomplete or ambiguous syntax unchanged: %s', (source) => {
    expect(normalizeAssistantMarkdown(source)).toBe(source);
  });

  const malformed = '**重点。**后续';
  test.each([
    `\`${malformed}\``,
    `\`\`${malformed}\`\``,
    `\`multi\n${malformed}\nline\``,
    `\`unfinished\n${malformed}`,
    `\`\`\`md\n${malformed}\n\`\`\``,
    `~~~~md\n${malformed}\n~~~~`,
    `> \`\`\`\n> ${malformed}\n> \`\`\``,
    `- ~~~md\n  ${malformed}\n  ~~~`,
    `    ${malformed}`,
    `\t${malformed}`,
    String.raw`\**重点。**后续`,
    String.raw`**重点。\**后续`,
    `[${malformed}](https://example.com)`,
    `[link](https://example.com/${malformed})`,
    `[link](https://example.com/(nested) "title ${malformed}")`,
    `![${malformed}](image.png)`,
    `[label][${malformed}]`,
    `[link](\nhttps://example.com/${malformed}\n)`,
    `[id]: https://example.com/${malformed}`,
    `<https://example.com/${malformed}>`,
    `https://example.com/${malformed}`,
    `www.example.com/${malformed}`,
    `<div>\n${malformed}\n</div>`,
    `$${malformed}$`,
    `$$\n${malformed}\n$$`,
  ])('preserves literal/code/link content: %s', (source) => {
    expect(normalizeAssistantMarkdown(source)).toBe(source);
  });

  test('resumes prose after protected constructs without changing their contents', async () => {
    const source = `\`literal ${malformed}\` and [link](url) ${malformed}\n\n\`\`\`\n${malformed}\n\`\`\`\n${malformed}`;
    const display = normalizeAssistantMarkdown(source);
    expect(display).toBe(
      `\`literal ${malformed}\` and [link](url) **重点**。后续\n\n\`\`\`\n${malformed}\n\`\`\`\n**重点**。后续`
    );
    expect(nodesOfType(await parseMarkdown(display), 'Strong')).toHaveLength(2);
  });
});
