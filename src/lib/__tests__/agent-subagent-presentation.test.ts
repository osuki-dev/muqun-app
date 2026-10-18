import { describe, expect, test } from 'bun:test';
import { type ToolPart } from '@/lib/agent-protocol';
import { subagentInlineContent, subagentPresentation } from '@/lib/agent-subagent-presentation';

const activity: ToolPart = {
  type: 'tool',
  id: 'activity',
  name: 'subagent',
  state: 'completed',
  child_session_id: 'child',
  content: [],
  input: { model: null, operation: null, prompt: null, reasoningEffort: null },
  metadata: { kind: 'interacted', agentPath: '/root/review' },
};

describe('subagent activity versus returned result', () => {
  test('legacy Codex activity with all-null arguments contains no result or prompt', () => {
    expect(subagentInlineContent(activity.input, '')).toEqual({ text: '', prompt: '' });
    expect(subagentPresentation(activity).state).toBeUndefined();
    expect(subagentPresentation(activity).action).toBe('interacted');
  });

  test('OpenCode envelopes retain the actual result and session state', () => {
    expect(
      subagentInlineContent(
        activity.input,
        '<subagent sessionID="child" state="completed">\n## Review\nFound an issue.\n</subagent>'
      )
    ).toEqual({
      text: '## Review\nFound an issue.',
      sessionId: 'child',
      state: 'completed',
      prompt: '',
    });
  });

  test('a supplied prompt is not reported as a result or evidence of child completion', () => {
    const part = { ...activity, input: { operation: 'spawnAgent', prompt: 'Inspect the parser' } };
    expect(subagentInlineContent(part.input, '')).toEqual({
      text: '',
      prompt: 'Inspect the parser',
    });
    expect(subagentPresentation(part).state).toBeUndefined();
  });

  test('returned Codex result text survives without interpreting it as arguments', () => {
    expect(subagentInlineContent(activity.input, 'Review finished: fixed ordering.').text).toBe(
      'Review finished: fixed ordering.'
    );
    expect(subagentInlineContent({ prompt: 'Inspect the parser' }, 'Actual review result')).toEqual(
      { text: 'Actual review result', prompt: 'Inspect the parser' }
    );
  });
});
