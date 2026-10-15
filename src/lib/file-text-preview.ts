import { stripReadLineNumbers } from '@/lib/agent-tool-output';
import { assetPresentation } from '@/lib/asset-viewer-layout';
import { capBodyLines, MARKDOWN_NATIVE_CEILING } from '@/lib/markdown-cap';
import { assetFromToolFile, type SessionAsset } from '@/lib/session-assets';

export type TextPreviewFile = Pick<SessionAsset, 'name' | 'kind' | 'previewable' | 'size'>;

/** Files owns type selection; both hosts also respect the native code-node
 * budget. A short-character file can still contain thousands of short lines.
 * Falling back to the existing row renderer keeps all content accessible.
 */
export function fileTextPresentation(file: TextPreviewFile, content: string) {
  const presentation = assetPresentation(file, content.length);
  const exceedsCodeNode =
    presentation === 'code' &&
    (content.length > MARKDOWN_NATIVE_CEILING || capBodyLines(content).hidden > 0);
  return exceedsCodeNode ? 'lines' : presentation;
}

/** A tiny complete run can use the Files renderer without a list or vertical
 * scroller. Bound both axes of native layout work; longer runs keep a viewport.
 * These are inline budgets, not changes to Files' full-screen node limits.
 */
export const INLINE_FILE_MAX_CHARS = 1_000;
export const INLINE_FILE_MAX_LINES = 8;

export function canInlineFileText(file: TextPreviewFile, content: string): boolean {
  if (
    content.length > INLINE_FILE_MAX_CHARS ||
    content.split('\n').length > INLINE_FILE_MAX_LINES
  ) {
    return false;
  }
  const presentation = fileTextPresentation(file, content);
  return presentation === 'document' || presentation === 'code';
}

type ToolFile = { uri: string; mime?: string; name?: string };

/** Existing path-link fallback, shared by read, write and Files-opening links. */
export function toolFileForPath(path: string): ToolFile {
  return {
    uri: path,
    mime: /\.mdx?$/i.test(path) ? 'text/markdown' : 'text/plain',
    name: path.split('/').pop() ?? path,
  };
}

/** Display-only adaptation. The original result remains the raw-copy source. */
export function readFilePreview(output: string, path: string, files: readonly ToolFile[] = []) {
  // Only unwrap a complete tool envelope, never tags inside a file's own text.
  const envelope = /^<path>[^\n]*<\/path>\r?\n<type>(file|directory)<\/type>\r?\n([\s\S]*)$/.exec(
    output
  );
  if (envelope?.[1] === 'directory' || output.startsWith('Read directory ') || path.endsWith('/')) {
    return { type: 'output' as const, text: output };
  }
  const wrapped =
    envelope?.[1] === 'file'
      ? /^<content>\r?\n?([\s\S]*)\r?\n?<\/content>\s*$/.exec(envelope[2])
      : null;
  const unwrapped = wrapped
    ? `Read file ${path}\n${wrapped[1].replace(/\r?\n\(End of file - total \d+ lines\)\s*$/, '')}`
    : output;
  const body = stripReadLineNumbers(unwrapped)
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, '')
    .split('\n')
    .filter((line) => !(line.length > 120 && /^[A-Za-z0-9+/=]+$/.test(line.trim())))
    .join('\n')
    .trim();
  if (!body) return { type: 'empty' as const };
  const returnedFile = files.find((file) => file.uri === path || file.uri === `file://${path}`);
  const fallback = toolFileForPath(path);
  const resolvedFile = returnedFile
    ? { ...returnedFile, mime: returnedFile.mime ?? fallback.mime }
    : fallback;
  // Classification only: this descriptor is never passed to a fetching viewer.
  let file: SessionAsset | null = null;
  try {
    file = path ? assetFromToolFile(resolvedFile) : null;
  } catch (error) {
    // A malformed file:// escape in a tool result is unknown output, not a
    // reason to crash the transcript while adapting its display.
    if (!(error instanceof URIError)) throw error;
  }
  const presentation = file ? fileTextPresentation(file, body) : 'details';
  if (
    file &&
    (presentation === 'document' || presentation === 'code' || presentation === 'lines')
  ) {
    return { type: 'file' as const, file, content: body };
  }
  return { type: 'output' as const, text: body };
}
