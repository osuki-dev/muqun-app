import { describe, expect, test } from 'bun:test';
import type { ToolPart } from '../agent-protocol';
import { classifyTool, toolQuestionHistory } from '../agent-tool-output';

const questions = [
  { question: 'Choose colors?', options: [{ label: 'Blue' }, { label: 'Red' }], multiSelect: true },
  { question: 'Anything else?', options: [] },
];
const tool: ToolPart = {
  type: 'tool',
  id: 'call-a',
  name: 'AskUserQuestion',
  state: 'completed',
  input: { questions },
  content: [],
  metadata: {},
};

describe('reading a question tool call from history', () => {
  test('matches Claude replay sentences by question even when answers come back out of order', () => {
    expect(classifyTool(tool.name)).toBe('question');
    const receipt =
      'Your questions have been answered: "Anything else?"="Say "yes", please.", "Choose colors?"="Red, Blue". You can now continue with these answers in mind.';
    const view = toolQuestionHistory({ ...tool, output: receipt });
    expect(view.questions[0]?.multiple).toBe(true);
    expect(view.answers).toEqual([['Red', 'Blue'], ['Say "yes", please.']]);
    expect(view.fallback).toBe('');
    expect(toolQuestionHistory({ ...tool, id: 'call-b', output: undefined }).answers).toEqual([]);
  });
  test('reads the question-keyed native result and the OpenCode ordered answers', () => {
    const native = {
      questions,
      answers: { 'Choose colors?': ['Red', 'Blue'], 'Anything else?': 'Use commas, please' },
    };
    expect(
      toolQuestionHistory({ ...tool, input: undefined, output: { toolUseResult: native } }).answers
    ).toEqual([['Red', 'Blue'], ['Use commas, please']]);
    expect(
      toolQuestionHistory({
        ...tool,
        name: 'question',
        metadata: { answers: [['Blue'], 'Custom'] },
      }).answers
    ).toEqual([['Blue'], ['Custom']]);
  });
  test('keeps an unstructured result visible without selecting an unrelated option', () => {
    const view = toolQuestionHistory({ ...tool, output: 'No selection was submitted.' });
    expect(view.answers).toEqual([]);
    expect(view.fallback).toBe('No selection was submitted.');
  });
});
