import { agentCommandPresets } from '@/lib/agent-command-presets';
import {
  collaborationPrompt,
  collaborationScope,
  type CollaborationContext,
  type CollaborationDraft,
} from '@/lib/agent-collaboration';
import type { QuickCommand } from '@/lib/quick-commands';

export function collaborationCommandAvailable(context: {
  manageOnly: boolean;
  backendKind?: string;
  agentTarget?: string;
  serverId?: string;
  sessionId?: string;
  paneId?: string;
}): boolean {
  return (
    context.manageOnly ||
    Boolean(
      context.backendKind === 'herdr' &&
      context.agentTarget &&
      context.serverId &&
      context.sessionId &&
      context.paneId
    )
  );
}

export function collaborationDraftScope(context: CollaborationContext): string {
  const scope = collaborationScope(context.serverId, context.sessionId);
  return context.commandId ? JSON.stringify([scope, context.commandId]) : scope;
}

export function commandCollaborationDraft(
  command: QuickCommand,
  context: CollaborationContext
): CollaborationDraft {
  if (command.mode !== 'agent' || command.delivery !== 'collaboration') {
    throw new Error('This shortcut does not use Agent collaboration');
  }
  const preset =
    !command.custom && command.instructionId
      ? Object.hasOwn(agentCommandPresets, command.instructionId)
        ? agentCommandPresets[command.instructionId]
        : undefined
      : undefined;
  if (!command.custom && command.instructionId && !preset)
    throw new Error('Unsupported bundled instruction');
  return {
    context: { ...context, commandId: command.id },
    prompt: command.value,
    target: '',
    newAgent: false,
    kind: '',
    recoveryPane: null,
    command: {
      name: command.label,
      ...(preset ? { instructions: preset.build(), description: preset.description } : {}),
    },
  };
}

export function collaborationTaskText(
  prompt: string,
  context: string,
  instructions?: string
): string {
  const body = instructions
    ? `${instructions}\n\n## Additional requirements\n${prompt.trim()}`
    : prompt;
  const text = collaborationPrompt(body, context);
  if (new TextEncoder().encode(text).length > 64 * 1024)
    throw new Error('Instructions exceed the Gateway message limit');
  return text;
}
