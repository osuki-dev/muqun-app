import { asRecord, type AgentSessionInfo, type ToolPart } from './agent-protocol';
import { stripSubagentEnvelope, toolInputRecord } from './agent-tool-output';

/** Activity notifications carry identity/status, not the child's transcript.
 * Only returned content/output is a result; a supplied prompt remains a prompt.
 */
export function subagentInlineContent(input: unknown, outputText: string) {
  const result = stripSubagentEnvelope(outputText);
  const argumentsRecord = toolInputRecord(input);
  const prompt = typeof argumentsRecord?.prompt === 'string' ? argumentsRecord.prompt.trim() : '';
  return { ...result, prompt };
}

export type SubagentAction =
  | 'start'
  | 'send'
  | 'resume'
  | 'wait'
  | 'close'
  | 'interrupt'
  | 'followup'
  | 'list'
  | 'started'
  | 'interacted'
  | 'completed'
  | 'interrupted';
export type SubagentState =
  | 'starting'
  | 'working'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'blocked'
  | 'unknown'
  | 'retrying'
  | 'unavailable';

const ACTIONS: Partial<Record<string, SubagentAction>> = {
  spawnAgent: 'start',
  spawn: 'start',
  sendInput: 'send',
  sendMessage: 'send',
  send: 'send',
  resumeAgent: 'resume',
  resume: 'resume',
  wait: 'wait',
  closeAgent: 'close',
  close: 'close',
  interruptAgent: 'interrupt',
  interrupt: 'interrupt',
  followupTask: 'followup',
  listAgents: 'list',
};
const ACTIVITIES: Partial<Record<string, SubagentAction>> = {
  started: 'started',
  interacted: 'interacted',
  completed: 'completed',
  interrupted: 'interrupted',
};
const STATES: Partial<Record<string, SubagentState>> = {
  starting: 'starting',
  working: 'working',
  busy: 'working',
  idle: 'idle',
  completed: 'completed',
  failed: 'failed',
  interrupted: 'stopped',
  shutdown: 'stopped',
  blocked: 'blocked',
  unknown: 'unknown',
  retry: 'retrying',
  notFound: 'unavailable',
};
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** A call completing never supplies the child's state. */
export function subagentSessionState(session: AgentSessionInfo): SubagentState {
  return STATES[session.runtime?.status ?? session.status] ?? 'unknown';
}

export function subagentPresentation(
  part: ToolPart,
  child?: AgentSessionInfo,
  envelopeState?: string
) {
  const observed = child?.asid === part.child_session_id ? child : undefined;
  const input = asRecord(part.input);
  const action =
    ACTIONS[text(input?.operation) ?? ''] ?? ACTIVITIES[text(part.metadata.kind) ?? ''];
  const identity =
    text(observed?.agent_name) ??
    text(part.metadata.agentPath) ??
    text(input?.agent) ??
    text(input?.agentID) ??
    text(input?.agent_id);
  const summary =
    text(input?.description) ?? text(input?.prompt)?.split('\n')[0] ?? text(observed?.title);
  const title = identity ?? text(part.title) ?? summary ?? part.child_session_id ?? '';
  const caption = [
    ...new Set(
      [text(observed?.agent_role), summary].filter(
        (value): value is string => Boolean(value) && value !== title
      )
    ),
  ].join(' · ');
  const historical = text(part.metadata.status) ?? envelopeState;
  const state = observed
    ? subagentSessionState(observed)
    : historical
      ? (STATES[historical] ?? 'unknown')
      : undefined;
  return { title, caption, action, state };
}
