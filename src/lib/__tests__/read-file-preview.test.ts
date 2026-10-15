import { describe, expect, test } from 'bun:test';

import { assetPresentation } from '@/lib/asset-viewer-layout';
import { fencedFile, fenceLanguageForFile } from '@/lib/code-language';
import {
  canInlineFileText,
  fileTextPresentation,
  INLINE_FILE_MAX_CHARS,
  INLINE_FILE_MAX_LINES,
  readFilePreview,
  toolFileForPath,
} from '@/lib/file-text-preview';
import { MARKDOWN_NATIVE_CEILING, TOOL_BODY_MAX_LINES } from '@/lib/markdown-cap';
import { assetFromToolFile } from '@/lib/session-assets';
import { HIGHLIGHT_MAX_CHARS, indexTextLines } from '@/lib/text-preview';

describe('read file snapshots', () => {
  const markdown =
    '# Sample guide\n\n- First item\n- Second item\n\n```ts\nconst n = 1;\n```\n\n| Key | Value |\n| --- | --- |\n| n | 1 |';

  test.each(['/project/guide.md', '/project/guide.mdx'])(
    '%s uses the Files document classification',
    (path) => {
      const preview = readFilePreview(markdown, path);
      expect(preview.type).toBe('file');
      if (preview.type !== 'file') throw new Error('Expected file snapshot');
      expect(preview.content).toBe(markdown);
      expect(assetPresentation(preview.file, preview.content.length)).toBe('document');
      const openedFromLink = assetFromToolFile(toolFileForPath(path));
      if (!openedFromLink) throw new Error('Expected Files descriptor');
      expect(preview.file).toEqual(openedFromLink);
    }
  );

  test.each(['/project/source.ts', '/project/plain.txt', '/project/unknown.ext'])(
    '%s stays a literal listing, not rendered markdown',
    (path) => {
      const preview = readFilePreview(markdown, path);
      if (preview.type !== 'file') throw new Error('Expected file snapshot');
      expect(assetPresentation(preview.file, preview.content.length)).toBe('code');
      const fence = fencedFile(preview.content, fenceLanguageForFile(preview.file.name));
      expect(fence).toContain(markdown);
      expect(fence.startsWith('````')).toBe(true);
    }
  );

  test('strips the tool header and numbers only in the display copy, retaining document fences', () => {
    const output = `Read file /project/guide.md, lines 1-12\n${markdown
      .split('\n')
      .map((line, index) => `${index + 1}: ${line}`)
      .join('\n')}`;
    const preview = readFilePreview(output, '/project/guide.md');
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(preview.content).toBe(markdown);
    expect(output.startsWith('Read file ')).toBe(true);
    expect(output).toContain('1: # Sample guide');
  });

  test('unwraps a complete file envelope without converting the contents to a fence', () => {
    const output = `<path>/project/guide.md</path>\n<type>file</type>\n<content>\n${markdown
      .split('\n')
      .map((line, index) => `${index + 1}: ${line}`)
      .join('\n')}\n\n(End of file - total 12 lines)\n</content>`;
    const preview = readFilePreview(output, '/project/guide.md');
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(preview.content).toBe(markdown);
  });

  test('does not unwrap tags or a numbered example inside a document', () => {
    const content = '# XML example\n\n<content>keep this</content>\n12: keep this prefix';
    const preview = readFilePreview(content, '/project/guide.md');
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(preview.content).toBe(content);
  });

  test.each([
    '<path>/project</path>\n<type>directory</type>\n<entries>guide.md\nsource.ts</entries>',
    'Read directory /project\nguide.md\nsource.ts',
  ])('a directory listing remains tool output', (output) => {
    expect(readFilePreview(output, '/project')).toEqual({ type: 'output', text: output });
  });

  test('an unavailable path is output, and a declared unknown MIME follows Files binary fallback', () => {
    expect(readFilePreview(markdown, '').type).toBe('output');
    expect(readFilePreview(markdown, 'relative.md').type).toBe('output');
    const file = { uri: '/project/guide.md', mime: 'application/octet-stream' };
    expect(readFilePreview(markdown, file.uri, [file]).type).toBe('output');
    expect(
      assetPresentation(assetFromToolFile(file) ?? { kind: 'binary', previewable: false, size: 0 })
    ).toBe('details');
  });

  test.each(['image/png', 'application/pdf'])(
    '%s stays with the existing attachment renderer, not a second text preview',
    (mime) => {
      const file = { uri: '/project/attachment', name: 'attachment', mime };
      const bytes = 'data:image/png;base64,' + 'aB09+/='.repeat(100);
      expect(readFilePreview(bytes, file.uri, [file])).toEqual({ type: 'empty' });
      expect(readFilePreview('Attachment read successfully.', file.uri, [file])).toEqual({
        type: 'output',
        text: 'Attachment read successfully.',
      });
    }
  );

  test('bare base64 never reaches the markdown renderer', () => {
    expect(readFilePreview('Ab0+/='.repeat(100), '/project/image.png')).toEqual({ type: 'empty' });
  });

  test('malformed file URI escapes remain readable output rather than throwing', () => {
    expect(readFilePreview(markdown, 'file:///project/invalid%ZZ.md')).toEqual({
      type: 'output',
      text: markdown,
    });
  });

  test('large and provider-truncated snapshots retain every available line for the full viewer', () => {
    const content =
      'const sample = 1;\n'.repeat(Math.ceil(HIGHLIGHT_MAX_CHARS / 18) + 10) +
      'last available line\n[Output truncated]';
    const preview = readFilePreview(content, '/project/source.ts');
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(assetPresentation(preview.file, preview.content.length)).toBe('lines');
    expect(preview.content).toBe(content);
    const index = indexTextLines(preview.content);
    expect(index.lines.at(-1)).toBe('[Output truncated]');
    expect(index.lines.at(-2)).toBe('last available line');
    const openedFromLink = assetFromToolFile(toolFileForPath('/project/source.ts'));
    if (!openedFromLink) throw new Error('Expected Files descriptor');
    expect(preview.file).toEqual(openedFromLink);
  });

  test('long lines and raw code fences survive adaptation for horizontal panning and copying', () => {
    const content = 'const value = "' + 'sample '.repeat(500) + '";\n```not markdown```';
    const preview = readFilePreview(content, '/project/source.ts');
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(preview.content).toBe(content);
    expect(indexTextLines(preview.content).longest).toBe(content.split('\n')[0].length);
  });

  test('declared MIME takes precedence over the path fallback, as in Files', () => {
    const attachment = { uri: '/project/example.txt', name: 'example.txt', mime: 'text/markdown' };
    const preview = readFilePreview(markdown, attachment.uri, [attachment]);
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(fileTextPresentation(preview.file, preview.content)).toBe('document');
    const fromFiles = assetFromToolFile(attachment);
    if (!fromFiles) throw new Error('Expected Files descriptor');
    expect(fileTextPresentation(fromFiles, markdown)).toBe('document');
  });

  test.each([
    { uri: '/project/README.md' },
    { uri: 'file:///project/README.md', name: 'Returned name.md' },
  ])('a matching file without MIME inherits the shared path fallback', (attachment) => {
    const content = '# Heading';
    const preview = readFilePreview(content, '/project/README.md', [attachment]);
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(preview.content).toBe(content);
    expect(preview.file.mime).toBe('text/markdown');
    expect(fileTextPresentation(preview.file, content)).toBe('document');
    expect(canInlineFileText(preview.file, content)).toBe(true);
    expect('mime' in attachment).toBe(false);
  });

  test('a matching code file without MIME keeps the literal shared path fallback', () => {
    const preview = readFilePreview('# literal source', '/project/sample.ts', [
      { uri: '/project/sample.ts' },
    ]);
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(preview.file.mime).toBe('text/plain');
    expect(fileTextPresentation(preview.file, preview.content)).toBe('code');
  });

  test.each(['application/octet-stream', 'application/x-custom', 'image/png', 'application/pdf'])(
    'explicit %s never inherits the Markdown path MIME',
    (mime) => {
      const preview = readFilePreview('# Heading', '/project/README.md', [
        { uri: '/project/README.md', mime },
      ]);
      expect(preview).toEqual({ type: 'output', text: '# Heading' });
    }
  );

  test('explicit text/plain on a Markdown path remains literal code', () => {
    const preview = readFilePreview('# Heading', '/project/README.md', [
      { uri: '/project/README.md', mime: 'text/plain' },
    ]);
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(fileTextPresentation(preview.file, preview.content)).toBe('code');
    expect(preview.file.mime).toBe('text/plain');
  });

  test.each([
    ['/project/guide.md', '# Short heading'],
    ['/project/guide.md', '- First item\n- Second item'],
    ['/project/guide.md', '| Key | Value |\n| --- | --- |\n| sample | 1 |'],
    ['/project/guide.md', '```ts\nconst n = 1;\n```'],
    ['/project/sample.ts', 'const n = 1;'],
    ['/project/plain.txt', 'A short literal line.'],
  ])('a complete small %s run is admitted to content-sized rendering', (path, content) => {
    const preview = readFilePreview(content, path);
    if (preview.type !== 'file') throw new Error('Expected file snapshot');
    expect(canInlineFileText(preview.file, preview.content)).toBe(true);
    expect(preview.content).toBe(content);
  });

  test.each(['/project/guide.md', '/project/sample.ts'])(
    'inline %s admission has finite character and line budgets without slicing the snapshot',
    (path) => {
      const file = assetFromToolFile(toolFileForPath(path));
      if (!file) throw new Error('Expected Files descriptor');
      expect(canInlineFileText(file, 'x'.repeat(INLINE_FILE_MAX_CHARS))).toBe(true);
      expect(canInlineFileText(file, 'x'.repeat(INLINE_FILE_MAX_CHARS + 1))).toBe(false);
      expect(
        canInlineFileText(
          file,
          Array.from({ length: INLINE_FILE_MAX_LINES }, () => 'row').join('\n')
        )
      ).toBe(true);
      const content = Array.from({ length: INLINE_FILE_MAX_LINES + 1 }, () => 'available row').join(
        '\n'
      );
      const preview = readFilePreview(content, path);
      if (preview.type !== 'file') throw new Error('Expected file snapshot');
      expect(canInlineFileText(preview.file, preview.content)).toBe(false);
      expect(preview.content).toBe(content);
      expect(indexTextLines(preview.content).lines.at(-1)).toBe('available row');
    }
  );

  test('the full-screen safety policy is unchanged by compact inline admission', () => {
    const file = assetFromToolFile(toolFileForPath('/project/guide.md'));
    if (!file) throw new Error('Expected Files descriptor');
    const content = markdown.repeat(20);
    expect(canInlineFileText(file, content)).toBe(false);
    expect(fileTextPresentation(file, content)).toBe('document');
    expect(canInlineFileText({ ...file, previewable: false }, '# Heading')).toBe(false);
  });

  test('Files and read share the native-node safety boundary without losing content', () => {
    const file = assetFromToolFile(toolFileForPath('/project/source.ts'));
    if (!file) throw new Error('Expected Files descriptor');
    expect(fileTextPresentation(file, 'x'.repeat(MARKDOWN_NATIVE_CEILING))).toBe('code');
    expect(fileTextPresentation(file, 'x'.repeat(MARKDOWN_NATIVE_CEILING + 1))).toBe('lines');
    expect(fileTextPresentation(file, 'x\n'.repeat(TOOL_BODY_MAX_LINES - 1) + 'x')).toBe('code');
    const manyLines = 'x\n'.repeat(TOOL_BODY_MAX_LINES) + 'last available line';
    const longLine = 'const value = "' + 'x'.repeat(MARKDOWN_NATIVE_CEILING) + '";';
    for (const content of [manyLines, longLine]) {
      const preview = readFilePreview(content, file.path);
      if (preview.type !== 'file') throw new Error('Expected file snapshot');
      expect(preview.content).toBe(content);
      expect(fileTextPresentation(preview.file, content)).toBe('lines');
      expect(fileTextPresentation(file, content)).toBe('lines');
    }
  });
});
