import { TERMINAL_TEXT_SIZES } from '@/terminal/text-scale';
/**
 * How big the terminal's text is -- one rule, in one place.
 *
 * Two mechanisms decide what a reader sees. The Text size setting names a point
 * size, and it is every pane's starting point: a pane nothing has ever been
 * remembered for opens at it. The pinch scales the canvas on top of that, and
 * it is a per-pane memory rather than a session-only look: it survives leaving
 * the service screen, and it survives the app being killed and relaunched,
 * because leaving is the moment the pinch is written down
 * (`terminalScaleOnScreenLeave`) and opening is the moment it is read back
 * (`terminalScaleOnPaneOpen`), both keyed on the pane's own id.
 *
 * It does not survive the id itself going stale -- a tmux server restart hands
 * out fresh pane ids, so a pane reopened after one starts over at the
 * setting's size, indistinguishable from a pane that was never pinched. That
 * is a silent, harmless miss rather than a wrong answer: the orphaned entry is
 * never read again and ages out on its own (see
 * `TERMINAL_MAX_REMEMBERED_PANE_SCALES`).
 *
 * Both moments are named here as separate functions even though one reads the
 * memory and the other writes it, because they are separate promises and the
 * test that pins them should be able to say which one it is exercising.
 *
 * The clamps and the fit live here too, and not as loose arithmetic in the
 * canvas, because they are the same rule seen from the other end: the size the
 * setting -- or the memory -- asks for is the size a pane opens at only if
 * nothing else silently rewrites the scale afterwards.
 *
 * Neither function touches a disk. This file has a direct unit test that runs
 * under Bun, outside React Native, and the native module the app actually
 * persists through (MMKV -- the same mechanism `shortcut-usage.ts` uses for
 * another per-key, non-secret, frequently-written table) pulls in React
 * Native's own Flow-syntax sources the moment it is imported, which Bun cannot
 * parse; importing it here would take the test down with the module. So the
 * table of remembered scales is a plain argument in and a plain return value
 * out, and `skia-terminal.tsx` -- never imported by a test -- is where it is
 * actually loaded and saved.
 */

/** The three sizes the setting offers. */
export type TerminalTextSize = 'compact' | 'default' | 'large';

/**
 * The point size each setting names.
 *
 * Values inherited from the screen that used to carry them inline. They are a
 * little smaller than body text on purpose: a terminal is 80 columns wide and
 * the whole point of the compact end is fitting a wide log without panning.
 */
// The values live with the design type scale (`@/terminal/text-scale`), so a
// re-tuned scale reaches the pinch logic without a second table to forget.
export const TERMINAL_TEXT_SIZE_POINTS: Record<TerminalTextSize, number> = TERMINAL_TEXT_SIZES;

/** What the pinch indicator calls each size, matching the settings row. */
export const TERMINAL_TEXT_SIZE_NAMES: Record<TerminalTextSize, string> = {
  compact: 'Compact',
  default: 'Default',
  large: 'Large',
};

/**
 * How far out a pinch may zoom.
 *
 * Below this the glyphs stop being letters, and a pane that cannot be read is
 * not a smaller pane. Lines are never wrapped, so anything wider than the
 * viewport at this scale pans sideways instead of shrinking further.
 */
export const TERMINAL_MIN_SCALE = 0.62;

/** How far in a pinch may zoom -- roughly three words to a line at 1.8. */
export const TERMINAL_MAX_SCALE = 1.8;

/** The point size the setting names, falling back to the middle one. */
export function terminalFontSize(size: TerminalTextSize): number {
  return TERMINAL_TEXT_SIZE_POINTS[size] ?? TERMINAL_TEXT_SIZE_POINTS.default;
}

/**
 * The remembered pinch for every pane the reader has left since it was last
 * trimmed, keyed on the pane's own id (see `TERMINAL_MAX_REMEMBERED_PANE_SCALES`
 * for how that trimming works and the module comment above for why this is a
 * plain record rather than something that reaches storage itself).
 */
export type TerminalPaneScales = Readonly<Record<string, number>>;

/**
 * Long enough that nobody working across a dozen panes today loses one before
 * it is asked for again; short enough that the table backing it cannot grow
 * without bound. The same number `pane-view-mode`'s per-pane memory uses, for
 * the same reason -- panes churn, and a table that only ever grows is a leak
 * with a JSON.stringify in front of it.
 */
export const TERMINAL_MAX_REMEMBERED_PANE_SCALES = 64;

/**
 * Opening a pane starts at the size the setting names -- unless this exact
 * pane has a remembered pinch, in which case that pinch is what "this pane's
 * size" means now, until it is pinched again or its memory ages out.
 *
 * `remembered` is the table as the canvas last loaded or saved it; this
 * function only decides what a lookup against it means, so a missing entry
 * (never pinched), a stale one (the pane id came from a tmux server that has
 * since restarted and reused it for something else), or a corrupted one falls
 * back to 1 -- the setting's own size -- exactly as if nothing had ever been
 * remembered.
 *
 * It used to fit the pane's columns to the viewport first -- `max(MIN, min(1,
 * viewportWidth / contentWidth))` -- which sounds like a courtesy and was a
 * second answer to the question the setting had already answered. Content width
 * is `columns * cellWidth`, so the fit was a function of the pane's column
 * count and nothing else: on a ~400pt phone the default step fits about 45
 * columns, so a 65-column pane opened near 0.69, an 80-column pane clamped to
 * 0.62, and a 242-column pane clamped to 0.62 as well. Three panes, three glyph
 * sizes, from one setting -- and the indicator, dividing by each pane's own
 * fit, told the reader all three were 100% (card #643).
 *
 * Width is still the pan's job, not this function's: lines are never wrapped
 * and the canvas already pans sideways, so a wide table keeps its shape and is
 * read by moving across it. What changed is only that a reader who decides a
 * particular pane is worth a different size no longer has to make that
 * decision again every time they come back to it.
 */
export function terminalScaleOnPaneOpen(paneId: string, remembered: TerminalPaneScales): number {
  const value = remembered[paneId];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(TERMINAL_MIN_SCALE, Math.min(TERMINAL_MAX_SCALE, value));
}

/**
 * Leaving the service screen remembers the pinch this pane is showing right
 * now -- keyed on the pane's id -- so the next time this exact pane is opened,
 * whether later in this session or after the app has been killed and
 * relaunched, it opens at this size instead of back at the setting's.
 *
 * A separate moment from opening a pane, and still worth its own name for the
 * reason it always was: the canvas is deliberately never remounted on a pane
 * switch (the pane carousel would flash), so nothing about the component's
 * lifetime marks "the reader is done with this pane" on its own. Leaving the
 * screen is the moment -- and `skia-terminal.tsx` calls this from two places
 * because "leaving" is two different events depending on where the reader
 * goes: Settings and the panels sheet push over this screen and leave it
 * mounted-but-blurred, so a render with `screenFocused: false` is the moment;
 * going back to the server list pops this screen's own route instead, which
 * unmounts it without ever rendering `screenFocused: false` first (confirmed
 * live), so an unmount cleanup is the moment there. Both call sites hand the
 * same scale to the same function, so a pane the reader left twice in a row
 * -- blurred, then actually torn down -- is just this function agreeing with
 * itself.
 *
 * Pure, like its counterpart above: handed the table the canvas has, it hands
 * back the table to keep, and never touches a disk. At the setting's own size
 * there is nothing worth remembering, so the entry is dropped rather than
 * written as 1 -- a pane pinched back to default earns its slot back
 * immediately instead of occupying one with a number that would only ever
 * have been read as the fallback anyway. Otherwise the pane is re-inserted at
 * the end of the table, so trimming to `TERMINAL_MAX_REMEMBERED_PANE_SCALES`
 * drops whichever pane has gone longest untouched, not whichever was pinched
 * first.
 *
 * This used to reset the scale back to the setting's size instead of writing
 * it down, which was deliberate while a pane still opened fitted to its own
 * width (see the fit `terminalScaleOnPaneOpen` used to do): a remembered
 * number on top of a per-pane fit would have been two answers to the same
 * question. With the fit gone and every pane opening at 1:1, a wide pane
 * overflowing the screen is the common case rather than the rare one, and the
 * 8% between the compact and default steps of the setting is not enough of an
 * answer to it -- so the owner's answer was to pinch, once, by hand, to the
 * size a given pane actually needs, and have the app keep that answer the way
 * it keeps every other one. It still cannot survive an uninstall -- nothing
 * app-local can -- only being left, backgrounded, or killed and reopened.
 */
export function terminalScaleOnScreenLeave(
  paneId: string,
  scale: number,
  remembered: TerminalPaneScales
): TerminalPaneScales {
  if (!paneId) return remembered;
  const clamped =
    Math.round(Math.max(TERMINAL_MIN_SCALE, Math.min(TERMINAL_MAX_SCALE, scale)) * 100) / 100;
  const { [paneId]: _dropped, ...rest } = remembered;
  if (Math.abs(clamped - 1) < 0.005) return rest;
  const entries = Object.entries(rest);
  const kept = entries.slice(
    Math.max(0, entries.length - (TERMINAL_MAX_REMEMBERED_PANE_SCALES - 1))
  );
  return { ...Object.fromEntries(kept), [paneId]: clamped };
}

/**
 * Where a pinch in progress has got to, clamped.
 *
 * A worklet: this runs inside the pinch's own `onUpdate`, once per frame on the
 * UI thread, and hopping to JS for a multiplication would put the zoom a frame
 * behind the fingers.
 */
export function pinchedTerminalScale(startScale: number, gestureScale: number): number {
  'worklet';
  return Math.max(TERMINAL_MIN_SCALE, Math.min(TERMINAL_MAX_SCALE, startScale * gestureScale));
}

/**
 * The pinch as a percentage of the size the setting asked for.
 *
 * Absolute, against 1. It used to divide by the pane's own resting scale, which
 * made the number true of the pane and false of everything else: every pane
 * read 100% at rest, including the three that were drawing three different
 * sizes (card #643). A percentage that is 100 whatever it is measuring is not a
 * measurement.
 */
export function terminalZoomPercent(scale: number): number {
  'worklet';
  return Math.round(scale * 100);
}

/**
 * Where a pinch is, as the size pill has to know it.
 *
 * Three states rather than a boolean, because the recogniser's "I have started
 * watching" and "this is a pinch" are genuinely different moments and only the
 * second one is a zoom. On Android they are far apart: RNGH's
 * `PinchGestureHandler.onHandle` calls `begin()` on the first pointer of ANY
 * drag, whatever the pointer count, and only `activate()`s once the span
 * between two fingers has changed by more than the touch slop.
 *
 * Collapsing the two into one flag is what card #638 was: every one-finger
 * scroll raised the flag, the pill came up reading the resting size, and
 * because a scroll is a stream of begin/end pairs closer together than the
 * pill's hold, the hide timer was re-armed before it could ever fire and the
 * pill simply stayed on screen.
 */
export type TerminalPinchPhase = 'idle' | 'began' | 'active';

/**
 * What the size pill should read, or `null` for "not shown".
 *
 * The whole rule in one place, so the answer cannot drift from the phase: only
 * an active pinch says anything. A worklet -- the pinch's reaction reads it on
 * the UI thread, once per frame.
 */
export function terminalZoomIndicatorPercent(
  phase: TerminalPinchPhase,
  scale: number
): number | null {
  'worklet';
  if (phase !== 'active') return null;
  return terminalZoomPercent(scale);
}

/** "Large · 124%" -- the transient pinch indicator's whole text. */
export function terminalZoomLabel(size: TerminalTextSize, scale: number): string {
  const name = TERMINAL_TEXT_SIZE_NAMES[size] ?? TERMINAL_TEXT_SIZE_NAMES.default;
  return `${name} · ${terminalZoomPercent(scale)}%`;
}
