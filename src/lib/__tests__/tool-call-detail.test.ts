import { describe, expect, test } from 'bun:test';

import type { ToolPart } from '../agent-protocol';
import { tokenizeLine } from '../code-tokens';
import {
  formatToolDuration,
  isCancellation,
  LARGE_OUTPUT_CHARS,
  LARGE_OUTPUT_LINES,
  MAX_OUTPUT_PATH_LENGTH,
  runningElapsedMs,
  toolCallDetail,
  toolCallRows,
  workspaceOutputPath,
} from '../tool-call-detail';

function tool(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: 'tool',
    id: 'call-1',
    name: 'search',
    input: { query: 'browser terminal screenshot', limit: 6 },
    content: [],
    metadata: {},
    state: 'completed',
    time: { created: 1_000, ran: 1_000, completed: 1_015 },
    ...overrides,
  };
}

describe('formatToolDuration', () => {
  test('reads like the TUI status line', () => {
    expect(formatToolDuration(15)).toBe('15ms');
    expect(formatToolDuration(3_240)).toBe('3.2s');
    expect(formatToolDuration(42_000)).toBe('42s');
    expect(formatToolDuration(124_000)).toBe('2m 04s');
  });

  test('a running clock never goes negative on a host ahead of the phone', () => {
    expect(runningElapsedMs(2_000, 1_500)).toBe(0);
    expect(runningElapsedMs(1_000, 4_200)).toBe(3_200);
  });
});

describe('status', () => {
  test('completed, with its duration', () => {
    const detail = toolCallDetail(tool({ output: '{"items": []}' }));
    expect(detail.status).toBe('completed');
    expect(detail.durationMs).toBe(15);
    expect(detail.startedAt).toBeUndefined();
  });

  test('failed carries the engine message and colours the output', () => {
    const detail = toolCallDetail(
      tool({
        name: 'execute',
        state: 'failed',
        input: { code: "return await tools.browser.preview({path:'/tmp/a.png'})" },
        error: { name: 'unknown', message: '[browser.disconnected] No desktop browser.' },
        time: { ran: 10, completed: 24 },
      })
    );
    expect(detail.status).toBe('failed');
    expect(detail.durationMs).toBe(14);
    expect(detail.error).toBe('[browser.disconnected] No desktop browser.');
    const rows = toolCallRows(detail);
    expect(rows.find((row) => row.type === 'error')).toMatchObject({
      text: '[browser.disconnected] No desktop browser.',
    });
    // The message stands for the output: no "No output" under it.
    expect(rows.some((row) => row.type === 'empty' && row.section === 'output')).toBe(false);
  });

  test('a shell that exits non-zero failed, and its output is drawn red', () => {
    const detail = toolCallDetail(
      tool({
        name: 'bash',
        input: { command: 'ls /nope', description: 'list' },
        metadata: { exit: 2 },
        output: 'ls: cannot access /nope: No such file or directory',
      })
    );
    expect(detail.status).toBe('failed');
    expect(detail.exitCode).toBe(2);
    const line = toolCallRows(detail).find(
      (row) => row.type === 'line' && row.section === 'output'
    );
    expect(line).toMatchObject({ failed: true, language: 'plain' });
  });

  test('the exit line OpenCode prints is lifted out of the output', () => {
    const detail = toolCallDetail(
      tool({ name: 'bash', output: 'hello\nCommand exited with code 1.' })
    );
    expect(detail.exitCode).toBe(1);
    expect(detail.output?.text).toBe('hello');
    expect(detail.status).toBe('failed');
    // OpenCode 2's own wording, after a blank line.
    const v2 = toolCallDetail(tool({ name: 'bash', output: 'ls: nope\n\nExited with code 2' }));
    expect(v2).toMatchObject({ exitCode: 2, output: { text: 'ls: nope' } });
  });

  test('running has a start for the live clock and no duration', () => {
    const detail = toolCallDetail(tool({ state: 'running', time: { created: 5, ran: 7 } }));
    expect(detail.status).toBe('running');
    expect(detail.startedAt).toBe(7);
    expect(detail.durationMs).toBeUndefined();
  });

  test('pending and streaming are running too, with the input still arriving', () => {
    const detail = toolCallDetail(
      tool({ state: 'streaming', input: undefined, input_partial: '{"command": "git sta' })
    );
    expect(detail.status).toBe('running');
    expect(detail.inputStreaming).toBe(true);
    expect(detail.input?.text).toBe('{"command": "git sta');
  });

  test('an aborted call is cancelled, not failed', () => {
    expect(isCancellation({ name: 'MessageAbortedError', message: '' })).toBe(true);
    expect(isCancellation({ name: 'unknown', message: 'Tool execution aborted' })).toBe(true);
    expect(isCancellation({ name: 'unknown', message: 'ENOENT: aborted write' })).toBe(false);
    const detail = toolCallDetail(
      tool({ state: 'failed', error: { name: 'MessageAbortedError', message: 'Aborted' } })
    );
    expect(detail.status).toBe('cancelled');
  });

  test('a declined permission is a failure the sheet can name as the reader’s', () => {
    const detail = toolCallDetail(
      tool({ state: 'failed', error: { name: 'unknown', message: 'The user rejected this call' } })
    );
    expect(detail.status).toBe('failed');
    expect(detail.declined).toBe(true);
  });
});

describe('input', () => {
  test('arguments are pretty-printed JSON', () => {
    const detail = toolCallDetail(tool());
    expect(detail.input?.language).toBe('json');
    expect(detail.input?.lines).toEqual([
      '{',
      '  "query": "browser terminal screenshot",',
      '  "limit": 6',
      '}',
    ]);
  });

  test('Code Mode shows its code, and a shell its command', () => {
    expect(
      toolCallDetail(tool({ name: 'execute', input: { code: 'return 1' } })).input
    ).toMatchObject({ text: 'return 1', language: 'code' });
    expect(
      toolCallDetail(tool({ name: 'bash', input: { command: 'ls -la' } })).input
    ).toMatchObject({
      text: 'ls -la',
      language: 'shell',
    });
  });

  test('no input is said, not drawn as "null"', () => {
    const detail = toolCallDetail(tool({ input: {} }));
    expect(detail.input).toBeNull();
    expect(toolCallRows(detail)[1]).toMatchObject({ type: 'empty', section: 'input' });
  });
});

describe('output', () => {
  test('JSON output is pretty-printed and coloured as JSON', () => {
    const detail = toolCallDetail(tool({ output: '{"remaining":39,"next":{"offset":6}}' }));
    expect(detail.output?.language).toBe('json');
    expect(detail.output?.lines.length).toBe(6);
  });

  test('content text is preferred over the flattened output', () => {
    const detail = toolCallDetail(
      tool({ content: [{ type: 'text', text: 'from content' }], output: 'flattened' })
    );
    expect(detail.output?.text).toBe('from content');
  });

  test('empty output is "No output"', () => {
    const detail = toolCallDetail(tool({ output: '  \n' }));
    expect(detail.output).toBeNull();
    expect(toolCallRows(detail).at(-1)).toMatchObject({ type: 'empty', section: 'output' });
  });

  test('large output is offered as a file, by lines or by size', () => {
    const lines = Array.from({ length: LARGE_OUTPUT_LINES + 1 }, (_, index) => `line ${index}`);
    expect(toolCallDetail(tool({ output: lines.join('\n') })).large).toBe(true);
    expect(toolCallDetail(tool({ output: 'x'.repeat(LARGE_OUTPUT_CHARS + 1) })).large).toBe(true);
    expect(toolCallDetail(tool({ output: lines.slice(0, 50).join('\n') })).large).toBe(false);
  });

  test('the file the engine saved the whole output to is found inside the workspace', () => {
    const workspace = { workspace: '/Users/otaku/Work/app' };
    expect(
      toolCallDetail(
        tool({ metadata: { truncated: true, outputPath: '/Users/otaku/Work/app/.out/tool_1' } }),
        workspace
      ).fullOutputPath
    ).toBe('/Users/otaku/Work/app/.out/tool_1');
    expect(
      toolCallDetail(
        tool({
          output:
            '...\nThe tool call succeeded but the output was truncated. Full output saved to: /Users/otaku/Work/app/tool_2\n',
        }),
        workspace
      ).fullOutputPath
    ).toBe('/Users/otaku/Work/app/tool_2');
    // No workspace known: nothing is offered.
    expect(
      toolCallDetail(tool({ metadata: { outputPath: '/Users/otaku/Work/app/tool_1' } }))
        .fullOutputPath
    ).toBeUndefined();
  });

  test('both sections number from one', () => {
    const rows = toolCallRows(toolCallDetail(tool({ output: 'a\nb' })));
    const numbers = rows.flatMap((row) =>
      row.type === 'line' ? [`${row.section}:${row.newLine}`] : []
    );
    expect(numbers).toEqual(['input:1', 'input:2', 'input:3', 'input:4', 'output:1', 'output:2']);
  });
});

describe('workspaceOutputPath', () => {
  const root = '/Users/otaku/Work/app';

  test('inside the workspace, normalised', () => {
    expect(workspaceOutputPath(`${root}/build/out.log`, root)).toBe(`${root}/build/out.log`);
    expect(workspaceOutputPath(`${root}//build\\out.log`, `${root}/`)).toBe(
      `${root}/build/out.log`
    );
  });

  test('traversal is refused, however it is spelled', () => {
    expect(workspaceOutputPath(`${root}/../../.ssh/id_ed25519`, root)).toBeUndefined();
    expect(workspaceOutputPath(`${root}/a/..\\..\\secret`, root)).toBeUndefined();
    expect(workspaceOutputPath(`${root}/./out.log`, root)).toBeUndefined();
  });

  test('a relative path is refused', () => {
    expect(workspaceOutputPath('build/out.log', root)).toBeUndefined();
    expect(workspaceOutputPath('~/out.log', root)).toBeUndefined();
  });

  test('control characters and newlines are refused', () => {
    expect(workspaceOutputPath(`${root}/out.log\n/etc/passwd`, root)).toBeUndefined();
    expect(workspaceOutputPath(`${root}/out\u0000.log`, root)).toBeUndefined();
    expect(workspaceOutputPath(`${root}/out\u007f.log`, root)).toBeUndefined();
  });

  test('outside the workspace is refused, including a sibling sharing its prefix', () => {
    expect(workspaceOutputPath('/etc/passwd', root)).toBeUndefined();
    expect(workspaceOutputPath(`${root}-evil/out.log`, root)).toBeUndefined();
    expect(workspaceOutputPath(root, root)).toBeUndefined();
    expect(
      workspaceOutputPath('/Users/otaku/.local/share/opencode/tool-output/tool_1', root)
    ).toBeUndefined();
  });

  test('the gateway uploads folder is not an output location', () => {
    expect(
      workspaceOutputPath(
        '/Users/otaku/Library/Application Support/muqun-gateway/uploads/a.txt',
        root
      )
    ).toBeUndefined();
  });

  test('a root-of-disk workspace, an over-long path or a non-string is refused', () => {
    expect(workspaceOutputPath('/etc/passwd', '/')).toBeUndefined();
    expect(
      workspaceOutputPath(`${root}/${'a'.repeat(MAX_OUTPUT_PATH_LENGTH)}`, root)
    ).toBeUndefined();
    expect(workspaceOutputPath(42, root)).toBeUndefined();
    expect(workspaceOutputPath(`${root}/out.log`, undefined)).toBeUndefined();
  });
});

describe('tokenizeLine', () => {
  test('JSON keys, strings, numbers and constants', () => {
    expect(tokenizeLine('  "limit": 6, "ok": true', 'json')).toEqual([
      { text: '  ', kind: 'plain' },
      { text: '"limit"', kind: 'property' },
      { text: ':', kind: 'punctuation' },
      { text: ' ', kind: 'plain' },
      { text: '6', kind: 'number' },
      { text: ',', kind: 'punctuation' },
      { text: ' ', kind: 'plain' },
      { text: '"ok"', kind: 'property' },
      { text: ':', kind: 'punctuation' },
      { text: ' ', kind: 'plain' },
      { text: 'true', kind: 'constant' },
    ]);
  });

  test('shell: the program, flags, strings, variables and comments', () => {
    const kinds = tokenizeLine('git log -n 3 "$REF" | head # recent', 'shell')
      .filter((token) => token.kind !== 'plain')
      .map((token) => `${token.kind}:${token.text}`);
    expect(kinds).toEqual([
      'function:git',
      'attribute:-n',
      'number:3',
      'string:"$REF"',
      'punctuation:|',
      'function:head',
      'comment:# recent',
    ]);
  });

  test('code: keywords, calls, properties and strings', () => {
    const kinds = tokenizeLine("return search({query:'x',limit:6});", 'code')
      .filter((token) => token.kind !== 'plain' && token.kind !== 'punctuation')
      .map((token) => `${token.kind}:${token.text}`);
    expect(kinds).toEqual([
      'keyword:return',
      'function:search',
      'property:query',
      "string:'x'",
      'property:limit',
      'number:6',
    ]);
  });

  test('plain text is one run, and the runs always rebuild the line', () => {
    expect(tokenizeLine('hello world', 'plain')).toEqual([{ text: 'hello world', kind: 'plain' }]);
    for (const [line, language] of [
      ['{"a": "unterminated', 'json'],
      ["echo 'it''s' ${HOME}/x && ls", 'shell'],
      ['const x = `a ${b}` /* c */ // d', 'code'],
    ] as const) {
      expect(
        tokenizeLine(line, language)
          .map((token) => token.text)
          .join('')
      ).toBe(line);
    }
  });
});
