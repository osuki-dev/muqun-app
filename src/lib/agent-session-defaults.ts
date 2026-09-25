import {
  isFreeModel,
  selectableAgents,
  type AgentInfo,
  type AgentSessionInfo,
  type CatalogDefaults,
  type ModelInfo,
  type ModelRef,
} from './agent-protocol';
import { isUnsupportedModelFailure } from './agent-engine-text';

/**
 * What a new session starts on.
 *
 * Omitting `model` on `POST /api/agent-sessions` is the documented way to get
 * the user's own configured default, so this app sends a model only when it
 * has one the *reader* chose. That used to mean "chose in this app run":
 * relaunch the app, or simply never open the picker, and the next session went
 * back to the engine's default even though the reader had been working on one
 * model all week. Remembering the last choice is what turns the engine default
 * into a starting point rather than a permanent home.
 *
 * Pure, and separate from where the memory is kept (`agent-model-memory.ts`),
 * so the precedence -- and the catalog check that keeps a vanished model from
 * being sent -- can be read and tested without a native store.
 */

/** One remembered pick: the model, the agent, or both. */
export interface RememberedAgentChoice {
  model?: ModelRef;
  agent?: string;
}

/** What the store remembers for the server a screen is looking at. */
export interface RememberedAgentDefaults {
  /** The last pick made in this workspace directory on this server. */
  workspace?: RememberedAgentChoice;
  /** The last pick made anywhere on this server, for a workspace never used. */
  server?: RememberedAgentChoice;
}

export interface NewSessionDefaultsInput {
  /**
   * What the reader picked in this app run, and only that: a display fallback
   * sent as a real field is not a default, it is this app overriding the host.
   */
  picked: RememberedAgentChoice;
  workspace?: RememberedAgentChoice;
  server?: RememberedAgentChoice;
  /**
   * The root sessions this server holds, newest-updated first or in any order.
   *
   * What the reader has actually been running, for a device that has the
   * sessions but not the memory -- a fresh install, a reinstall, or a reader
   * who has been using the same host from their laptop. Roots only: a subagent
   * session runs whatever its parent handed it and is not a choice anybody
   * made.
   */
  sessions?: readonly AgentSessionInfo[];
  /**
   * The workspace the new session is for, which splits `sessions` into the ones
   * in it and the rest.
   */
  directory?: string;
  /** The catalog's own `defaults`, i.e. what the host says it prefers. */
  catalogDefaults?: CatalogDefaults;
  /**
   * Every model the current catalog lists. A remembered model is checked
   * against it, so a model that was removed -- or whose provider is no longer
   * configured -- is dropped rather than sent to a host that would refuse it.
   *
   * Empty means the catalog has not been read yet (or the host did not answer),
   * which verifies nothing: remembered values are dropped and the session gets
   * the engine default, rather than this app guessing on a list it does not
   * have.
   */
  models: readonly ModelInfo[];
  /** Every agent the current catalog lists, read the same way. */
  agents: readonly AgentInfo[];
}

/** What `POST /api/agent-sessions` carries, minus the directory. */
export interface NewSessionDefaults {
  model?: ModelRef;
  agent?: string;
}

/**
 * The remembered model, if the catalog still lists it.
 *
 * A variant the catalog no longer publishes costs the model its variant and
 * nothing more -- "the thinking variant went away" is not a reason to fall back
 * to a different model altogether. A model marked `enabled: false` is one the
 * host has switched off: the sheet greys it out, and sending it would surface
 * as an unexplained failed turn.
 */
export function catalogModelRef(
  ref: ModelRef | undefined,
  models: readonly ModelInfo[]
): ModelRef | undefined {
  if (!ref?.model_id || !ref.provider_id) return undefined;
  const entry = models.find(
    (model) => model.id === ref.model_id && model.provider_id === ref.provider_id
  );
  if (!entry || entry.enabled === false) return undefined;
  const base: ModelRef = { provider_id: ref.provider_id, model_id: ref.model_id };
  if (!ref.variant) return base;
  const listed = entry.variants?.some((variant) => variant.id === ref.variant) ?? false;
  return listed ? { ...base, variant: ref.variant } : base;
}

/** The remembered agent, if the catalog still offers it as a choice. */
export function catalogAgentId(
  agent: string | undefined,
  agents: readonly AgentInfo[]
): string | undefined {
  if (!agent) return undefined;
  return selectableAgents(agents).some((entry) => entry.id === agent) ? agent : undefined;
}

/**
 * Which agent row a picker marks as the one already answering.
 *
 * The reader's own pick when they have made one, the host's default when they
 * have not, and `build` when the catalog stated neither -- the same order a
 * session create is sent in, so the marked row is the agent the next turn will
 * actually run. A project-defined agent is nothing special here: once the
 * catalog was read with the workspace's directory it is an id like any other,
 * and a session whose `agent` is `osuki-coder` marks `osuki-coder`.
 */
export function effectiveAgentId(selected?: string, catalogDefault?: string): string {
  const picked = selected?.trim();
  if (picked) return picked;
  const fallback = catalogDefault?.trim();
  return fallback ? fallback : 'build';
}

/**
 * The model and agent of the sessions that ran most recently.
 *
 * Read per field and newest first, so a session that has a model but no agent
 * does not stop the agent from being answered by the session under it. A
 * session whose last turn failed *on its model* is skipped: that failure is
 * proof the model does not work here, and copying it forward would hand the
 * next session the same broken start.
 */
export function recentSessionChoice(
  sessions: readonly AgentSessionInfo[],
  directory?: string
): RememberedAgentChoice {
  const ordered = [...sessions].sort((a, b) => (b.updated_ms ?? 0) - (a.updated_ms ?? 0));
  let model: ModelRef | undefined;
  let agent: string | undefined;
  for (const session of ordered) {
    if (directory !== undefined && session.directory !== directory) continue;
    if (isUnsupportedModelFailure(session.error?.message ?? '')) continue;
    if (!model && session.model) model = session.model;
    if (!agent && session.agent) agent = session.agent;
    if (model && agent) break;
  }
  return {
    ...(model ? { model } : {}),
    ...(agent ? { agent } : {}),
  };
}

/** One model ref as a key, so two lists of them can be compared. */
function modelRefKey(ref: ModelRef): string {
  return `${ref.provider_id ?? ''}\u0000${ref.model_id}`;
}

/**
 * The models this server has already refused, in its own words.
 *
 * `recentSessionChoice` skips a session whose last turn died on its model, so
 * a broken model is never *copied* from one session to the next. The catalog's
 * own `defaults` came in under none of that, and on a host with no default
 * configured OpenCode answers with the first entry of its model list -- which
 * on this server is `opencode/jev-latest`, a model the same server then
 * refuses with "Model jev-latest is not supported". Every new session started
 * on it and every first turn died.
 *
 * So the sessions are read a second time, for the opposite fact: not which
 * model to carry forward, but which one this server has already said it cannot
 * run. Evidence from the host, not a list of bad names kept in the app.
 */
export function unsupportedModelRefs(sessions: readonly AgentSessionInfo[]): Set<string> {
  const refused = new Set<string>();
  for (const session of sessions) {
    if (!session.model) continue;
    if (isUnsupportedModelFailure(session.error?.message ?? '')) {
      refused.add(modelRefKey(session.model));
    }
  }
  return refused;
}

/**
 * The host's own default, unless the host has already refused it.
 *
 * The rung stays: what a host prefers is worth more than anything this app
 * could guess. A preference that has been tried and refused is not a
 * preference, though -- it is a failed turn waiting to happen -- so it falls
 * through to the next rung rather than ending the chain.
 */
function usableCatalogDefaultModel(
  ref: ModelRef | undefined,
  refused: ReadonlySet<string>
): ModelRef | undefined {
  if (!ref) return undefined;
  return refused.has(modelRefKey(ref)) ? undefined : ref;
}

/**
 * Something the host can actually run, when nothing else answered.
 *
 * Free first, and only then the first enabled model whatever it charges: this
 * is the one rung the reader did not choose, so it should be the one that
 * cannot cost them anything. Paid is still better than the alternative, which
 * is not a default at all -- see `resolveNewSessionDefaults`.
 *
 * `refused` is what this server has already said it cannot run. A guess is the
 * one thing that must not repeat a known failure: falling through rung 6 only
 * to hand back the same refused model one rung later would fix nothing.
 */
export function firstUsableModel(
  models: readonly ModelInfo[],
  refused: ReadonlySet<string> = new Set()
): ModelRef | undefined {
  const usable = models.filter(
    (model) =>
      model.enabled !== false &&
      !refused.has(modelRefKey({ provider_id: model.provider_id, model_id: model.id }))
  );
  const pick = usable.find((model) => isFreeModel(model)) ?? usable[0];
  return pick ? { provider_id: pick.provider_id, model_id: pick.id } : undefined;
}

/**
 * Model and agent for a new session. An agent's configured model takes
 * precedence over remembered model choices from other agents:
 *
 *   1. picked in this run
 *   2. configured on the selected agent (model only)
 *   3. remembered for this workspace
 *   4. remembered for this server
 *   5. the newest session in this workspace
 *   6. the newest session anywhere on this server
 *   7. the catalog's own `defaults`, unless this server has already refused it
 *   8. the first enabled free model in the catalog (model only)
 *   9. nothing, and only when the catalog lists nothing to send
 *
 * Per field, because the two are chosen per field: picking a model in a
 * workspace does not say anything about which agent belongs there. A value the
 * catalog no longer lists falls through to the next rung rather than ending the
 * chain.
 *
 * The fallback rungs exist because omitting `model` is not always safe.
 * The contract calls it "the user's configured default", but a host with none
 * configured answers `GET /api/model/default` with `null`, and OpenCode then
 * falls back to the *first entry of its model list* -- list order, not a sane
 * default. On the host that found this, that entry was `opencode/jev-latest`,
 * which OpenCode itself then refuses: every turn died with "Model jev-latest is
 * not supported" and nothing on screen connected that to a model nobody had
 * chosen. So this app omits `model` only when the catalog gives it nothing to
 * send; with even one enabled model listed, sending the app's own worst guess
 * beats letting list order pick.
 *
 * The agent has no rung 7 and is allowed to be omitted: OpenCode's fallback
 * there is its primary agent, which is a real default rather than whatever
 * sorted first.
 *
 * The model sheet's "Free only" segment has no say in any of this. It is a view
 * filter -- it decides which rows the reader scrolls past, not which models this
 * app is allowed to use -- so a remembered paid model is still what a new
 * session starts on while that filter is on. It is only rung 7, the guess
 * nobody made, that prefers free.
 */
export function resolveNewSessionDefaults(input: NewSessionDefaultsInput): NewSessionDefaults {
  const { picked, workspace, server, models, agents, catalogDefaults } = input;
  const sessions = input.sessions ?? [];
  const here = recentSessionChoice(sessions, input.directory);
  const anywhere = recentSessionChoice(sessions);
  const refused = unsupportedModelRefs(sessions);
  const agent =
    picked.agent ??
    catalogAgentId(workspace?.agent, agents) ??
    catalogAgentId(server?.agent, agents) ??
    catalogAgentId(here.agent, agents) ??
    catalogAgentId(anywhere.agent, agents) ??
    catalogAgentId(catalogDefaults?.agent, agents);
  const agentModel = agents.find((entry) => entry.id === agent)?.model;
  const model =
    picked.model ??
    catalogModelRef(agentModel, models) ??
    catalogModelRef(workspace?.model, models) ??
    catalogModelRef(server?.model, models) ??
    catalogModelRef(here.model, models) ??
    catalogModelRef(anywhere.model, models) ??
    catalogModelRef(usableCatalogDefaultModel(catalogDefaults?.model, refused), models) ??
    firstUsableModel(models, refused);
  return {
    ...(model ? { model } : {}),
    ...(agent ? { agent } : {}),
  };
}
