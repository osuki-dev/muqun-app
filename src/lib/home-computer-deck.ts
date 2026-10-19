/**
 * The phone's Computers sheaf: the front computer's card, with the others
 * peeking out behind it as sheets showing only their header line. A sideways
 * pull scrubs the front card into ash (`card-dust.ts`) while the next one
 * reforms in its place; a peek brings its computer forward the same way.
 *
 * Everything here is arithmetic the deck's worklets and its tests share; the
 * drawing is in `home-computer-deck.tsx`.
 */

/**
 * The height of a peek's header strip, in points: one caption line, enough to
 * tell which computer it is and no more.
 */
export const DECK_PEEK_STRIP = 22;
/** The paper showing between one peek's strip and the next sheet's edge. */
export const DECK_PEEK_STEP = 4;
/** How far each level sits above the one in front of it. */
export const DECK_LEVEL_RISE = DECK_PEEK_STRIP + DECK_PEEK_STEP;
/** The rows a card in the sheaf shows; its header opens the rest. */
export const DECK_CARD_ROWS = 3;
/**
 * The least a card in the sheaf is, in points: its header and three
 * two-line rows. Every card is this tall, or as tall as the tallest.
 */
export const DECK_CARD_MIN_HEIGHT = 8 + 36 + DECK_CARD_ROWS * 44 + 8;
/** At most this many sheets peek out; the rest are counted on the last one. */
export const DECK_MAX_PEEKS = 3;
/** The proportional release distance, bounded to a short thumb movement below. */
export const DECK_COMMIT_SHARE = 0.14;
/** A flick faster than this commits after a deliberate 12-point pull, in pt/s. */
export const DECK_FLICK_VELOCITY = 500;
/** The largest tilt a sheet behind the front is given, in degrees. */
export const DECK_MAX_TILT = 0.6;
/**
 * The scrub's rubber band: the dissolve reached at the commit distance, and
 * the most a pull can ever erode. A short pull loosens only the leading edge;
 * the rest of the card blows away on release.
 */
export const DECK_SCRUB_AT_COMMIT = 0.5;
export const DECK_SCRUB_CEILING = 0.85;
/** The re-entering sheet starts this much smaller and this much lower. */
export const DECK_ENTRY_SCALE = 0.9;
export const DECK_ENTRY_DROP = 16;

/**
 * How the order changes: `DECK_ROTATE` sends the front to the back; a level
 * (1 and up) brings that sheet forward. A number, so a shared value holds it.
 */
export type DeckMove = number;
export const DECK_ROTATE = 0;
/** No move in progress. */
export const DECK_AT_REST = -1;

/** The height the peeks add above the front card. */
export function deckPeekBand(count: number): number {
  return Math.min(Math.max(count - 1, 0), DECK_MAX_PEEKS) * DECK_LEVEL_RISE;
}

/** A small, stable tilt per computer, so the sheaf reads as loose sheets. */
export function deckTilt(serverId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < serverId.length; index += 1) {
    hash ^= serverId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (((hash >>> 0) % 1001) / 500 - 1) * DECK_MAX_TILT;
}

/**
 * The deck's order for the computers that have cards now: the order it
 * already had, less the ones that left, with arrivals behind in the cards'
 * own order. The first time, the remembered front comes first.
 */
export function deckOrder(
  previous: readonly string[] | null,
  ids: readonly string[],
  front?: string | null
): string[] {
  if (!previous) {
    const rest = ids.filter((id) => id !== front);
    return front && ids.includes(front) ? [front, ...rest] : [...ids];
  }
  const kept = previous.filter((id) => ids.includes(id));
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
}

/** The order after `move`. */
export function deckMoved(order: readonly string[], move: DeckMove): string[] {
  'worklet';
  if (order.length < 2) return [...order];
  if (move === DECK_ROTATE) return [...order.slice(1), order[0]!];
  const level = Math.min(Math.max(move, 1), order.length - 1);
  return [order[level]!, ...order.slice(0, level), ...order.slice(level + 1)];
}

/**
 * `deckMoved` over the order written as one string (ids joined by a newline),
 * which is how the deck keeps it on the UI thread.
 */
export function deckMovedKey(key: string, move: DeckMove): string {
  'worklet';
  return deckMoved(key.split('\n'), move).join('\n');
}

/** The level of the computer `move` brings to the front. */
export function deckIncomingLevel(move: DeckMove): number {
  'worklet';
  return move === DECK_ROTATE ? 1 : move;
}

/**
 * The move a sideways pull makes: towards the left is the next computer,
 * towards the right brings the last sheet forward (the previous one).
 */
export function deckSwipeMove(direction: number, count: number): DeckMove {
  'worklet';
  return direction < 0 ? DECK_ROTATE : count - 1;
}

/**
 * How far the pull has scrubbed the dissolve, 0..`DECK_SCRUB_CEILING`.
 * `direction` is the side the pull started towards (-1 left, +1 right); a
 * pull back past where it started scrubs nothing.
 */
export function deckScrub(dx: number, width: number, direction: number): number {
  'worklet';
  const along = Math.max(0, dx * direction);
  // Keep this arithmetic in the worklet: no forward-declared worklet capture.
  const distance = Math.max(32, Math.min(48, width * DECK_COMMIT_SHARE));
  const d = along / distance;
  const k = -Math.log(1 - DECK_SCRUB_AT_COMMIT / DECK_SCRUB_CEILING);
  return DECK_SCRUB_CEILING * (1 - Math.exp(-k * d));
}

/** Whether a release commits: past the commit distance, or a flick that way. */
export function deckCommits(dx: number, vx: number, width: number, direction: number): boolean {
  'worklet';
  const along = dx * direction;
  if (Math.abs(vx) > DECK_FLICK_VELOCITY) return vx * direction > 0 && along >= 12;
  return along >= Math.max(32, Math.min(48, width * DECK_COMMIT_SHARE));
}

/**
 * The incoming card's own dissolve progress while the outgoing one is at `p`:
 * it reforms a little ahead of the erosion front, so the slot is never bare.
 */
export function deckReform(p: number): number {
  'worklet';
  return Math.min(1, Math.max(0, 1 - p * 1.6));
}

/**
 * Where a sheet at `level` (fractional while it moves) sits, before tilt:
 * smaller, fainter and higher the further back it is.
 */
export function deckLevelPose(level: number): {
  scale: number;
  opacity: number;
  translateY: number;
} {
  'worklet';
  const shown = Math.min(Math.max(level, 0), DECK_MAX_PEEKS);
  // Sheets beyond the last peek wait behind it, unseen.
  const hidden = Math.min(Math.max(level - DECK_MAX_PEEKS, 0), 1);
  return {
    scale: 1 - 0.02 * shown,
    opacity: (1 - 0.1 * shown) * (1 - hidden),
    translateY: -DECK_LEVEL_RISE * shown,
  };
}

/**
 * Where the sheet at ring position `position` is, `p` of the way through
 * `move` (`DECK_AT_REST` at rest). `fade` multiplies its opacity; `enter` < 1 is the
 * old front re-entering at the back, from a smaller, lower pose. `rest` is
 * the level it ends on, which sets its stacking.
 */
export function deckSheetLevel(
  position: number,
  count: number,
  p: number,
  move: DeckMove
): { level: number; fade: number; enter: number; rest: number } {
  'worklet';
  if (move === DECK_AT_REST) {
    return { level: position, fade: position === 0 ? 0 : 1, enter: 1, rest: position };
  }
  const incoming = deckIncomingLevel(move);
  if (position === 0) {
    const rest = move === DECK_ROTATE ? count - 1 : 1;
    return { level: rest, fade: p, enter: p, rest };
  }
  // The incoming computer is reforming in the front slot: its peek fades
  // where it is rather than travelling down through the sheets in front of it.
  if (position === incoming) {
    return { level: position, fade: Math.max(0, 1 - p * 2.5), enter: 1, rest: 0 };
  }
  if (move === DECK_ROTATE) {
    return { level: position - p, fade: 1, enter: 1, rest: position - 1 };
  }
  if (position < incoming) return { level: position + p, fade: 1, enter: 1, rest: position + 1 };
  return { level: position, fade: 1, enter: 1, rest: position };
}

/** How long a move may stand still, finger up, before the deck gives it up. */
export const DECK_STALL_MS = 1500;

/** What the deck's watchdog last saw, and since when it has not changed. */
export type DeckWatch = { sample: string; sinceMs: number };

/**
 * One look by the deck's watchdog. `engaged`: a move or a commit holds the
 * deck; `holding`: a finger is on it, which may rest as long as it likes;
 * `sample`: everything a live move changes (its token, progress, fade). A
 * move whose sample has not changed for `DECK_STALL_MS` is stuck: the deck is
 * reset rather than left ignoring every tab and swipe.
 */
export function deckWatch(
  previous: DeckWatch | null,
  look: { engaged: boolean; holding: boolean; sample: string },
  nowMs: number
): { watch: DeckWatch | null; stalled: boolean } {
  if (!look.engaged || look.holding) return { watch: null, stalled: false };
  if (!previous || previous.sample !== look.sample) {
    return { watch: { sample: look.sample, sinceMs: nowMs }, stalled: false };
  }
  if (nowMs - previous.sinceMs < DECK_STALL_MS) return { watch: previous, stalled: false };
  return { watch: null, stalled: true };
}
