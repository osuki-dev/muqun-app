import { expect, test } from 'bun:test';

import {
  collaborationCommandAvailable,
  collaborationDraftScope,
  collaborationTaskText,
  commandCollaborationDraft,
} from '@/lib/quick-command-collaboration';
import type { QuickCommand } from '@/lib/quick-commands';

const context = { serverId: 's', sessionId: 'h', paneId: 'p' };
const custom: QuickCommand = {
  id: 'custom-review',
  label: 'Review my code',
  value: 'Review without editing',
  mode: 'agent',
  custom: true,
  delivery: 'collaboration',
};

test('any custom agent command can become an editable collaboration draft', () => {
  const draft = commandCollaborationDraft(custom, context);
  expect(draft.prompt).toBe(custom.value);
  expect(draft.command?.name).toBe(custom.label);
  expect(draft.command).toEqual({ name: custom.label });
  expect(draft.context.commandId).toBe(custom.id);
});

test('draft scopes distinguish machines, commands and ordinary collaboration', () => {
  const a = commandCollaborationDraft(custom, context).context;
  expect(collaborationDraftScope(a)).not.toBe(collaborationDraftScope(context));
  expect(collaborationDraftScope(a)).not.toBe(collaborationDraftScope({ ...a, serverId: 'other' }));
  expect(collaborationDraftScope(a)).not.toBe(
    collaborationDraftScope({ ...a, commandId: 'other' })
  );
});

test('current-agent and terminal commands stay direct', () => {
  expect(() =>
    commandCollaborationDraft({ ...custom, delivery: 'current-agent' }, context)
  ).toThrow();
  expect(() => commandCollaborationDraft({ ...custom, mode: 'terminal' }, context)).toThrow();
  expect(collaborationTaskText(custom.value, '')).toBe(custom.value);
  expect(() => collaborationTaskText('x'.repeat(65537), '')).toThrow('limit');
});

test('management needs no agent; execution requires a valid agent collaboration context', () => {
  expect(collaborationCommandAvailable({ manageOnly: true })).toBe(true);
  const live = { ...context, manageOnly: false, backendKind: 'herdr', agentTarget: 'agent-1' };
  expect(collaborationCommandAvailable(live)).toBe(true);
  expect(collaborationCommandAvailable({ ...live, agentTarget: undefined })).toBe(false);
  expect(collaborationCommandAvailable({ ...live, serverId: undefined })).toBe(false);
  expect(collaborationCommandAvailable({ ...live, backendKind: 'tmux' })).toBe(false);
});

test('assembled instructions are bounded by UTF-8 bytes, including shared context', () => {
  expect(collaborationTaskText('Review', '')).toBe('Review');
  expect(collaborationTaskText('My requirement', '', 'Bundled instructions')).toContain(
    '## Additional requirements\nMy requirement'
  );
  expect(collaborationTaskText('x'.repeat(65536), '')).toHaveLength(65536);
  expect(() => collaborationTaskText('x'.repeat(65537), '')).toThrow('limit');
  expect(() => collaborationTaskText('🌸'.repeat(16385), '')).toThrow('limit');
  expect(() => collaborationTaskText('x'.repeat(65536), 'context')).toThrow('limit');
});
