import { asRecord, type ToolPart } from './agent-protocol';
import { mcpFileAssets } from './mcp-file-reference';
import type { SessionAsset } from './session-assets';
import { TOOL_OUTPUT_BYTE_CAP, toolInputRecord } from './agent-tool-output';

import { muqunOperation, type MuqunOperation } from './internal-muqun-tools';
export type { MuqunOperation } from './internal-muqun-tools';
export type MuqunToolStatus =
  | 'calling'
  | 'started'
  | 'working'
  | 'queued'
  | 'waiting'
  | 'unconfirmed'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'returned'
  | 'unassigned'
  | 'unknown';

export interface MuqunToolPresentation {
  operation: MuqunOperation;
  files: SessionAsset[];
  status: MuqunToolStatus;
  /** Display only. Neither a name nor an unscoped task ID authorizes navigation. */
  machine?: string;
  taskId?: string;
  cwd?: string;
  command?: string;
  goal?: string;
  output?: string;
  error?: string;
  exitCode?: number;
  note?: string;
  timelineCount?: number;
  agents?: string;
  toolchains?: string;
  gatewayVersion?: string;
  machines: { id: string; label: string; os?: string; online?: boolean; unauthorized: boolean }[];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.slice(0, TOOL_OUTPUT_BYTE_CAP)
    : undefined;
}

/** Bounded transport unwrapping, never evaluation of tool-provided text. */
function resultRecord(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5) return null;
  if (typeof value === 'string') {
    if (value.length > TOOL_OUTPUT_BYTE_CAP) return null;
    try {
      return resultRecord(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  const record = asRecord(value);
  if (!record) return null;
  if (record.isError === true) {
    const blocks = Array.isArray(record.content) ? record.content.slice(0, 8) : [];
    const message = blocks
      .map((block) => text(asRecord(block)?.text))
      .filter(Boolean)
      .join('\n');
    const nested = resultRecord({ ...record, isError: false }, depth + 1);
    return { ...nested, error: nested?.error ?? text(nested?.message) ?? (message || true) };
  }
  if ('your_task' in record) {
    const own = resultRecord(record.your_task, depth + 1);
    return own ?? record;
  }
  if (
    'task_id' in record ||
    'state' in record ||
    'machines' in record ||
    'machineId' in record ||
    'error' in record
  )
    return record;
  if (record.structuredContent) return resultRecord(record.structuredContent, depth + 1);
  if (record.result) return resultRecord(record.result, depth + 1);
  if (Array.isArray(record.content)) {
    for (const item of record.content.slice(0, 8)) {
      const block = asRecord(item);
      if (block?.type === 'text') {
        const result = resultRecord(block.text, depth + 1);
        if (result) return result;
      }
    }
  }
  return null;
}

export function muqunToolPresentation(part: ToolPart): MuqunToolPresentation | null {
  const operation = muqunOperation(part.name);
  if (!operation) return null;
  const input = toolInputRecord(part.input) ?? toolInputRecord(part.input_partial) ?? {};
  const result = resultRecord(part.output) ?? resultRecord({ content: part.content });
  const binding = asRecord(result?.binding);
  const error = asRecord(result?.error);
  const pending =
    part.state === 'pending' || part.state === 'streaming' || part.state === 'running';
  const exitCode =
    typeof result?.exit_code === 'number' && Number.isSafeInteger(result.exit_code)
      ? result.exit_code
      : undefined;
  const errorText = text(part.error?.message) ?? text(error?.message) ?? text(result?.message);
  const failed =
    part.state === 'failed' ||
    Boolean(result?.error) ||
    result?.state === 'failed' ||
    (result?.state !== 'cancelled' && exitCode !== undefined && exitCode !== 0);
  let status: MuqunToolStatus = 'unknown';
  if (failed) status = 'failed';
  else if (pending) status = 'calling';
  else if (result?.state === 'done') status = 'done';
  else if (result?.state === 'cancelled') status = 'cancelled';
  else if (result?.state === 'waiting') status = 'waiting';
  else if (result?.state === 'idle_unconfirmed') status = 'unconfirmed';
  else if (result?.state === 'queued' || result?.state === 'dispatching') status = 'queued';
  else if (result?.state === 'working')
    status = operation === 'exec.run' || operation === 'tasks.delegate' ? 'started' : 'working';
  else if (result?.your_task === null) status = 'unassigned';
  else if (result && (operation.startsWith('fleet.') || Array.isArray(result.items)))
    status = 'returned';
  const command =
    operation === 'exec.run'
      ? text(input.command)
      : result?.kind === 'command'
        ? text(result.goal)
        : undefined;
  const goal = command ? undefined : (text(result?.goal) ?? text(input.goal));
  const items = Array.isArray(result?.items) ? result.items : undefined;
  const timelineOutput = items
    ?.slice(-8)
    .map((item) => text(asRecord(item)?.text))
    .filter(Boolean)
    .join('\n');
  const output =
    text(result?.stdout_tail) ??
    text(result?.answer) ??
    text(result?.summary) ??
    text(result?.progress) ??
    text(timelineOutput);
  const machines: MuqunToolPresentation['machines'] = [];
  const sourceMachines = Array.isArray(result?.machines)
    ? result.machines
    : result?.machineId
      ? [result]
      : [];
  for (const value of sourceMachines.slice(0, 50)) {
    const machine = asRecord(value);
    const id = text(machine?.machineId);
    const label = text(machine?.label);
    if (id && label)
      machines.push({
        id,
        label,
        os: text(machine?.os),
        online: typeof machine?.online === 'boolean' ? machine.online : undefined,
        unauthorized: machine?.state === 'unauthorized',
      });
  }
  return {
    operation,
    files: !pending && !failed ? mcpFileAssets(result) : [],
    status,
    machine: text(result?.machine) ?? text(binding?.peer_name) ?? text(input.machine),
    taskId: text(result?.task_id) ?? text(input.task_id),
    cwd: text(input.cwd),
    command,
    goal,
    output: output === command || output === goal ? undefined : output,
    error: failed ? (errorText ?? text(result?.error)) : undefined,
    exitCode,
    note: text(result?.note),
    timelineCount: items?.length,
    agents: namedVersions(result?.agents),
    toolchains: namedVersions(result?.toolchains),
    gatewayVersion: text(result?.gatewayVersion),
    machines,
  };
}

function namedVersions(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const labels = value.slice(0, 16).flatMap((entry) => {
    const row = asRecord(entry);
    const id = text(row?.id);
    return id ? [[id, text(row?.version)].filter(Boolean).join(' ')] : [];
  });
  return labels.length ? labels.join(' · ') : undefined;
}
