/**
 * The permission menu a pane is blocked on, and the rules for answering it.
 *
 * An agent asks for permission by drawing a numbered menu and waiting. The
 * gateway reads that menu off the pane and publishes it three ways -- a GET, an
 * `approval.pending` event, and a push notification -- all carrying the same
 * envelope. This module is the one place that turns any of them into a value
 * the app can render, plus the reducer that decides what the banner shows next.
 *
 * Three rules govern everything here, because answering the wrong question is
 * worse than not answering at all:
 *
 * 1. **The fingerprint is the identity.** It pins one question with one set of
 *    answers. An answer carries the fingerprint it was read with, so a menu
 *    that changed underneath is rejected by the gateway rather than answered
 *    blind. An event about a fingerprint the app never showed is not about the
 *    menu on screen.
 * 2. **A rejected answer is never retried.** `409` means the app's picture is
 *    stale; the only correct response is to re-read, not to send again.
 * 3. **A gateway that cannot do this shows nothing.** Approvals arrived in
 *    gateway 0.5.0 behind the `pane_approvals` capability. Against anything
 *    older there is no banner, no poll and no error -- the feature simply is
 *    not there.
 *
 * Kept free of React and of transport so the whole contract is a pure function
 * of one JSON envelope plus a sequence of events.
 */

/** The gateway capability that gates every part of this feature. */
export const PANE_APPROVALS_CAPABILITY = 'pane_approvals';

/**
 * What answering an option would mean, as the gateway read it off the answer's
 * own wording. `other` is an answer only its index describes.
 */
export type ApprovalDecision = 'allow' | 'allow_always' | 'deny' | 'other';

/** A decision a client may ask for by name instead of by option number. */
export type NamedApprovalDecision = Exclude<ApprovalDecision, 'other'>;

const DECISIONS: readonly ApprovalDecision[] = ['allow', 'allow_always', 'deny', 'other'];

export interface ApprovalOption {
  /** The number the agent printed, which is also what selects it. */
  index: number;
  /** The answer verbatim, as the agent worded it. */
  label: string;
  /** Whether the agent's cursor is on this answer. */
  selected: boolean;
  decision: ApprovalDecision;
}

export interface PaneApproval {
  /** Stable identity of this question with these answers. */
  fingerprint: string;
  prompt: string;
  /** The tool the request is about, when the agent named one. */
  tool: string | null;
  /** The lines the agent drew around the question: command, file, diff. */
  context: string[];
  /** The agent's key-hint footer, when it drew one. */
  hint: string | null;
  options: ApprovalOption[];
}

/** One pane's approval state, the shape both the endpoint and the events carry. */
export interface PaneApprovalState {
  sessionId: string;
  paneId: string;
  /** Null when the pane is not waiting on anything. */
  approval: PaneApproval | null;
}

/** What the POST answers with once the keystrokes have been sent. */
export interface PaneApprovalAnswer extends PaneApprovalState {
  /** True when the menu the answer named is no longer standing. */
  resolved: boolean;
}

/**
 * Why the gateway refused an answer. Both are `409`, and both mean the same
 * thing to the app: what it was looking at is not what the pane is waiting on.
 */
export type ApprovalConflictCode =
  | 'approval_changed'
  | 'approval_not_pending'
  | 'decision_unavailable';

export function isApprovalConflictCode(value: unknown): value is ApprovalConflictCode {
  return (
    value === 'approval_changed' ||
    value === 'approval_not_pending' ||
    value === 'decision_unavailable'
  );
}

/**
 * A gateway that predates approvals never gets asked for one. The capability
 * list is the gateway's own answer; guessing from a version string would make
 * every future build a special case.
 */
export function gatewaySupportsApprovals(capabilities: string[] | undefined | null): boolean {
  return Array.isArray(capabilities) && capabilities.includes(PANE_APPROVALS_CAPABILITY);
}

/**
 * Read one approval envelope -- from the endpoint, from an SSE frame, or from
 * anything else that carries the same `data`.
 *
 * Returns null for anything that is not recognisably one, which is how an older
 * or unexpected payload degrades to "no banner" instead of to a broken one.
 */
export function paneApprovalFromResponse(value: unknown): PaneApprovalState | null {
  const data = envelopeData(value);
  if (!data) return null;

  const sessionId = stringField(data.session_id);
  const paneId = stringField(data.pane_id);
  if (!paneId) return null;

  // `state` is authoritative: a payload that says "idle" is idle even if a
  // stale `approval` object rode along with it.
  const pending = data.state === 'pending';
  const approval = pending ? approvalFromValue(data.approval) : null;
  return { sessionId, paneId, approval };
}

/** The POST response: an approval state plus whether the answer took. */
export function paneApprovalAnswerFromResponse(value: unknown): PaneApprovalAnswer | null {
  const state = paneApprovalFromResponse(value);
  if (!state) return null;
  const data = envelopeData(value);
  // A gateway that does not say either way is trusted only when the menu it
  // reports back is gone: that is the same evidence `resolved` is derived from.
  const resolved = typeof data?.resolved === 'boolean' ? data.resolved : state.approval === null;
  return { ...state, resolved };
}

function envelopeData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  // The events carry the same envelope, but a future transport that hands over
  // the inner object directly should still parse.
  return 'pane_id' in record || 'approval' in record ? record : null;
}

function approvalFromValue(value: unknown): PaneApproval | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const fingerprint = stringField(raw.fingerprint);
  const options = Array.isArray(raw.options)
    ? raw.options.map(optionFromValue).filter((option): option is ApprovalOption => option !== null)
    : [];
  // Without a fingerprint an answer cannot be made safe, and without at least
  // two answers there is no choice to offer. Either way there is nothing to
  // render, so this is not a menu the app will show.
  if (!fingerprint || options.length < 2) return null;

  return {
    fingerprint,
    prompt: stringField(raw.prompt),
    tool: stringField(raw.tool) || null,
    context: Array.isArray(raw.context)
      ? raw.context.filter((line): line is string => typeof line === 'string')
      : [],
    hint: stringField(raw.hint) || null,
    options,
  };
}

function optionFromValue(value: unknown): ApprovalOption | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const index = typeof raw.index === 'number' && Number.isInteger(raw.index) ? raw.index : null;
  const label = stringField(raw.label);
  if (index === null || index < 1 || !label) return null;
  // A decision this build has no name for is still answerable by its index, so
  // it degrades to `other` rather than dropping the option off the menu.
  const decision = DECISIONS.find((entry) => entry === raw.decision) ?? 'other';
  return { index, label, selected: raw.selected === true, decision };
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The option a named decision resolves to, preferring the lowest-numbered
 * match so "allow" means the one-time allow rather than a blanket one -- the
 * same rule the gateway applies, kept here so the banner can label a button
 * before any request is made.
 */
export function optionForDecision(
  approval: PaneApproval,
  decision: NamedApprovalDecision
): ApprovalOption | null {
  return approval.options.find((option) => option.decision === decision) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Push notifications                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The category the gateway tags an approval push with. The app registers its
 * action buttons under exactly this id; anything else is an ordinary push.
 */
export const APPROVAL_PUSH_CATEGORY_ID = 'approval';

/**
 * One button a push may offer. The label is the gateway's own wording, never
 * the agent's: an agent's answer routinely quotes a command or a path, and none
 * of that may leave the host in a notification.
 */
export interface ApprovalPushOption {
  index: number;
  decision: ApprovalDecision;
  label: string;
}

/** Everything a notification action needs to answer without opening a screen. */
export interface ApprovalPushTarget {
  serverId: string;
  sessionId: string;
  paneId: string;
  fingerprint: string;
  options: ApprovalPushOption[];
}

/**
 * Read an approval out of a push payload, or null when the push is an ordinary
 * one. A payload missing the fingerprint is deliberately not answerable: the
 * user is taken to the pane instead of an answer being sent blind.
 */
export function approvalPushTarget(data: unknown): ApprovalPushTarget | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (raw.categoryId !== APPROVAL_PUSH_CATEGORY_ID && raw.type !== 'approval.pending') return null;

  const serverId = stringField(raw.server_id) || stringField(raw.serverId);
  const sessionId = stringField(raw.session_id) || stringField(raw.sessionId);
  const paneId = stringField(raw.pane_id) || stringField(raw.paneId);
  const fingerprint = stringField(raw.fingerprint);
  if (!serverId || !paneId || !fingerprint) return null;

  const options = Array.isArray(raw.options)
    ? raw.options
        .map(pushOptionFromValue)
        .filter((option): option is ApprovalPushOption => option !== null)
    : [];
  return { serverId, sessionId, paneId, fingerprint, options };
}

/**
 * The buttons an approval notification carries, and the identifiers they answer
 * under.
 *
 * The gateway sends the option *decisions*, never the agent's own wording, so
 * the button titles are the app's. They live in `src/i18n/labels.ts`
 * (`approvalActionTitle`): this module is imported by its test suite, so it
 * cannot hold a Lingui macro, and the wording is a translation concern anyway.
 * Because both platforms resolve a notification's actions from a category
 * registered before it arrived, this list is fixed rather than tailored to one
 * menu.
 */
export const APPROVAL_ACTION_PREFIX = 'approval.';

export const APPROVAL_NOTIFICATION_ACTIONS: readonly {
  decision: NamedApprovalDecision;
  destructive: boolean;
}[] = [
  { decision: 'allow', destructive: false },
  { decision: 'allow_always', destructive: false },
  { decision: 'deny', destructive: true },
];

/** The decision an action identifier names, or null when it is not one of ours. */
export function approvalActionDecision(actionIdentifier: string): NamedApprovalDecision | null {
  if (!actionIdentifier.startsWith(APPROVAL_ACTION_PREFIX)) return null;
  const name = actionIdentifier.slice(APPROVAL_ACTION_PREFIX.length);
  return APPROVAL_NOTIFICATION_ACTIONS.find((action) => action.decision === name)?.decision ?? null;
}

/**
 * Whether this particular menu offers the decision a button names.
 *
 * The buttons are the same on every approval notification, but a menu is not:
 * a startup trust prompt has no "don't ask again". Knowing that from the
 * payload saves a round trip whose only possible answer is `409`.
 */
export function pushOffersDecision(
  target: ApprovalPushTarget,
  decision: NamedApprovalDecision
): boolean {
  // A payload from a gateway that sent no options at all is not evidence of
  // absence; let the gateway be the judge.
  if (target.options.length === 0) return true;
  return target.options.some((option) => option.decision === decision);
}

function pushOptionFromValue(value: unknown): ApprovalPushOption | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const index = typeof raw.index === 'number' && Number.isInteger(raw.index) ? raw.index : null;
  if (index === null || index < 1) return null;
  const decision = DECISIONS.find((entry) => entry === raw.decision) ?? 'other';
  return { index, decision, label: stringField(raw.label) || `Option ${index}` };
}

/* -------------------------------------------------------------------------- */
/* Banner state                                                                */
/* -------------------------------------------------------------------------- */

export interface ApprovalTarget {
  sessionId: string;
  paneId: string;
}

export interface ApprovalBannerState {
  /** The pane this state describes. Anything about another pane is ignored. */
  target: ApprovalTarget | null;
  approval: PaneApproval | null;
  /** The option whose answer is in flight, so the buttons can be disabled. */
  answeringIndex: number | null;
  /**
   * Set when the gateway rejected an answer as stale. The owner re-reads the
   * pane and never re-sends: a rejected answer means the app's picture is old,
   * and sending it again would answer whatever question replaced it.
   */
  needsRefresh: boolean;
  /** What to tell the user, cleared by the next transition that supersedes it. */
  error: string | null;
}

export const IDLE_APPROVAL_BANNER: ApprovalBannerState = {
  target: null,
  approval: null,
  answeringIndex: null,
  needsRefresh: false,
  error: null,
};

export type ApprovalBannerAction =
  /** The screen is now looking at this pane; everything about the old one goes. */
  | { type: 'pane-selected'; target: ApprovalTarget | null }
  /** A GET, or an `approval.pending` / `approval.resolved` event. */
  | { type: 'observed'; state: PaneApprovalState }
  | { type: 'answer-started'; fingerprint: string; optionIndex: number }
  | { type: 'answer-succeeded'; answer: PaneApprovalAnswer }
  | { type: 'answer-conflicted'; code: ApprovalConflictCode }
  | { type: 'answer-failed'; message: string }
  | { type: 'error-dismissed' }
  | { type: 'refresh-handled' };

const CONFLICT_MESSAGES: Record<ApprovalConflictCode, string> = {
  approval_changed: 'The agent is asking something else now.',
  approval_not_pending: 'The agent is no longer waiting.',
  decision_unavailable: 'This agent did not offer that answer.',
};

export function approvalBannerReducer(
  state: ApprovalBannerState,
  action: ApprovalBannerAction
): ApprovalBannerState {
  switch (action.type) {
    case 'pane-selected': {
      if (sameTarget(state.target, action.target)) return state;
      return { ...IDLE_APPROVAL_BANNER, target: action.target };
    }

    case 'observed': {
      // A pane the screen is not showing has nothing to say about this banner.
      // Panes are unique per session on the gateway, so the pane id alone is
      // enough -- and an event that omits the session id still lands.
      if (!state.target || state.target.paneId !== action.state.paneId) return state;
      const next = action.state.approval;
      // An in-flight answer is about one specific menu. A read that still shows
      // that menu is the pre-answer picture arriving late, so the spinner
      // stays; anything else means the answer landed or was overtaken.
      const stillAnswering =
        state.answeringIndex !== null &&
        next !== null &&
        next.fingerprint === state.approval?.fingerprint;
      return {
        ...state,
        approval: next,
        answeringIndex: stillAnswering ? state.answeringIndex : null,
        needsRefresh: false,
        error: stillAnswering ? state.error : null,
      };
    }

    case 'answer-started': {
      // Only the menu on screen may be answered. Anything else is a tap that
      // raced an update, and the update wins.
      if (state.approval?.fingerprint !== action.fingerprint) return state;
      return { ...state, answeringIndex: action.optionIndex, error: null };
    }

    case 'answer-succeeded': {
      if (!state.target || state.target.paneId !== action.answer.paneId) return state;
      return {
        ...state,
        // The POST answers with what the pane is waiting on *now*, which is
        // null once the menu was taken down. Adopting it directly means the
        // banner disappears on the answer itself rather than waiting for the
        // `approval.resolved` event to make the round trip.
        approval: action.answer.approval,
        answeringIndex: null,
        needsRefresh: false,
        error: null,
      };
    }

    case 'answer-conflicted': {
      // Rule 2: never re-send. Ask for the truth instead.
      return {
        ...state,
        answeringIndex: null,
        needsRefresh: true,
        error: CONFLICT_MESSAGES[action.code],
      };
    }

    case 'answer-failed': {
      return { ...state, answeringIndex: null, error: action.message };
    }

    case 'error-dismissed': {
      return state.error === null ? state : { ...state, error: null };
    }

    case 'refresh-handled': {
      return state.needsRefresh ? { ...state, needsRefresh: false } : state;
    }
  }
}

function sameTarget(left: ApprovalTarget | null, right: ApprovalTarget | null): boolean {
  if (!left || !right) return left === right;
  return left.sessionId === right.sessionId && left.paneId === right.paneId;
}
