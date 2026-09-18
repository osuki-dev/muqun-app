import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  classifyTool,
  diffFilesFromMetadata,
  executeErrored,
  executeToolCalls,
  extractCaption,
  extractTarget,
  parsePatchSections,
  parseToolQuestions,
  questionAnswersFromMetadata,
  toolArgumentLine,
  toolInputRecord,
} from '@/lib/agent-tool-output';

/**
 * What each tool card puts on screen, from the payloads the engine actually
 * sends.
 *
 * The card itself cannot be mounted here: it pulls in Reanimated, Expo Image
 * and the native markdown and diff views, none of which parse outside Metro.
 * What it *shows*, though, is decided by the pure readings in
 * `agent-tool-output.ts` -- the title, the caption, the chips, which body --
 * and those are exercised below on fixtures lifted from real
 * `session.tool.success` events. The source assertions beside them hold the
 * wiring: that the card reads the tool's own answer before it re-reads the
 * request, and that nothing draws a body the fixtures say is empty.
 */
const CARD = readFileSync('src/components/agent-tool-card.tsx', 'utf8');

// ---------------------------------------------------------------------------
// question
// ---------------------------------------------------------------------------

describe('the question card', () => {
  const INPUT = {
    questions: [
      {
        question: 'How should the tool cards handle a patch?',
        header: 'Patch rendering',
        options: [
          { label: 'metadata.files', description: 'What the tool applied' },
          { label: 'input.patchText', description: 'What the tool was asked to apply' },
        ],
        multiple: false,
      },
    ],
  };
  const METADATA = { answers: [['metadata.files']] };

  test('the header names the question, not the tool', () => {
    expect(classifyTool('question')).toBe('question');
    expect(extractTarget('question', INPUT)).toBe('Patch rendering');
  });

  test('the body has the question, its options and their descriptions', () => {
    const [question] = parseToolQuestions(INPUT);
    expect(question.question).toBe('How should the tool cards handle a patch?');
    expect(question.options.map((option) => option.label)).toEqual([
      'metadata.files',
      'input.patchText',
    ]);
    expect(question.options[0].description).toBe('What the tool applied');
    expect(question.multiple).toBe(false);
  });

  test('the answered option is the one the metadata names', () => {
    const answers = questionAnswersFromMetadata(METADATA);
    const [question] = parseToolQuestions(INPUT);
    const marked = question.options.filter((option) => answers[0].includes(option.label));
    expect(marked.map((option) => option.label)).toEqual(['metadata.files']);
  });

  test('the card draws the questions, and no longer the keys the tool never sends', () => {
    expect(CARD).toContain('parseToolQuestions(part.input)');
    expect(CARD).toContain('questionAnswersFromMetadata(part.metadata)');
    expect(CARD).not.toContain('input?.question');
    expect(CARD).not.toContain('input?.prompt');
  });
});

// ---------------------------------------------------------------------------
// patch
// ---------------------------------------------------------------------------

describe('the patch card', () => {
  // `metadata.files` is what the tool applied, in the same `FileDiff.Info`
  // shape an `edit` answers with.
  const METADATA = {
    files: [
      {
        file: 'src/a.ts',
        patch: '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n const b = 3;',
        status: 'modified',
        additions: 1,
        deletions: 1,
      },
    ],
  };
  // `input.patchText` is what it was *asked* to apply: `apply_patch`'s own
  // format, which is not a unified diff.
  const INPUT = {
    patchText:
      '*** Begin Patch\n*** Update File: src/a.ts\n-const a = 1;\n+const a = 2;\n*** End Patch',
  };

  test('the applied diff wins over the requested one', () => {
    const files = diffFilesFromMetadata(METADATA);
    expect(files.map((file) => file.path)).toEqual(['src/a.ts']);
    expect(files[0].status).toBe('modified');
    // The chips come off these, and used to come off nothing at all.
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
  });

  test('the request is still read when the tool answered without metadata', () => {
    expect(diffFilesFromMetadata({})).toEqual([]);
    const sections = parsePatchSections(INPUT.patchText);
    expect(sections.map((section) => section.path)).toEqual(['src/a.ts']);
    expect(sections[0].action).toBe('update');
    expect(extractTarget('patch', INPUT)).toBe('src/a.ts');
  });

  test('the card asks the metadata first and the patchText only after', () => {
    expect(CARD).toContain("kind === 'patch' ? diffFilesFromMetadata(part.metadata) : []");
    // The fallback parse does not even run when the tool answered.
    expect(CARD).toContain("if (kind !== 'patch' || patchFiles.length > 0) return [];");
    // The same per-file rows an edit draws, rather than a second diff body.
    expect(CARD).toContain('files={args.patchFiles}');
    // The chips count what was applied.
    expect(CARD).toContain("const counted = kind === 'patch' ? patchFiles : editFiles;");
  });
});

// ---------------------------------------------------------------------------
// a call that has not run yet
// ---------------------------------------------------------------------------

describe('the pending card', () => {
  // `input_partial` is `session.tool.input.delta` concatenated: the arguments
  // as text, in the order the model wrote them.
  const FULL = '{"workdir":"/home/ryu/probe","command":"echo probe-done"}';

  test('the header names the call before the call is made', () => {
    // Nothing but a brace: the tool name is all there is to say.
    expect(extractTarget('shell', '{"workdir":"/home/ryu/pro')).toBe('');
    // The workdir has landed, the command is still coming.
    expect(extractCaption('shell', FULL.slice(0, 30))).toBe('/home/ryu/probe');
    expect(extractTarget('shell', FULL.slice(0, 48))).toBe('echo pro');
    expect(extractTarget('shell', FULL)).toBe('echo probe-done');
  });

  test('the argument line under the header is the arguments, not the payload', () => {
    const line = toolArgumentLine(toolInputRecord(FULL.slice(0, 48)));
    expect(line).toBe('workdir /home/ryu/probe  command echo pro');
    expect(line).not.toContain('{');
    expect(line).not.toContain('"');
  });

  test('the card reads input_partial and draws it only while pending', () => {
    expect(CARD).toContain('part.input_partial ?? part.input');
    expect(CARD).toContain('pending ? toolArgumentLine(input) : ');
    expect(CARD).toContain('pending && argumentLine ?');
    expect(CARD).toContain('<StreamingArguments text={argumentLine} />');
  });

  test('a half-written string never throws, at any length', () => {
    for (let length = 0; length <= FULL.length; length += 1) {
      const prefix = FULL.slice(0, length);
      expect(() => toolInputRecord(prefix)).not.toThrow();
      expect(() => toolArgumentLine(toolInputRecord(prefix))).not.toThrow();
      expect(() => extractCaption('shell', prefix)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// execute (Code Mode)
// ---------------------------------------------------------------------------

describe('the Code Mode card', () => {
  const METADATA = {
    toolCalls: [
      { tool: 'read', status: 'completed', input: { path: '/a/b.ts' } },
      { tool: 'grep', status: 'error', input: { pattern: 'needle' } },
      { tool: 'glob', status: 'running' },
    ],
    error: true,
  };

  test('a row per call, each with the status the sandbox reported', () => {
    expect(executeToolCalls(METADATA)).toEqual([
      { name: 'read', status: 'completed', input: 'path /a/b.ts' },
      { name: 'grep', status: 'error', input: 'pattern needle' },
      { name: 'glob', status: 'running' },
    ]);
  });

  test('the code throwing is its own chip, not a failed tool call', () => {
    expect(executeErrored(METADATA)).toBe(true);
    // The real captured success: Code Mode ran, called nothing, threw nothing.
    expect(executeErrored({ toolCalls: [], truncated: false })).toBe(false);
    expect(executeToolCalls({ toolCalls: [], truncated: false })).toEqual([]);
  });

  test('the card draws the dot, the name and the error chip', () => {
    expect(CARD).toContain('executeToolCalls(metadata)');
    expect(CARD).toContain("call.status === 'running'");
    expect(CARD).toContain("call.status === 'error'");
    expect(CARD).toContain("kind === 'execute' && executeErrored(part.metadata)");
    // Bounded: a Code Mode run can call a tool in a loop.
    expect(CARD).toContain('calls.slice(0, EXECUTE_CALL_MAX)');
  });
});

// ---------------------------------------------------------------------------
// the shapes that must never reach a renderer
// ---------------------------------------------------------------------------

describe('a payload no build has seen before', () => {
  const HOSTILE: unknown[] = [
    undefined,
    null,
    7,
    'a string',
    [],
    {},
    { questions: {} },
    { files: [null] },
    { patchText: 7 },
  ];

  test('every reading a card does takes it and answers something drawable', () => {
    for (const value of HOSTILE) {
      expect(() => parseToolQuestions(value)).not.toThrow();
      expect(Array.isArray(parseToolQuestions(value))).toBe(true);
      expect(() => extractTarget('patch', value)).not.toThrow();
      expect(() => extractCaption('question', value)).not.toThrow();
      const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      expect(() => diffFilesFromMetadata(record)).not.toThrow();
      expect(() => questionAnswersFromMetadata(record)).not.toThrow();
    }
  });
});
