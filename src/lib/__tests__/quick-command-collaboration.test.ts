import { expect, test } from 'bun:test';

import {
  collaborationCommandAvailable,
  collaborationDraftScope,
  collaborationTaskText,
  commandCollaborationDraft,
} from '../quick-command-collaboration';
import type { QuickCommand } from '../quick-commands';

const context = { serverId: 's', sessionId: 'h', paneId: 'p' };
const custom: QuickCommand = {
  id: 'custom-review',
  label: 'Review my code',
  value: 'Review without editing',
  mode: 'agent',
  custom: true,
  delivery: 'collaboration',
};

test('any custom agent command becomes an editable collaboration draft', () => {
  const draft = commandCollaborationDraft(custom, context);
  expect(draft.prompt).toBe(custom.value);
  expect(draft.command?.name).toBe(custom.label);
  expect(draft.command?.instructions).toBeUndefined();
  expect(draft.context.commandId).toBe(custom.id);
});

test('draft scopes distinguish machines, sessions, commands and ordinary collaboration', () => {
  const a = commandCollaborationDraft(custom, context).context;
  for (const other of [
    context,
    { ...a, serverId: 'other' },
    { ...a, sessionId: 'other' },
    { ...a, commandId: 'other' },
  ]) {
    expect(collaborationDraftScope(a)).not.toBe(collaborationDraftScope(other));
  }
});

test('custom commands cannot impersonate bundled builders and direct commands stay direct', () => {
  expect(
    commandCollaborationDraft({ ...custom, instructionId: 'untrusted' }, context).command
      ?.instructions
  ).toBeUndefined();
  expect(() =>
    commandCollaborationDraft({ ...custom, custom: false, instructionId: 'unknown' }, context)
  ).toThrow('Unsupported');
  expect(() =>
    commandCollaborationDraft({ ...custom, delivery: 'current-agent' }, context)
  ).toThrow('does not use');
  expect(() => commandCollaborationDraft({ ...custom, mode: 'terminal' }, context)).toThrow(
    'does not use'
  );
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

test('management needs no agent while execution requires a complete Herdr agent context', () => {
  expect(collaborationCommandAvailable({ manageOnly: true })).toBe(true);
  const live = { ...context, manageOnly: false, backendKind: 'herdr', agentTarget: 'agent' };
  expect(collaborationCommandAvailable(live)).toBe(true);
  for (const other of [
    { ...live, agentTarget: undefined },
    { ...live, serverId: undefined },
    { ...live, backendKind: 'tmux' },
  ]) {
    expect(collaborationCommandAvailable(other)).toBe(false);
  }
});
