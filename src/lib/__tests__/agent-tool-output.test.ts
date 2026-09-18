import { describe, expect, test } from 'bun:test';

import {
  basename,
  capLines,
  capText,
  classifyTool,
  contentTypeFromMetadata,
  diffFilesFromMetadata,
  editFilesFromMetadata,
  executeErrored,
  executeToolCalls,
  extractCaption,
  extractTarget,
  fencedCode,
  fenceLanguageForPath,
  filesFromContent,
  groupGrepMatches,
  parsePatchSections,
  partialJsonStrings,
  parseToolOutput,
  parseToolQuestions,
  prettyJson,
  questionAnswersFromMetadata,
  resultCountFromMetadata,
  searchProviderFromMetadata,
  shellExitFromMetadata,
  skillDirectoryFromMetadata,
  skillNameFromMetadata,
  splitUrl,
  stripReadLineNumbers,
  stripSubagentEnvelope,
  subagentStatusFromMetadata,
  textFromContent,
  toolArgumentLine,
  toolInputRecord,
  TOOL_ARGUMENT_LINE_CAP,
  TOOL_OUTPUT_BYTE_CAP,
  TOOL_OUTPUT_MAX_LINES,
} from '../agent-tool-output';

describe('classifyTool', () => {
  test('the toolset OpenCode 2.0.1 actually ships', () => {
    expect(classifyTool('shell')).toBe('shell');
    expect(classifyTool('read')).toBe('read');
    expect(classifyTool('write')).toBe('write');
    expect(classifyTool('edit')).toBe('edit');
    expect(classifyTool('glob')).toBe('glob');
    expect(classifyTool('grep')).toBe('grep');
    expect(classifyTool('search')).toBe('search');
    expect(classifyTool('subagent')).toBe('subagent');
    expect(classifyTool('skill')).toBe('skill');
    expect(classifyTool('question')).toBe('question');
    expect(classifyTool('execute')).toBe('execute');
    expect(classifyTool('browser')).toBe('browser');
  });

  test('v1 names still classify, because a session can be running one', () => {
    expect(classifyTool('bash')).toBe('shell');
    expect(classifyTool('task')).toBe('subagent');
    expect(classifyTool('websearch')).toBe('web');
    expect(classifyTool('webfetch')).toBe('web');
    expect(classifyTool('multiedit')).toBe('edit');
    expect(classifyTool('apply_patch')).toBe('patch');
  });

  test('only the todo tools become a checklist, and the case does not matter', () => {
    expect(classifyTool('todowrite')).toBe('todo');
    expect(classifyTool('TodoWrite')).toBe('todo');
    expect(classifyTool('tasks')).toBe('todo');
    // A subagent is a tool row, not a todo list, whatever it is called.
    expect(classifyTool('task')).not.toBe('todo');
  });

  test('anything else is an MCP addition, not an error', () => {
    expect(classifyTool('linear_create_issue')).toBe('mcp');
    expect(classifyTool('')).toBe('mcp');
  });
});

describe('toolInputRecord', () => {
  test('an object is itself', () => {
    expect(toolInputRecord({ path: 'a' })).toEqual({ path: 'a' });
  });

  test('a completed input that arrived as JSON text parses', () => {
    expect(toolInputRecord('{"path":"a"}')).toEqual({ path: 'a' });
  });

  test('a partial JSON string gives up the fields that have landed', () => {
    // The streaming state. What is drawn from it is the *value*, never the
    // half-written payload around it, so a card fills in as the input arrives.
    expect(toolInputRecord('{"pattern": "**')).toEqual({ pattern: '**' });
    expect(toolInputRecord('{"path":"/a","pattern":"*.ts')).toEqual({
      path: '/a',
      pattern: '*.ts',
    });
    // Not even a key yet: there is nothing to say but the tool's name.
    expect(toolInputRecord('{"comm')).toBeNull();
    expect(toolInputRecord('{')).toBeNull();
    expect(toolInputRecord('')).toBeNull();
    expect(toolInputRecord(7)).toBeNull();
    expect(toolInputRecord(null)).toBeNull();
  });
});

describe('extractTarget and extractCaption', () => {
  test('one line per family', () => {
    expect(extractTarget('shell', { command: 'ls -la', workdir: '/tmp' })).toBe('ls -la');
    expect(extractTarget('read', { path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(extractTarget('read', { filePath: '/a/b.ts' })).toBe('/a/b.ts');
    expect(extractTarget('glob', { pattern: '**/*.ts', path: 'src' })).toBe('**/*.ts');
    expect(extractTarget('web', { url: 'https://a.test' })).toBe('https://a.test');
    expect(extractTarget('skill', { id: 'pdf' })).toBe('pdf');
    expect(extractTarget('execute', { code: 'const a = 1;\nconst b = 2;' })).toBe('const a = 1;');
  });

  test('a subagent is named by what it was asked to do', () => {
    expect(
      extractTarget('subagent', { agent: 'explore', description: 'count files', prompt: 'List…' })
    ).toBe('count files');
    expect(extractTarget('subagent', { agent: 'explore' })).toBe('explore');
    expect(extractTarget('subagent', { prompt: 'first line\nsecond' })).toBe('first line');
  });

  test('a patch is named by the first file it touches', () => {
    const patchText = '*** Begin Patch\n*** Update File: src/a.ts\n-a\n+b\n*** End Patch';
    expect(extractTarget('patch', { patchText })).toBe('src/a.ts');
  });

  test('the caption is where it happened, not what happened', () => {
    expect(extractCaption('shell', { command: 'ls', workdir: '/tmp' })).toBe('/tmp');
    expect(extractCaption('read', { path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(extractCaption('glob', { pattern: '*', path: 'src' })).toBe('src');
    expect(extractCaption('mcp', { anything: 1 })).toBe('');
  });

  test('a partial input names what it can, and never the payload', () => {
    // The value, not `{"command": "sle`: the protocol's own half-written text
    // in a card's title is not a title.
    expect(extractTarget('shell', '{"command": "sle')).toBe('sle');
    expect(extractCaption('shell', '{"command": "sle')).toBe('');
    expect(extractCaption('shell', '{"command":"ls","workdir":"/tm')).toBe('/tm');
    // Nothing readable yet, and nothing that is not a string at all.
    expect(extractTarget('shell', '{"comm')).toBe('');
    expect(extractTarget('read', '')).toBe('');
    expect(extractTarget('mcp', 42)).toBe('');
  });

  test('a complete input that arrived as JSON text still reads', () => {
    expect(extractTarget('shell', '{"command":"ls -la"}')).toBe('ls -la');
  });
});

describe('basename and fenceLanguageForPath', () => {
  test('the tail of a path identifies it', () => {
    expect(basename('/a/b/c.ts')).toBe('c.ts');
    expect(basename('c.ts')).toBe('c.ts');
    expect(basename('')).toBe('');
  });

  test('only the grammars the renderer actually has', () => {
    expect(fenceLanguageForPath('a.ts')).toBe('typescript');
    expect(fenceLanguageForPath('a.tsx')).toBe('tsx');
    expect(fenceLanguageForPath('/x/y/a.py')).toBe('python');
    expect(fenceLanguageForPath('Makefile')).toBeUndefined();
    expect(fenceLanguageForPath('a.zzz')).toBeUndefined();
    expect(fenceLanguageForPath('.gitignore')).toBeUndefined();
    expect(fenceLanguageForPath(undefined)).toBeUndefined();
  });

  test('a fence is capped like everything else', () => {
    const fenced = fencedCode('a\nb', 'typescript');
    expect(fenced.text).toBe('```typescript\na\nb\n```');
    expect(fenced.truncated).toBe(false);
    expect(fencedCode('x'.repeat(TOOL_OUTPUT_BYTE_CAP + 10)).truncated).toBe(true);
  });
});

describe('capText and capLines', () => {
  test('under the cap the string is the same one', () => {
    expect(capText('abc', 10)).toEqual({ text: 'abc', truncated: false });
  });

  test('over the cap it is cut and says so', () => {
    expect(capText('abcdef', 3)).toEqual({ text: 'abc', truncated: true });
  });

  test('lines are counted, and the rest is a number rather than a wall', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const capped = capLines(text, 10);
    expect(capped.text.split('\n')).toHaveLength(10);
    expect(capped.hidden).toBe(20);
    expect(capLines('one\ntwo').hidden).toBe(0);
    expect(capLines('')).toEqual({ text: '', hidden: 0 });
    expect(TOOL_OUTPUT_MAX_LINES).toBe(20);
  });
});

describe('parseToolOutput', () => {
  test("shell's two content items: stdout, then the exit line", () => {
    const parsed = parseToolOutput([
      { type: 'text', text: 'hello\nworld' },
      { type: 'text', text: 'Command exited with code 0.' },
    ]);
    expect(parsed).toEqual({ stdout: 'hello\nworld', exitCode: 0, truncated: false });
  });

  test('a non-zero and a negative exit both read', () => {
    expect(parseToolOutput('boom\nCommand exited with code 127.').exitCode).toBe(127);
    expect(parseToolOutput('Command exited with code -1.').exitCode).toBe(-1);
  });

  test('the wrappers a result can arrive in are unwrapped', () => {
    expect(parseToolOutput({ output: 'hi' }).stdout).toBe('hi');
    expect(parseToolOutput({ content: [{ type: 'text', text: 'hi' }] }).stdout).toBe('hi');
    expect(parseToolOutput({ text: 'hi' }).stdout).toBe('hi');
    expect(parseToolOutput({ stdout: 'hi', exitCode: 2 })).toEqual({
      stdout: 'hi',
      exitCode: 2,
      truncated: false,
    });
    expect(parseToolOutput('["a"]').stdout).toBe('a');
  });

  test('nothing is nothing', () => {
    expect(parseToolOutput(undefined)).toEqual({ stdout: '', truncated: false });
    expect(parseToolOutput(null)).toEqual({ stdout: '', truncated: false });
  });

  test('a deeply nested wrapper stops rather than recursing without a guard', () => {
    let value: unknown = 'bottom';
    for (let i = 0; i < 40; i += 1) value = { output: value };
    const parsed = parseToolOutput(value);
    expect(parsed.truncated).toBe(true);
    expect(typeof parsed.stdout).toBe('string');
  });

  test('a cyclic payload cannot hang the formatter', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    expect(() => parseToolOutput(cyclic)).not.toThrow();
    expect(parseToolOutput(cyclic).stdout).toContain('circular');
  });

  test('a huge result is cut at the cap', () => {
    const parsed = parseToolOutput('x'.repeat(TOOL_OUTPUT_BYTE_CAP * 2));
    expect(parsed.stdout).toHaveLength(TOOL_OUTPUT_BYTE_CAP);
    expect(parsed.truncated).toBe(true);
  });

  test('a huge result assembled out of many content items is cut too', () => {
    const items = Array.from({ length: 200 }, () => ({
      type: 'text',
      text: 'y'.repeat(1000),
    }));
    const parsed = parseToolOutput(items);
    expect(parsed.stdout.length).toBeLessThanOrEqual(TOOL_OUTPUT_BYTE_CAP);
    expect(parsed.truncated).toBe(true);
  });
});

describe('prettyJson', () => {
  test('depth is bounded before length is', () => {
    let value: unknown = 'leaf';
    for (let i = 0; i < 12; i += 1) value = { next: value };
    const pretty = prettyJson(value, 3);
    expect(pretty.text).toContain('{…}');
    expect(pretty.text).not.toContain('leaf');
  });

  test('a deep array collapses to its own marker', () => {
    expect(prettyJson({ a: { b: { c: [1, 2, 3] } } }, 2).text).toContain('{…}');
    expect(prettyJson([[[1]]], 2).text).toContain('[…]');
  });

  test('a normal object is readable', () => {
    expect(prettyJson({ a: 1 }).text).toBe('{\n  "a": 1\n}');
  });

  test('a value JSON refuses does not take the card down', () => {
    expect(() => prettyJson({ big: BigInt(1) })).not.toThrow();
  });

  test('the byte cap applies after the depth cap', () => {
    expect(prettyJson({ a: 'z'.repeat(TOOL_OUTPUT_BYTE_CAP) }).truncated).toBe(true);
  });
});

describe('content helpers', () => {
  const content = [
    { type: 'text' as const, text: 'one' },
    { type: 'file' as const, uri: 'file:///tmp/a.png', mime: 'image/png', name: 'a.png' },
    { type: 'text' as const, text: 'two' },
  ];

  test('text items join, file items survive', () => {
    expect(textFromContent(content)).toBe('one\ntwo');
    expect(filesFromContent(content)).toEqual([
      { type: 'file', uri: 'file:///tmp/a.png', mime: 'image/png', name: 'a.png' },
    ]);
  });

  test('no content is an empty string and an empty list', () => {
    expect(textFromContent([])).toBe('');
    expect(filesFromContent([])).toEqual([]);
  });
});

describe('metadata readings', () => {
  test("an edit's ready-to-render diffs", () => {
    expect(
      editFilesFromMetadata({
        files: [
          { file: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 },
          { file: 'no-patch.ts' },
          { patch: '@@' },
          'nonsense',
        ],
        truncated: false,
      })
    ).toEqual([{ path: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 }]);
    expect(editFilesFromMetadata({})).toEqual([]);
  });

  test('a shell exit, a subagent status, a search count', () => {
    expect(shellExitFromMetadata({ exit: 0, status: 'completed' })).toBe(0);
    expect(shellExitFromMetadata({})).toBeUndefined();
    expect(subagentStatusFromMetadata({ sessionID: 'ses_x', status: 'running' })).toBe('running');
    expect(resultCountFromMetadata({ count: 3 })).toBe(3);
    expect(resultCountFromMetadata({ matches: 7 })).toBe(7);
    expect(resultCountFromMetadata({ truncated: false })).toBeUndefined();
  });

  test("Code Mode's own calls, with how each one went", () => {
    // The real shape: `{tool, status, input}`, not `{name}`. The fixture said
    // `name` and so the app only ever read a name.
    expect(
      executeToolCalls({
        toolCalls: [
          { tool: 'read', status: 'completed', input: { path: '/a/b.ts' } },
          { tool: 'grep', status: 'error', input: { pattern: 'x' } },
          { tool: 'glob', status: 'running' },
        ],
      })
    ).toEqual([
      { name: 'read', status: 'completed', input: 'path /a/b.ts' },
      { name: 'grep', status: 'error', input: 'pattern x' },
      { name: 'glob', status: 'running' },
    ]);
    // A status this build has never heard of is a call that finished, not a
    // call with no row.
    expect(executeToolCalls({ toolCalls: [{ tool: 'read', status: 'weird' }] })).toEqual([
      { name: 'read', status: 'completed' },
    ]);
    // Older spellings, and entries that are not calls at all.
    expect(executeToolCalls({ toolCalls: [{ name: 'read' }, 'grep', { id: 'glob' }, 3] })).toEqual([
      { name: 'read', status: 'completed' },
      { name: 'grep', status: 'completed' },
      { name: 'glob', status: 'completed' },
    ]);
    expect(executeToolCalls({})).toEqual([]);
    expect(executeToolCalls({ toolCalls: 'soon' })).toEqual([]);
  });

  test('the sandboxed code throwing is a fact about the code, not the tool', () => {
    expect(executeErrored({ error: true })).toBe(true);
    expect(executeErrored({ error: 'yes' })).toBe(false);
    expect(executeErrored({ toolCalls: [] })).toBe(false);
  });
});

describe('stripSubagentEnvelope', () => {
  test('the envelope comes off and its ids come out', () => {
    const raw = '<subagent sessionID="ses_CHILD" state="completed">\n2\n</subagent>';
    expect(stripSubagentEnvelope(raw)).toEqual({
      text: '2',
      sessionId: 'ses_CHILD',
      state: 'completed',
    });
  });

  test('a result with no envelope is the result', () => {
    expect(stripSubagentEnvelope('plain answer')).toEqual({ text: 'plain answer' });
    expect(stripSubagentEnvelope('')).toEqual({ text: '' });
  });

  test('an envelope that never closed still gives up its body', () => {
    expect(stripSubagentEnvelope('<subagent sessionID="ses_X">half').text).toBe('half');
  });
});

describe('parsePatchSections', () => {
  const patchText = [
    '*** Begin Patch',
    '*** Add File: src/new.ts',
    '+export const a = 1;',
    '*** Update File: src/old.ts',
    '-const b = 1;',
    '+const b = 2;',
    '*** Delete File: src/gone.ts',
    '*** End Patch',
  ].join('\n');

  test('one section per file, in order', () => {
    const sections = parsePatchSections(patchText);
    expect(sections.map((section) => [section.action, section.path])).toEqual([
      ['add', 'src/new.ts'],
      ['update', 'src/old.ts'],
      ['delete', 'src/gone.ts'],
    ]);
  });

  test('each body gets a header a diff row can number it from', () => {
    const [add, update] = parsePatchSections(patchText);
    expect(add.patch).toBe('@@ src/new.ts @@\n+export const a = 1;');
    expect(update.patch).toBe('@@ src/old.ts @@\n-const b = 1;\n+const b = 2;');
  });

  test('a delete with no body is a section with nothing to draw', () => {
    expect(parsePatchSections(patchText)[2].patch).toBe('');
  });

  test('anything that is not a patch is no sections', () => {
    expect(parsePatchSections('')).toEqual([]);
    expect(parsePatchSections('just prose')).toEqual([]);
  });
});

describe('groupGrepMatches', () => {
  test("OpenCode's own shape", () => {
    const output = [
      'Found 3 matches',
      'src/a.ts:',
      '  Line 1: const a = 1;',
      '  Line 9: const b = 2;',
      'src/b.ts:',
      '  Line 4: const c = 3;',
    ].join('\n');
    expect(groupGrepMatches(output)).toEqual([
      {
        file: 'src/a.ts',
        lines: [
          { line: 1, text: 'const a = 1;' },
          { line: 9, text: 'const b = 2;' },
        ],
      },
      { file: 'src/b.ts', lines: [{ line: 4, text: 'const c = 3;' }] },
    ]);
  });

  test('the `path:line:text` shape an MCP grep prints', () => {
    expect(groupGrepMatches('src/a.ts:12:hit\nsrc/a.ts:14:hit again')).toEqual([
      {
        file: 'src/a.ts',
        lines: [
          { line: 12, text: 'hit' },
          { line: 14, text: 'hit again' },
        ],
      },
    ]);
  });

  test('nothing to group is no groups', () => {
    expect(groupGrepMatches('')).toEqual([]);
    expect(groupGrepMatches('Found 0 matches')).toEqual([]);
  });
});

describe('stripReadLineNumbers', () => {
  test("read's own numbering is not part of the file", () => {
    const output = ['Read file /tmp/a.txt, lines 1-3', '1: one', '2: two', '3: three'].join('\n');
    expect(stripReadLineNumbers(output)).toBe('one\ntwo\nthree');
  });

  test('a file whose own content has a colon on one line keeps it', () => {
    const output = ['plain line', 'another', '12: not numbering'].join('\n');
    expect(stripReadLineNumbers(output)).toBe(output);
  });

  test('nothing is nothing', () => {
    expect(stripReadLineNumbers('')).toBe('');
  });
});

describe('the question tool', () => {
  // The shape 2.0.1 actually sends: `questions[]`, each with its own short
  // header, and the answers back as one list per question.
  const INPUT = {
    questions: [
      {
        question: 'Which approach should I take for the tool cards?',
        header: 'Approach',
        options: [
          { label: 'Rewrite', description: 'Start the renderer from scratch' },
          { label: 'Patch', description: 'Keep the shell, change the bodies' },
        ],
        multiple: false,
      },
      {
        question: 'Which surfaces should it cover?',
        header: 'Scope',
        options: [{ label: 'Timeline' }, { label: 'Permission card' }],
        multiple: true,
      },
    ],
  };

  test('every question, with its header, its options and their descriptions', () => {
    const questions = parseToolQuestions(INPUT);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toEqual({
      header: 'Approach',
      question: 'Which approach should I take for the tool cards?',
      options: [
        { label: 'Rewrite', description: 'Start the renderer from scratch' },
        { label: 'Patch', description: 'Keep the shell, change the bodies' },
      ],
      multiple: false,
    });
    expect(questions[1].multiple).toBe(true);
    expect(questions[1].options).toEqual([{ label: 'Timeline' }, { label: 'Permission card' }]);
  });

  test('the header is the header, and a headerless question names itself', () => {
    expect(extractTarget('question', INPUT)).toBe('Approach');
    expect(extractTarget('question', { questions: [{ question: 'Ready?' }] })).toBe('Ready?');
    expect(extractTarget('question', { question: 'the key that does not exist' })).toBe('');
    expect(extractTarget('question', '{"questions": [{"header": "App')).toBe('');
  });

  test('answers arrive as one list per question', () => {
    expect(
      questionAnswersFromMetadata({ answers: [['Patch'], ['Timeline', 'Permission card']] })
    ).toEqual([['Patch'], ['Timeline', 'Permission card']]);
    // A payload that answered with a bare string per question still reads.
    expect(questionAnswersFromMetadata({ answers: ['Patch'] })).toEqual([['Patch']]);
    expect(questionAnswersFromMetadata({})).toEqual([]);
  });

  test('nothing here throws on a shape it has never seen', () => {
    expect(parseToolQuestions(null)).toEqual([]);
    expect(parseToolQuestions({ questions: 'soon' })).toEqual([]);
    expect(parseToolQuestions({ questions: [null, 7, {}, { options: 'no' }] })).toEqual([]);
    expect(questionAnswersFromMetadata({ answers: [null, 7, ['a', 3]] })).toEqual([[], [], ['a']]);
  });
});

describe('the diffs a payload carries', () => {
  // Lifted from a real `session.tool.success` for `edit`: `metadata.files` is
  // `FileDiff.Info[]`, and OpenCode states the status rather than leaving the
  // patch header to be guessed at.
  const EDIT_METADATA = {
    files: [
      {
        file: 'out.txt',
        patch:
          'Index: out.txt\n===================================================================\n--- out.txt\n+++ out.txt\n@@ -1,1 +1,1 @@\n-ok\n\\ No newline at end of file\n+okay\n\\ No newline at end of file\n',
        status: 'modified',
        additions: 1,
        deletions: 1,
      },
    ],
    truncated: false,
  };

  test('the status OpenCode stated survives, rather than being read back out of the patch', () => {
    const files = editFilesFromMetadata(EDIT_METADATA);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('out.txt');
    expect(files[0].status).toBe('modified');
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
  });

  test('a permission ask for an edit carries the same files[]', () => {
    expect(diffFilesFromMetadata(EDIT_METADATA)).toEqual(editFilesFromMetadata(EDIT_METADATA));
  });

  test("a patch's flat {filepath, diff} is read when there is no files[]", () => {
    const files = diffFilesFromMetadata({
      filepath: 'src/a.ts',
      diff: '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n b',
    });
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/a.ts');
    // Counted off the patch, because a flat pair carries no totals of its own.
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
  });

  test('a metadata with no diff in it at all is no diff, not a throw', () => {
    expect(diffFilesFromMetadata({})).toEqual([]);
    expect(diffFilesFromMetadata({ files: 'soon' })).toEqual([]);
    expect(diffFilesFromMetadata({ diff: 7 })).toEqual([]);
    expect(diffFilesFromMetadata({ files: [{ file: 'a' }] })).toEqual([]);
  });
});

describe('an input that is still arriving', () => {
  // The real one, from a captured `session.tool.input.ended` for `shell`.
  const FULL = '{"workdir":"/home/ryu/.cache/tmp/scratchpad/probe","command":"echo probe-done"}';

  test('every prefix of a real shell input is read without throwing', () => {
    for (let length = 0; length <= FULL.length; length += 1) {
      const prefix = FULL.slice(0, length);
      expect(() => toolInputRecord(prefix)).not.toThrow();
      expect(() => extractTarget('shell', prefix)).not.toThrow();
      expect(() => toolArgumentLine(toolInputRecord(prefix))).not.toThrow();
      const target = extractTarget('shell', prefix);
      // Whatever is shown is always a prefix of the command itself, never a
      // brace, a quote or a key from the payload around it.
      expect('echo probe-done'.startsWith(target)).toBe(true);
    }
  });

  test('the card fills in as the command lands, and is complete when it has', () => {
    // The workdir lands first and the command has not started: no target yet.
    expect(extractTarget('shell', FULL.slice(0, 50))).toBe('');
    expect(extractTarget('shell', FULL.slice(0, 66))).toBe('echo');
    expect(extractTarget('shell', FULL.slice(0, 70))).toBe('echo pro');
    expect(extractTarget('shell', FULL)).toBe('echo probe-done');
    // The workdir is the caption from the frame it completes in, whole rather
    // than clipped: it is a finished value, not a growing one.
    expect(extractCaption('shell', FULL.slice(0, 50))).toBe(
      '/home/ryu/.cache/tmp/scratchpad/probe'
    );
  });

  test('the argument line holds every field that has landed, in order', () => {
    expect(toolArgumentLine(toolInputRecord(FULL.slice(0, 66)))).toBe(
      'workdir /home/ryu/.cache/tmp/scratchpad/probe  command echo'
    );
    expect(toolArgumentLine(toolInputRecord(FULL))).toBe(
      'workdir /home/ryu/.cache/tmp/scratchpad/probe  command echo probe-done'
    );
    expect(toolArgumentLine(null)).toBe('');
  });

  test('the scanner is not a parser and says so on every shape', () => {
    // A value that is not a string is skipped rather than guessed at.
    expect(partialJsonStrings('{"hidden":true,"path":".","pattern":"**/*"}')).toEqual({
      path: '.',
      pattern: '**/*',
    });
    // An escaped quote inside a command does not end the value early.
    expect(partialJsonStrings('{"command":"echo \\"hi\\" > a.txt')).toEqual({
      command: 'echo "hi" > a.txt',
    });
    expect(partialJsonStrings('')).toEqual({});
    expect(partialJsonStrings('{')).toEqual({});
    expect(partialJsonStrings('{"a"')).toEqual({});
    expect(partialJsonStrings('{"a":')).toEqual({});
    expect(partialJsonStrings('{"a":{"b":"c"}}')).toEqual({});
  });

  test('the argument line is bounded, whatever the engine sends', () => {
    const long = toolArgumentLine({ command: 'x'.repeat(5000) });
    expect(long.length).toBeLessThanOrEqual(TOOL_ARGUMENT_LINE_CAP);
  });
});

describe('what a skill and a web call are called', () => {
  test('a skill is its name and where it came from, not its id', () => {
    const metadata = { name: 'PDF forms', directory: '/home/ryu/.config/opencode/skills/pdf' };
    expect(skillNameFromMetadata(metadata)).toBe('PDF forms');
    expect(skillDirectoryFromMetadata(metadata)).toBe('/home/ryu/.config/opencode/skills/pdf');
    // Nothing said: the id the skill was asked for by is still the fallback.
    expect(skillNameFromMetadata({})).toBe('');
    expect(skillDirectoryFromMetadata({})).toBe('');
    expect(extractTarget('skill', { id: 'pdf' })).toBe('pdf');
  });

  test('a URL is a host and a page of it', () => {
    expect(splitUrl('https://docs.expo.dev/versions/v57.0.0/')).toEqual({
      host: 'docs.expo.dev',
      path: '/versions/v57.0.0/',
    });
    // `www.` is noise on a host and the bare `/` is noise on a path.
    expect(splitUrl('https://www.example.com/')).toEqual({ host: 'example.com', path: '' });
    expect(splitUrl('https://example.com')).toEqual({ host: 'example.com', path: '' });
    expect(splitUrl('https://example.com/a?b=c#d')).toEqual({
      host: 'example.com',
      path: '/a?b=c',
    });
    // A search query is not a URL, and saying so is how the card tells them apart.
    expect(splitUrl('expo sdk 57 release notes')).toEqual({ host: '', path: '' });
    expect(splitUrl('')).toEqual({ host: '', path: '' });
  });

  test('what came back, and who answered', () => {
    expect(contentTypeFromMetadata({ contentType: 'text/html; charset=utf-8' })).toBe('text/html');
    expect(contentTypeFromMetadata({ contentType: 'application/json' })).toBe('application/json');
    expect(contentTypeFromMetadata({})).toBe('');
    expect(searchProviderFromMetadata({ provider: 'brave' })).toBe('brave');
    expect(searchProviderFromMetadata({})).toBe('');
  });
});
