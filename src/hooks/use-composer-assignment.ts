import { useCallback, useState } from 'react';

import {
  canAssignToAgent,
  collaborationSpawnOutcome,
  type CollaborationTask,
} from '@/lib/agent-collaboration';
import { attachmentCommandText } from '@/lib/agent-command-references';
import type { AttachmentDestination, PendingAttachment } from '@/lib/attachment-queue';
import { loadAgents, sendAgentText, spawnBoundAgent } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { field } from '@/lib/herdr-entity';
import { useAgentCollaboration } from '@/stores/agent-collaboration';

/**
 * Assigning a task from the composer, to an assistant chosen above it.
 *
 * ## Why the task form is not a screen any more
 *
 * It was: a page with its own text field, its own image strip, its own Send. All
 * three already existed a few points below it, better -- the composer has the
 * attachment queue with previews and per-item retry, the upload-before-send
 * wait, and the destination guard. The page rebuilt them worse and made the
 * reader leave the terminal to use them.
 *
 * What assigning a task actually needs that the composer does not already have
 * is one thing: *which assistant*. So that is all that was added -- a strip of
 * assistants above the field -- and everything else is the composer doing what
 * it already does. Reading stays on the collaboration screen: history, status
 * and past output are not composer-shaped and did not move.
 *
 * ## The two targets
 *
 * `{ kind }` starts a new assistant and gives it the task. `{ paneId }` hands it
 * to one that is already running -- see `supportsExistingAgentDelivery` for what
 * that costs and what is done about it. Both verify immediately before writing,
 * and neither retries: an unacknowledged write could be a lost reply rather than
 * a lost request, and a second attempt would risk a second copy of the task, or
 * a second assistant (AGENTS.md).
 *
 * Status is never taken as proof of anything. `outcome === 'sent'` means the
 * Gateway confirmed the agent started *and* the prompt was submitted; everything
 * else is surfaced as the doubt it is, with the reader's text kept.
 */
export type AssignmentTarget =
  /** Start a new assistant of this kind. */
  | { type: 'new'; kind: string }
  /** Hand it to this one, which is already running. */
  | { type: 'agent'; paneId: string; instanceId: string; name: string };

export type AssignmentCommand = { name: string; description?: string; instructions?: string };

export type AssignmentOutcome =
  | { status: 'sent'; task: CollaborationTask }
  /** The write happened but nothing confirmed it. Never retried automatically. */
  | { status: 'unconfirmed'; paneId: string; reason: string };

export function useComposerAssignment(context: {
  serverId: string;
  sessionId: string;
  /** The pane the reader is in: the task's origin, and a new assistant's cwd. */
  sourcePaneId: string;
  tabId?: string;
  cwd?: string;
}) {
  const { serverId, sessionId, sourcePaneId, tabId, cwd } = context;
  // Open is not the same as chosen. The strip can be up with nothing picked --
  // that is its resting state, and the composer stays an ordinary composer
  // until an assistant is selected, so opening it never hijacks a send.
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<AssignmentTarget | null>(null);
  /** A bundled instruction set, e.g. theme authoring, appended at send. */
  const [command, setCommand] = useState<AssignmentCommand | null>(null);
  const active = open && target !== null;

  const close = useCallback(() => {
    setOpen(false);
    setTarget(null);
    setCommand(null);
  }, []);

  /** Tapping the chosen assistant again clears it, rather than being a no-op. */
  const choose = useCallback((next: AssignmentTarget | null) => {
    setTarget((previous) => (previous && next && sameTarget(previous, next) ? null : next));
  }, []);

  const assign = useCallback(
    async (
      record: GatewayRecord,
      prompt: string,
      attachments: readonly PendingAttachment[],
      destination: AttachmentDestination,
      isCurrent: () => boolean
    ): Promise<AssignmentOutcome> => {
      if (!target) throw new Error('No assistant selected');
      if (!prompt.trim() && !command?.instructions) throw new Error('Nothing to send');
      // Assembled before anything is sent, so a queue that has drifted to
      // another destination fails here -- with the text still in the composer --
      // rather than after an assistant has been created to receive it.
      const text = attachmentCommandText(
        prompt,
        '',
        command?.instructions,
        attachments,
        destination
      );
      if (!isCurrent()) throw new Error('Destination changed');

      if (target.type === 'new') {
        const created = await spawnBoundAgent(
          record,
          sessionId,
          { agent: target.kind, cwd, tab_id: tabId, prompt: text },
          isCurrent
        );
        const outcome = collaborationSpawnOutcome(created);
        if (outcome !== 'sent')
          return { status: 'unconfirmed', paneId: created.paneId, reason: outcome };
        return {
          status: 'sent',
          task: record_(
            serverId,
            sessionId,
            sourcePaneId,
            created.paneId,
            target.kind,
            created.agentInstanceId,
            taskLabel(prompt, command)
          ),
        };
      }

      // A fresh read, and the instance it reports has to be the instance that
      // was chosen. An assistant that exited, restarted, or was replaced in its
      // pane fails here and the task is not sent to whoever took its place.
      const live = await loadAgents(sessionId);
      if (!isCurrent()) throw new Error('Destination changed');
      const agent = live.find((item) => (field(item, 'pane_id') || item.id) === target.paneId);
      if (!agent || field(agent, 'instance_id') !== target.instanceId)
        throw new Error('That assistant is no longer in that terminal');
      if (!canAssignToAgent(agent.status ?? 'unknown')) throw new Error('That assistant is busy');
      try {
        // The opaque target from the fresh read, never the captured one.
        await sendAgentText(sessionId, field(agent, 'target') || target.paneId, text);
      } catch {
        return { status: 'unconfirmed', paneId: target.paneId, reason: 'delivery-unconfirmed' };
      }
      return {
        status: 'sent',
        task: record_(
          serverId,
          sessionId,
          sourcePaneId,
          target.paneId,
          target.name,
          target.instanceId,
          taskLabel(prompt, command)
        ),
      };
    },
    [target, command, sessionId, cwd, tabId, serverId, sourcePaneId]
  );

  return { open, setOpen, close, target, choose, command, setCommand, active, assign };
}

/** What history shows for the task: the shortcut's name, then the reader's words. */
function taskLabel(prompt: string, command: AssignmentCommand | null): string {
  if (!command) return prompt;
  return prompt.trim() ? `${command.name}: ${prompt.trim()}` : command.name;
}

export function sameTarget(a: AssignmentTarget, b: AssignmentTarget): boolean {
  if (a.type !== b.type) return false;
  return a.type === 'new' && b.type === 'new'
    ? a.kind === b.kind
    : a.type === 'agent' && b.type === 'agent' && a.paneId === b.paneId;
}

/**
 * Written down even when the reader has navigated on: the assistant exists and
 * is working, and a history that omitted it because nobody was watching when it
 * answered would be the more surprising outcome.
 */
function record_(
  serverId: string,
  sessionId: string,
  sourcePaneId: string,
  paneId: string,
  agentName: string,
  agentInstanceId: string | undefined,
  prompt: string
): CollaborationTask {
  const task: CollaborationTask = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    serverId,
    sessionId,
    sourcePaneId,
    paneId,
    agentName,
    ...(agentInstanceId ? { agentInstanceId } : {}),
    prompt: prompt.trim(),
    createdAt: Date.now(),
  };
  useAgentCollaboration.getState().add(task);
  return task;
}
