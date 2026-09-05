import type { HerdrEntity } from '@/lib/gateway-client';

/** Herdr entities carry their own shape under `raw`; read it defensively. */
export function field(entity: HerdrEntity | undefined, key: string): string {
  const value = entity?.raw[key];
  return typeof value === 'string' ? value : '';
}

export function numberField(entity: HerdrEntity, key: string): number {
  const value = entity.raw[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * The same read, for a field whose 0 is a real value rather than a miss.
 *
 * `numberField` answers 0 for "absent", which is exactly right for a width or a
 * height -- neither can legitimately be zero, so callers map 0 back to
 * "unknown" with `|| undefined`. It is exactly wrong for a coordinate: column 0
 * row 0 is the top-left cell, and a pane whose cursor the gateway never
 * reported would otherwise read as a pane whose cursor is in the corner.
 */
export function optionalNumberField(
  entity: HerdrEntity | undefined,
  key: string
): number | undefined {
  const value = entity?.raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function panelTitle(pane?: HerdrEntity, agent?: HerdrEntity): string {
  // A name the user set on the pane wins over everything, so a rename always
  // shows even when an agent is attached.
  if (pane?.label) return pane.label;
  // Two names for one panel only when there are two names. An agent or a pane
  // whose title is empty or nothing but whitespace used to satisfy the
  // "different from the other one" test trivially, and the result was a name
  // that began or ended with a floating separator -- "` · zsh`" -- which the
  // home card then set as the row's most prominent element. The separator is
  // punctuation between two names; with one name it is not punctuation, it is a
  // stray glyph.
  const agentTitle = agent?.title.trim() ?? '';
  const paneTitle = pane?.title.trim() ?? '';
  if (agentTitle && paneTitle && agentTitle.toLowerCase() !== paneTitle.toLowerCase()) {
    return `${agentTitle} · ${paneTitle}`;
  }
  if (agentTitle) return agentTitle;
  // The trimmed value or nothing. Falling back to the untrimmed one would let a
  // pane titled "   " past every guard above and set three spaces as the row's
  // name, which is the same defect as the stray separator wearing a disguise.
  return paneTitle || pane?.id || 'Panel';
}

/**
 * The statuses the gateway reports for an agent. Free-form on the wire, so
 * anything that survives a round trip through storage has to be narrowed back
 * to this set before it is trusted.
 */
export type AgentStatus = 'working' | 'blocked' | 'idle' | 'done' | 'unknown';

const AGENT_STATUSES: readonly AgentStatus[] = ['working', 'blocked', 'idle', 'done', 'unknown'];

export function asAgentStatus(status: string | undefined): AgentStatus {
  return AGENT_STATUSES.find((value) => value === status) ?? 'unknown';
}

/**
 * A hex literal rather than `string`: the Android widget renderer only accepts
 * `#rrggbb`, so keeping the narrow type here is what stops the home-screen dots
 * and the in-app dots from drifting apart without the compiler noticing.
 */
export type StatusColor = `#${string}`;

/**
 * Idle is grey, not green.
 *
 * Green is the app's "this finished" colour, and an idle agent has not
 * finished anything -- it is sitting at a prompt waiting to be told what to do.
 * Painting the two the same made a screen of idle agents read as a screen of
 * completed work, which is the one thing a status dot exists to prevent. Idle
 * shares the grey with `unknown` deliberately: both mean there is nothing here
 * asking for attention.
 *
 * `live-activity-layout.tsx` carries these four hexes again, inline, because
 * the Live Activity's `'widget'` body cannot see module scope. It is the only
 * copy; the Android widget draws through this function.
 */
export function statusColor(status?: string): StatusColor {
  if (status === 'working') return '#58AFFF';
  if (status === 'done') return '#4DDB91';
  if (status === 'blocked') return '#FFB454';
  return '#718095';
}

/**
 * The same statuses, named as theme colours instead of hexes.
 *
 * `statusColor` above has to stay a `#rrggbb` literal because the Android
 * widget renderer runs outside the app's theme and accepts nothing else.
 * Anything drawn inside the app should go through this instead, so a change to
 * the palette reaches the status dots without anyone having to remember they
 * are there.
 */
export type AgentStatusTone = 'info' | 'success' | 'warning' | 'textSubtle';

export function agentStatusTone(status?: string): AgentStatusTone {
  if (status === 'working') return 'info';
  if (status === 'done') return 'success';
  if (status === 'blocked') return 'warning';
  // Idle with unknown, for the reason given on `statusColor`.
  return 'textSubtle';
}

// The status *word* lives in `src/i18n/labels.ts` (`agentStatusWord`): this
// module is wire vocabulary and colour tones, and the wording beside the dot
// is a translation concern.

export function statusVariant(status?: string): 'active' | 'technical' {
  if (status === 'working' || status === 'idle' || status === 'done') return 'active';
  return 'technical';
}
