import { expect, test } from 'bun:test';

import {
  collaborationCommandAvailable,
  collaborationDraftScope,
  collaborationTaskText,
  commandCollaborationDraft,
} from '@/lib/quick-command-collaboration';
import type { QuickCommand } from '@/lib/quick-commands';
import { parseThemeManifest } from '@/theme/schema';

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
  expect(draft.command?.instructions).toBeUndefined();
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

test('built-in theme skill uses the same pipeline with a complete template', () => {
  const draft = commandCollaborationDraft(
    { ...custom, custom: false, instructionId: 'muqun-theme', value: '' },
    context
  );
  const text = collaborationTaskText('Cute comic artwork', '', draft.command?.instructions);
  expect(text).toContain('## Additional requirements\nCute comic artwork');
  expect(
    parseThemeManifest(text.split('```muqun-theme\n')[1].split('\n```')[0]).schemaVersion
  ).toBe(1);
  expect(new TextEncoder().encode(text).length < 64 * 1024).toBe(true);
});

test('custom data cannot impersonate a bundled skill and current-agent commands stay direct', () => {
  expect(
    commandCollaborationDraft({ ...custom, instructionId: 'muqun-theme' }, context).command
      ?.instructions
  ).toBeUndefined();
  expect(() =>
    commandCollaborationDraft({ ...custom, delivery: 'current-agent' }, context)
  ).toThrow();
  expect(() => commandCollaborationDraft({ ...custom, mode: 'terminal' }, context)).toThrow();
  expect(() =>
    commandCollaborationDraft({ ...custom, custom: false, instructionId: 'unknown' }, context)
  ).toThrow();
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
