/**
 * What the quick actions sheet offers, decided once from the route's params.
 *
 * The sheet is reached two ways and they are not the same screen. From a pane's
 * lightning button it arrives holding a session, a pane and a server, and it may
 * offer every row. From Settings it arrives holding none of them, because there
 * is no pane to act on -- so it is the shortcut list and nothing else.
 *
 * These answers used to be expressions inside the component, each
 * repeating a piece of the one before it, and the interesting part -- that Stop
 * needs four separate facts to be true at once -- was spread across a boolean
 * chain nothing could test. They are here so that "which rows exist" is a
 * question with one answer and a test, and so the screen reads as a list of
 * rows rather than as a list of conditions.
 */
import { agentIsInterruptible } from '@/lib/agent-spawn';

export interface QuickActionParams {
  /** Present only when the sheet was opened over a live pane. */
  sessionId?: string;
  paneId?: string;
  serverId?: string;
  /** Whether this gateway said it can start and stop an agent. */
  spawnSupported: boolean;
  /** Whether opening a plain URL on the machine behind the pane is honest. */
  webServiceSupported: boolean;
  /**
   * Whether the only thing standing in the way is that this gateway is reached
   * through an SSH tunnel.
   *
   * A tunnelled gateway is bound to its machine's loopback, so its transport
   * reads as `local-only` and the two rows below fail closed -- correctly: the
   * tunnel forwards one port and says nothing about any other. But a row that
   * simply vanishes teaches nobody anything, and the reader who paired through
   * SSH on purpose is exactly the reader who will look for it. Offered as a
   * disabled row with the reason on it instead.
   */
  webServiceBlockedByTunnel?: boolean;
  /** This pane's agent, and what it is doing. */
  agentTarget?: string;
  agentStatus?: string;
  /** The Settings entry, which manages the saved shortcuts and nothing else. */
  manageOnly: boolean;
}

export interface QuickActionAvailability {
  /** Whether there is a pane to make something beside, and somewhere to go after. */
  canCreate: boolean;
  canStartTask: boolean;
  canStopAgent: boolean;
  canOpenWebService: boolean;
  /** Show the two rows, greyed out, with the tunnel as the stated reason. */
  webServiceBlockedByTunnel: boolean;
  /**
   * Whether to offer the simulator preview.
   *
   * The same condition as the web-service row, and for the same reason: both
   * reach a port on the paired machine directly, so both stand or fall on
   * whether the connection is one where that is honest. They are separate
   * fields rather than one because they are separate features -- the day either
   * gate moves, it should move alone.
   */
  canPreviewSimulator: boolean;
  /**
   * Whether the tile row is drawn at all.
   *
   * Four tiles as of card #841, where there were five full-width rows: New
   * terminal, New group, Preview a simulator, Open in your browser. New task is
   * not one of them -- it is the only entry here that asks a question rather
   * than doing a thing, so it keeps a row of its own under them -- and neither
   * is Stop, which is a condition of the pane rather than one of the sheet's
   * standing verbs.
   *
   * When nothing is drawn the shortcut list is the whole sheet and must not be
   * pushed down by the gap that would have separated it from the tiles.
   */
  hasTiles: boolean;
}

export function quickActionAvailability(params: QuickActionParams): QuickActionAvailability {
  // Making a panel needs a live pane to make it beside, and somewhere to send
  // the phone afterwards.
  const canCreate =
    !params.manageOnly && Boolean(params.sessionId && params.paneId && params.serverId);

  // A gateway that cannot spawn is never offered the row. Not disabled, not
  // explained -- absent, which is the whole rule of this feature: the phone
  // never shows an affordance the machine behind it has no answer for.
  const canStartTask = canCreate && params.spawnSupported;

  // Stop is contextual, not permanent: it belongs to a pane that is doing
  // something. Four facts, all of which have to hold -- there is a pane, the
  // gateway can interrupt, the agent is working, and we know what to interrupt.
  const canStopAgent =
    canCreate &&
    params.spawnSupported &&
    agentIsInterruptible(params.agentStatus) &&
    Boolean(params.agentTarget);

  // Opening a web service is about the machine, not about this pane -- so it
  // needs a server to be about, but not a pane or a session the way the rows
  // above it do.
  const canOpenWebService =
    !params.manageOnly && Boolean(params.serverId) && params.webServiceSupported;

  // simfarm is another port on that same machine, reached the same way, so it
  // is offered exactly when opening a URL there is offered. It needs no pane
  // either: a simulator belongs to the machine, not to the panel being read.
  const canPreviewSimulator = canOpenWebService;

  // Only a reason worth stating when the row would otherwise have been there:
  // a sheet opened from Settings, or with no server behind it, has nothing to
  // explain.
  const webServiceBlockedByTunnel =
    !canOpenWebService &&
    !params.manageOnly &&
    Boolean(params.serverId) &&
    Boolean(params.webServiceBlockedByTunnel);

  return {
    webServiceBlockedByTunnel,
    canCreate,
    canStartTask,
    canStopAgent,
    canOpenWebService,
    canPreviewSimulator,
    // Both machine-scoped tiles are counted even though they currently answer
    // together. This decides whether the shortcut list is pushed down by a gap,
    // so on the day the two gates diverge it has to already know about both --
    // the failure is silent spacing, which nothing would report.
    //
    // `canStartTask` and `canStopAgent` are deliberately not counted: neither
    // draws a tile, and each already carries its own surface below the row.
    hasTiles: canCreate || canOpenWebService || canPreviewSimulator || webServiceBlockedByTunnel,
  };
}
