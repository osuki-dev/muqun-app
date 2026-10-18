/**
 * Home's dock: which computer a typed goal goes to, which agent starts it,
 * and what the new session is created with.
 *
 * Pure, so the rules are pinned by Bun tests; `home-composer-dock.tsx` is the
 * view, and it hosts the session screen's own `AgentComposer`.
 */

import type { AgentClientCommandId } from '@/lib/agent-commands';
import type { AgentFeatures } from '@/lib/agent-protocol';
import type { CatalogDefaults, ModeInfo, ModelInfo, ModelRef } from '@/lib/agent-session';
import {
  catalogModeId,
  catalogModelRef,
  firstUsableModel,
  usableCatalogDefaultModel,
  type RememberedAgentChoice,
} from '@/lib/agent-session-defaults';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { keepKeys } from '@/lib/keep-keys';
import type { AgentReadiness } from '@/lib/home-agent-readiness';
import type { ServerReachability } from '@/lib/server-reachability';

type Reachability = Readonly<Record<string, ServerReachability | undefined>>;

export type HomeComposerTarget =
  /** Send starts a session here. */
  | { kind: 'ready'; server: GatewayRecord }
  /** The chosen computer is not answering; send opens the target picker instead. */
  | { kind: 'offline'; server: GatewayRecord }
  /** Nothing paired is reachable: the bar says so and send is disabled. */
  | { kind: 'none' };

function reachabilityOf(reachability: Reachability, serverId: string): ServerReachability {
  return reachability[serverId] ?? 'unknown';
}

/**
 * Where a goal goes. The chosen computer when there is one (the selection, or
 * the only one paired), else the first computer that may answer -- `live`
 * before `unknown`. A computer that is `offline` is never picked on its own,
 * and when every computer is offline there is no target at all.
 */
export function resolveHomeComposerTarget(input: {
  servers: readonly GatewayRecord[];
  chosen?: GatewayRecord;
  reachabilityByServer: Reachability;
}): HomeComposerTarget {
  const { servers, chosen, reachabilityByServer } = input;
  const reachable = servers.filter(
    (server) => reachabilityOf(reachabilityByServer, server.serverId) !== 'offline'
  );
  if (reachable.length === 0) return { kind: 'none' };
  if (chosen) {
    return reachabilityOf(reachabilityByServer, chosen.serverId) === 'offline'
      ? { kind: 'offline', server: chosen }
      : { kind: 'ready', server: chosen };
  }
  const first =
    reachable.find((server) => reachabilityOf(reachabilityByServer, server.serverId) === 'live') ??
    reachable[0]!;
  return { kind: 'ready', server: first };
}

/**
 * The gateway session Home's new agent sessions are made under: the one the
 * `/agent` route and the Pad detail default to when a link names none, so the
 * session Home starts is the session those screens then open.
 */
export const HOME_AGENT_SESSION_ID = 'herdr';

/**
 * The app's own `/` commands Home leaves out: every one of them acts on a
 * session that exists (undo, compact, export...) or on the session screen's own
 * sheets. `/models` stays, because Home has the model picker -- unless the
 * agent cannot switch models at all.
 */
export function homeHiddenClientCommands(
  features: Pick<AgentFeatures, 'modelSelection'>
): AgentClientCommandId[] {
  const hidden: AgentClientCommandId[] = [
    'new',
    'sessions',
    'agents',
    'undo',
    'keep',
    'compact',
    'clear',
    'export',
  ];
  if (!features.modelSelection) hidden.push('models');
  return hidden;
}

/**
 * What a goal sent from Home is created with, and what the dock's mode and
 * model pills name.
 *
 * Only the reader's own pick in the dock is sent, remembered per computer
 * and agent (`homeModelChoiceKey`): a pick the catalog no longer offers is
 * dropped, and a picked mode that names its own model brings it. Before any
 * pick the pills name a model chosen by the refused-aware fallback, and that
 * model is what is sent: the pill and the request never disagree.
 * The agent is named only on a gateway that has said which agents it drives;
 * an older gateway has one and no `agent_id` to read.
 */
export function homeSessionParams(input: {
  picked: RememberedAgentChoice;
  catalogDefaults: CatalogDefaults;
  models: readonly ModelInfo[];
  modes: readonly ModeInfo[];
  agentId?: string;
  agentsDiscovered: boolean;
  /** Models this server already refused (`unsupportedModelRefs`), when its sessions are known. */
  refused?: ReadonlySet<string>;
  /**
   * False until the catalog has answered (or when its read failed): the
   * remembered pick is then sent and shown as stored, since there is nothing
   * to check it against yet and dropping it would let the host pick.
   */
  catalogRead?: boolean;
}): {
  params: { mode?: string; model?: ModelRef; agentId?: string };
  shown: { mode?: string; model?: ModelRef };
} {
  const { picked, catalogDefaults, models, modes } = input;
  const agent = input.agentsDiscovered && input.agentId ? { agentId: input.agentId } : {};
  if (input.catalogRead === false) {
    const stored = {
      ...(picked.mode ? { mode: picked.mode } : {}),
      ...(picked.model ? { model: picked.model } : {}),
    };
    return { params: { ...stored, ...agent }, shown: stored };
  }
  const mode = catalogModeId(picked.mode, modes);
  const modeModel = modes.find((entry) => entry.id === mode)?.model;
  const model = catalogModelRef(picked.model, models) ?? catalogModelRef(modeModel, models);
  const shownMode = mode ?? catalogModeId(catalogDefaults.mode, modes);
  // With nothing picked the model is still sent, and it is the one the pill
  // names: the shown mode's own model, else the host's default unless this
  // server refused it, else the first usable model in the catalog. Omitting
  // it would let OpenCode fall back to list order, which a host can refuse
  // on every turn (`resolveNewSessionDefaults`). The mode stays pick-only:
  // OpenCode's agent fallback is its primary agent, a real default.
  const refused = input.refused ?? new Set<string>();
  const shownModeModel = modes.find((entry) => entry.id === shownMode)?.model;
  const shownModel =
    model ??
    catalogModelRef(shownModeModel, models) ??
    catalogModelRef(usableCatalogDefaultModel(catalogDefaults.model, refused), models) ??
    firstUsableModel(models, refused);
  return {
    params: {
      ...(mode ? { mode } : {}),
      ...(shownModel ? { model: shownModel } : {}),
      ...agent,
    },
    shown: {
      ...(shownMode ? { mode: shownMode } : {}),
      ...(shownModel ? { model: shownModel } : {}),
    },
  };
}

/**
 * Whether a goal may go out with the model the dock has: never with none, on
 * an agent that takes one (an empty model lets the host run its own default,
 * which on these machines is OpenRouter). A remembered pick or a read catalog
 * is enough; otherwise Send waits for the catalog, and says so when its read
 * failed rather than sending unpinned.
 */
export function homeSendModelGate(input: {
  /** The agent takes a model choice (`modelSelection`). */
  choosesModel: boolean;
  /** The model the send would carry (`homeSessionParams(...).params.model`). */
  model: ModelRef | undefined;
  catalogRead: boolean;
  catalogFailed: boolean;
}): 'send' | 'wait' | 'failed' {
  if (!input.choosesModel || input.model || input.catalogRead) return 'send';
  return input.catalogFailed ? 'failed' : 'wait';
}

/**
 * The computer the dock sends to: the one the reader picked (in the target
 * picker, by tapping a card, or kept while work elsewhere was opened), else
 * the selected one, else the only one. Opening a task on another computer
 * selects that computer for its screen; the dock keeps the one it had,
 * because Home pins it first (A4 D3).
 */
export function homeDockTargetId(input: {
  serverIds: readonly string[];
  pickedId?: string | null;
  selectedId?: string;
}): string | undefined {
  const { serverIds, pickedId, selectedId } = input;
  if (pickedId && serverIds.includes(pickedId)) return pickedId;
  if (selectedId && serverIds.includes(selectedId)) return selectedId;
  return serverIds.length === 1 ? serverIds[0] : undefined;
}

/** Where a dock pick of mode and model is remembered: one computer's one agent. */
export function homeModelChoiceKey(serverId: string, agentId: string | undefined): string {
  return `${serverId}\u0000${agentId ?? ''}`;
}

/** The dock picks of the computers in `serverIds` only (the rest were unpaired). */
export function keepHomeModelChoices<T>(
  choices: Record<string, T>,
  serverIds: readonly string[]
): Record<string, T> {
  const kept = new Set(serverIds);
  return keepKeys(choices, (key) => kept.has(key.slice(0, key.indexOf('\u0000'))));
}

/** The persisted `{ [homeModelChoiceKey]: { model?, mode? } }`, dropping anything malformed. */
export function parseHomeModelChoices(
  value: string | null | undefined
): Record<string, RememberedAgentChoice> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, RememberedAgentChoice> = {};
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const { model, mode } = entry as { model?: Partial<ModelRef>; mode?: unknown };
      const ref =
        model && typeof model.provider_id === 'string' && typeof model.model_id === 'string'
          ? {
              provider_id: model.provider_id,
              model_id: model.model_id,
              ...(typeof model.variant === 'string' ? { variant: model.variant } : {}),
            }
          : undefined;
      const choice = {
        ...(ref ? { model: ref } : {}),
        ...(typeof mode === 'string' && mode ? { mode } : {}),
      };
      if (choice.model || choice.mode) out[key] = choice;
    }
    return out;
  } catch {
    return {};
  }
}

export type HomeSessionParams = ReturnType<typeof homeSessionParams>['params'];

/** A session Home made for a send whose act (prompt, command, skill) did not land. */
export interface HomeStartedSession {
  /** The computer and agent it was made on. */
  key: string;
  asid: string;
  /** Where the gateway put it, and the agent it says owns it, for opening it. */
  directory?: string;
  sessionAgentId?: string;
  /** What it was created with, or last switched to. */
  params: HomeSessionParams;
}

function sameModel(a: ModelRef | undefined, b: ModelRef | undefined): boolean {
  return (
    a?.provider_id === b?.provider_id && a?.model_id === b?.model_id && a?.variant === b?.variant
  );
}

/**
 * Whether the next Send makes a session or goes to the one a failed send left.
 *
 * Reused only on the same computer and agent, so retries do not pile up empty
 * sessions; a mode or model changed on the pills since is switched on it first,
 * as the workbench does for a session that exists.
 */
export function homeSessionReuse(
  started: HomeStartedSession | null,
  key: string,
  params: HomeSessionParams
):
  | { kind: 'create' }
  | { kind: 'reuse'; started: HomeStartedSession; switchMode?: string; switchModel?: ModelRef } {
  if (!started || started.key !== key) return { kind: 'create' };
  const switchMode = params.mode && params.mode !== started.params.mode ? params.mode : undefined;
  const switchModel =
    params.model && !sameModel(params.model, started.params.model) ? params.model : undefined;
  return {
    kind: 'reuse',
    started,
    ...(switchMode ? { switchMode } : {}),
    ...(switchModel ? { switchModel } : {}),
  };
}

/**
 * Where a failed create goes: the agent setup guide when the agent is not
 * ready (not installed, needs setup or an update, offline), the same sheet a
 * launch tile opens -- with `origin=home`, so its "Open" comes back to the
 * dock and the draft rather than to an empty session. `null` when the agent
 * is ready, and the failure is the request's own to explain.
 */
export function homeGuideParams(
  readiness: AgentReadiness,
  server: { serverId: string; label?: string }
): Record<string, string> | null {
  if (readiness.status === 'ready') return null;
  return {
    serverId: server.serverId,
    ...(server.label ? { label: server.label } : {}),
    agentId: readiness.agentId,
    status: readiness.status,
    ...(readiness.status === 'offline' ? { cause: readiness.cause } : {}),
    origin: 'home',
  };
}

/**
 * The model as `POST /api/tasks` names it: `provider_id/model_id`, or the
 * bare catalog id. The variant travels beside it as `variant`.
 */
export function ledgerModelId(model: ModelRef): string {
  return model.provider_id ? `${model.provider_id}/${model.model_id}` : model.model_id;
}

/**
 * Whether the selected record is still the computer a send started on: the
 * same id, address and transport key. Not object identity -- the connection
 * store republishes an unchanged record (a reachability update) mid-send.
 */
export function sameComputer(
  current: Pick<GatewayRecord, 'serverId' | 'url' | 'transportKey'> | null | undefined,
  owner: Pick<GatewayRecord, 'serverId' | 'url' | 'transportKey'> | null | undefined
): boolean {
  if (!current || !owner) return false;
  return (
    current.serverId === owner.serverId &&
    current.url === owner.url &&
    current.transportKey === owner.transportKey
  );
}

/**
 * The folder a pick sets for a computer: the path as typed or chosen, `~`
 * for the home directory picked on purpose, or `undefined` for nothing
 * picked, which sends no folder (the gateway uses the device's last one).
 */
export function homeFolderPick(directory: string): string | undefined {
  const path = directory.trim();
  if (!path) return undefined;
  if (/^~\/*$/.test(path)) return '~';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * The bar's folder segment for a picked folder: its basename (design §6 names
 * a folder by basename), `/` for the root.
 */
export function homeFolderLabel(folder: string): string {
  const trimmed = folder.replace(/\/+$/, '');
  if (!trimmed) return '/';
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed;
}

/**
 * What the folder segment and the picker's first row say: the folder picked,
 * else the one the gateway reports it will use, by basename; the home
 * directory in words, as `~` alone reads as a glyph. `last` is only for a
 * gateway that cannot say where it will run.
 */
export function homeFolderName(
  folder: string | undefined,
  words: { last: string; home: string }
): string {
  if (!folder) return words.last;
  return folder === '~' ? words.home : homeFolderLabel(folder);
}

/** The persisted `{ [serverId]: folder }`, dropping anything that is not one. */
export function parseHomeFolders(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [serverId, folder] of Object.entries(parsed)) {
      const path = typeof folder === 'string' ? homeFolderPick(folder) : undefined;
      if (path) out[serverId] = path;
    }
    return out;
  } catch {
    return {};
  }
}
