/**
 * How a pane is being read. One control cycles these, and which of them exist
 * for a given pane is a question about the pane, not about the user:
 *
 * - `terminal` is the pane as it actually is -- a grid of cells with its ANSI
 *   colour intact. Every pane has one, so this mode is always available and is
 *   the answer of last resort whenever a richer view cannot be drawn.
 * - `text` is that same output reflowed for reading. It only makes sense where
 *   an agent is attached, because reflowing loses the grid, and a grid is the
 *   whole point of a plain shell pane.
 * - `chat` is the gateway's normalized transcript laid out as a conversation.
 *   It exists only where the gateway says it can normalize this pane.
 *
 * Kept free of React so the cycle, the capability gate and the fallback can be
 * tested as plain functions.
 */
export type PaneViewMode = 'chat' | 'text' | 'terminal';

/** What the pane itself can offer, as opposed to what the user asked for. */
export interface PaneViewCapabilities {
  /** An agent is attached to this pane. */
  agent: boolean;
  /** The gateway declared `capabilities.parts` for this pane. */
  parts: boolean;
}

/**
 * Cycle order, from most interpreted to most literal. Going one way only is
 * deliberate: a single button that reverses direction is a button whose next
 * press cannot be predicted.
 */
export const PANE_VIEW_MODE_ORDER: readonly PaneViewMode[] = ['chat', 'text', 'terminal'];

/**
 * Basics first (Ellen, 2026-07-27): the chat view is finished but not yet
 * earning its keep, and is hidden as of 2026-07-27 (Ellen: not earning its keep
 * yet). Flip to true to bring it back everywhere at once -- the cycle, the
 * settings option, the header control -- with nothing else changing.
 */
export const CHAT_VIEW_ENABLED = false;

/**
 * Whether Settings offers "Agent panes open in", hidden as of 2026-07-27
 * (Ellen: the terminal is the default, and a global answer to a per-pane
 * question is one setting too many).
 *
 * The same technique as `CHAT_VIEW_ENABLED` above, and for the same reason:
 * nothing behind it is deleted. `agentDefaultView` still exists, is still
 * stored, still migrates from the two switches it replaced, and is still what a
 * pane opens in -- so flipping this back to true returns the row with its
 * behaviour intact. What changed is only where the view gets switched: the pane
 * header's control, and the quick-actions row beside it, both of which act on
 * the pane in front of you rather than on every pane at once.
 */
export const AGENT_DEFAULT_VIEW_SETTING_ENABLED = false;

export function isPaneViewMode(value: unknown): value is PaneViewMode {
  return value === 'chat' || value === 'text' || value === 'terminal';
}

/**
 * The modes this pane can actually show, in cycle order. Always non-empty:
 * `terminal` needs nothing from the gateway.
 */
export function availablePaneViewModes(capabilities: PaneViewCapabilities): PaneViewMode[] {
  return PANE_VIEW_MODE_ORDER.filter((mode) => {
    if (mode === 'chat' && !CHAT_VIEW_ENABLED) return false;
    if (mode === 'terminal') return true;
    if (mode === 'text') return capabilities.agent;
    return capabilities.agent && capabilities.parts;
  });
}

/**
 * A pane with one mode has nothing to cycle, and a control that did nothing
 * would read as a dead button -- so it is hidden rather than made a no-op.
 */
export function canCyclePaneViewModes(available: readonly PaneViewMode[]): boolean {
  return available.length > 1;
}

export function nextPaneViewMode(
  current: PaneViewMode,
  available: readonly PaneViewMode[]
): PaneViewMode {
  if (available.length === 0) return 'terminal';
  const index = available.indexOf(current);
  // A current mode that is no longer available (the gateway stopped offering
  // parts, say) restarts the cycle rather than sticking.
  if (index < 0) return available[0] ?? 'terminal';
  return available[(index + 1) % available.length] ?? 'terminal';
}

/**
 * What to actually draw, given what was asked for. A preference is never
 * rewritten by this -- it is remembered as chosen, so the view the user wanted
 * comes back by itself once the gateway can serve it again.
 *
 * The fallback is always `terminal` rather than "the next best view": a pane
 * that cannot be normalized is a pane we know nothing extra about, and the raw
 * output is the only reading of it that is certainly correct.
 */
export function resolvePaneViewMode(
  preferred: PaneViewMode,
  available: readonly PaneViewMode[]
): PaneViewMode {
  if (available.includes(preferred)) return preferred;
  return available.includes('terminal') ? 'terminal' : (available[0] ?? 'terminal');
}

/**
 * What was found in stored settings: either this setting, or the two switches
 * it replaced -- "show agents as a terminal" and "structured view".
 */
export interface StoredAgentViewSettings {
  agentDefaultView?: unknown;
  agentStructuredView?: unknown;
  agentTerminalMode?: unknown;
}

/**
 * The default view an upgraded install should start from, or `undefined` for
 * "nothing was stored, use the current default".
 *
 * A stored value wins outright. Failing that the old pair is translated: asking
 * for the structured view meant asking for the transcript, which is now chat,
 * and switching the terminal off meant asking for reflowed text.
 *
 * The one deliberate loss is the old terminal preference. It was the shipped
 * default rather than a choice anyone made, so honouring it would hide the
 * conversation view from every existing install -- and unlike a setting, the
 * terminal is one tap away on the pane itself.
 */
export function storedAgentDefaultView(stored: StoredAgentViewSettings): PaneViewMode | undefined {
  if (isPaneViewMode(stored.agentDefaultView)) return stored.agentDefaultView;
  if (stored.agentStructuredView === true) return 'chat';
  if (stored.agentTerminalMode === false) return 'text';
  return undefined;
}

// `describePaneViewMode` used to live here. Its wording moved to
// `src/i18n/labels.ts` when the app learned a second language -- this module
// decides which modes exist and which one a pane can actually show, and the
// view layer decides what each is called.
//
// The rule it enforced went with it rather than being dropped: a mode outside
// the union falls back to `terminal` rather than returning undefined. The
// settings row reads the detail straight into a `<Text>`, so a mode added to
// the type without a case is a crash, not a missing sentence -- which is why
// the label helpers there answer through `default:` and never through a case
// list that can fall off the end.
