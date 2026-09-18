import { selectableAgents, type AgentInfo, type ModelInfo, type ModelRef } from './agent-protocol';

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
 * Model and agent for a new session, each resolved on its own:
 *
 *   picked in this run -> remembered for this workspace -> remembered for this
 *   server -> nothing, i.e. the engine's own default.
 *
 * Per field, because the two are remembered per field: picking a model in a
 * workspace does not say anything about which agent belongs there. A remembered
 * value the catalog no longer lists falls through to the next step rather than
 * ending the chain.
 *
 * The model sheet's "Free only" segment has no say here. It is a view filter --
 * it decides which rows the reader scrolls past, not which models this app is
 * allowed to use -- so a remembered paid model is still what a new session
 * starts on while that filter is on.
 */
export function resolveNewSessionDefaults(input: NewSessionDefaultsInput): NewSessionDefaults {
  const { picked, workspace, server, models, agents } = input;
  const model =
    picked.model ??
    catalogModelRef(workspace?.model, models) ??
    catalogModelRef(server?.model, models);
  const agent =
    picked.agent ??
    catalogAgentId(workspace?.agent, agents) ??
    catalogAgentId(server?.agent, agents);
  return {
    ...(model ? { model } : {}),
    ...(agent ? { agent } : {}),
  };
}
