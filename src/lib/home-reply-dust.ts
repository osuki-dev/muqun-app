/**
 * The reply drawer's ash transition (`components/home-reply-drawer.tsx`),
 * as the bookkeeping its handlers share: which transition is live, whether
 * its photograph has landed, and what each thing that can happen to it means.
 *
 * Opening: the sheet is mounted where it will rest, unseen, photographed as
 * soon as it has laid out, and the ash reforms into the photograph; at the
 * end the live sheet is shown under a canvas that by then shows the same
 * picture. Closing: the live sheet is photographed where it stands, hidden
 * once the canvas has drawn, and the ash falls into the dock. A photograph
 * that fails or is late hands the move to the drawer's plain slide, so the
 * drawer never waits on the GPU; a drag catching the sheet abandons the ash
 * and leaves the sheet live where it is.
 *
 * Pure: the drawer feeds it events and carries out the effects it returns.
 */

export type DrawerDustWay = 'open' | 'close';

/** One ash transition while it plays. `Shot` is the photograph type. */
export type DrawerDust<Shot> = {
  /** Retires every transition before it. */
  token: number;
  way: DrawerDustWay;
  /** How much of the sheet stands above the dock's foot, in points. */
  extent: number;
  /** The photograph the ash is drawn from, once it has landed. */
  shot: Shot | null;
  /** The ash is moving. */
  playing: boolean;
};

export type DrawerDustEvent<Shot> =
  /** The photograph landed, or could not be taken (`shot` null). */
  | { type: 'shot'; token: number; shot: Shot | null }
  /** The canvas over the sheet has presented its first frame. */
  | { type: 'drawn'; token: number }
  /** The photograph's deadline passed without one. */
  | { type: 'late'; token: number }
  /** The ash's timing finished, or was cut short (`finished` false). */
  | { type: 'ended'; token: number; finished: boolean }
  /** A finger took the sheet: it stays live where it is. */
  | { type: 'abandon' }
  /** Home was hidden, or the ash stalled: the sheet is left live, or down. */
  | { type: 'reset' };

export type DrawerDustEffect<Shot> =
  /** Run the ash: hide the live sheet (closing) and start the timing. */
  | { effect: 'play'; way: DrawerDustWay }
  /** No ash for this move: the plain slide takes it from here. */
  | { effect: 'fallback'; way: DrawerDustWay }
  /** The ash has settled: the live sheet is shown whole (open) or taken down (close). */
  | { effect: 'settled'; way: DrawerDustWay }
  /** The ash was cut short: the live sheet stays, shown, where it is. */
  | { effect: 'abandoned' }
  /** A photograph nothing will draw. */
  | { effect: 'dispose'; shot: Shot };

export type DrawerDustStep<Shot> = {
  next: DrawerDust<Shot> | null;
  effects: DrawerDustEffect<Shot>[];
};

/** Start a transition: the live one, if any, is retired by the new token. */
export function beginDrawerDust<Shot>(
  token: number,
  way: DrawerDustWay,
  extent: number
): DrawerDust<Shot> {
  return { token, way, extent, shot: null, playing: false };
}

/**
 * What an event means for the live transition, if it is still the one it
 * names. An opening sheet is hidden from the start, so its ash plays as soon
 * as the photograph is in; a closing one stays live until the canvas has
 * drawn, so no frame shows neither.
 */
export function stepDrawerDust<Shot>(
  current: DrawerDust<Shot> | null,
  event: DrawerDustEvent<Shot>
): DrawerDustStep<Shot> {
  if (event.type === 'abandon' || event.type === 'reset') {
    if (!current) return { next: null, effects: [] };
    // A close cut off from outside still ends with the sheet down.
    const down = event.type === 'reset' && current.way === 'close';
    return {
      next: null,
      effects: down
        ? [{ effect: 'abandoned' }, { effect: 'settled', way: 'close' }]
        : [{ effect: 'abandoned' }],
    };
  }
  const stale = !current || current.token !== event.token;
  if (stale || (event.type === 'shot' && current.shot)) {
    // Too late, or already drawn from one: only the photograph is kept from leaking.
    return {
      next: current,
      effects: event.type === 'shot' && event.shot ? [{ effect: 'dispose', shot: event.shot }] : [],
    };
  }
  switch (event.type) {
    case 'shot':
      if (!event.shot) return { next: null, effects: [{ effect: 'fallback', way: current.way }] };
      if (current.way === 'open') {
        return {
          next: { ...current, shot: event.shot, playing: true },
          effects: [{ effect: 'play', way: 'open' }],
        };
      }
      return { next: { ...current, shot: event.shot }, effects: [] };
    case 'drawn':
      if (!current.shot || current.playing) return { next: current, effects: [] };
      return {
        next: { ...current, playing: true },
        effects: [{ effect: 'play', way: current.way }],
      };
    case 'late':
      if (current.shot) return { next: current, effects: [] };
      return { next: null, effects: [{ effect: 'fallback', way: current.way }] };
    case 'ended':
      if (!current.playing) return { next: current, effects: [] };
      return {
        next: null,
        effects: [
          event.finished ? { effect: 'settled', way: current.way } : { effect: 'abandoned' },
        ],
      };
    default:
      return { next: current, effects: [] };
  }
}
