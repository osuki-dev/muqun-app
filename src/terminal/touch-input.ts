/**
 * A finger on the grid, in the bytes the program on the far side is asking for.
 *
 * The terminal used to answer every touch the same way: one finger panned
 * muqun's own scrollback, a pinch zoomed, a long press selected. That is the
 * right set for a pane that PRINTS -- a shell, an agent's log -- where the
 * scrollback is the document and nothing on the far side has any use for a
 * pointer. It is the wrong set for everything a reader actually opens over
 * SSH. vim, tmux, less, htop, fzf and lazygit paint a screen; there is no
 * scrollback under them to pan, so a swipe moved nothing at all, and the
 * inputs they do want -- a mouse, or arrows -- were reachable only one key at
 * a time off the virtual keyboard.
 *
 * So the answer to a touch is decided by what the program has said about
 * itself, in three layers:
 *
 *  1. **It turned mouse reporting on** (`?1000`, `?1002` or `?1003`). Touch
 *     becomes mouse. A tap is a click where it landed; a drag is the wheel.
 *  2. **It is on the alternate screen and did not** -- stock vim, `man`, tmux
 *     with the mouse off. A drag becomes arrow keys, one per cell crossed.
 *  3. **Neither.** Unchanged: a drag pans muqun's scrollback, which is what a
 *     pane that prints has always wanted.
 *
 * Two fingers always mean layer 3, in every layer, so history is never out of
 * reach -- that rule lives in the component, because it is about pointers
 * rather than about bytes.
 *
 * Pure, and worklet-safe throughout: the layer decision runs on the UI thread
 * inside the pan gesture (it decides whether the transform moves at all, and
 * that cannot wait for a hop to JS), while the byte building runs on the JS
 * thread once per frame with whatever the finger accumulated. The mode facts
 * cross that boundary as a packed integer rather than as an object, because a
 * shared value read every frame should be a number.
 */

/** The emulator's answer to "what is the program doing", as this module needs it. */
export type TerminalTouchModes = {
  /** DECCKM (`?1`): arrows go out as `ESC O x` rather than `ESC [ x`. */
  applicationCursorKeys: boolean;
  /** `?47` / `?1047` / `?1049`: the program has taken the screen. */
  alternateScreen: boolean;
  /** `?1000`: button presses and releases. */
  mouseButtons: boolean;
  /** `?1002`: buttons, plus motion while one is held. */
  mouseButtonMotion: boolean;
  /** `?1003`: buttons, plus motion with nothing held. */
  mouseAnyMotion: boolean;
  /** `?1006`: SGR encoding for whichever of the above is on. */
  mouseSgrEncoding: boolean;
};

/** Every mode off: a fresh emulator, a reset one, and a pane with no channel. */
export const TERMINAL_TOUCH_MODES_OFF: TerminalTouchModes = {
  applicationCursorKeys: false,
  alternateScreen: false,
  mouseButtons: false,
  mouseButtonMotion: false,
  mouseAnyMotion: false,
  mouseSgrEncoding: false,
};

/**
 * The emulator's live mode state as a value React can hold.
 *
 * The emulator hands out one object and mutates it in place, which is right
 * for a key encoder reading it at the moment a key is sent and wrong for a
 * prop: a component handed the same object every frame has no way to know it
 * changed. This copies the six flags that matter here -- and returns
 * `previous` unchanged when none of them moved, so the copy costs a render
 * only on the frame vim actually starts rather than on every frame it draws.
 */
export function terminalTouchModesOf(
  previous: TerminalTouchModes,
  modes: TerminalTouchModes
): TerminalTouchModes {
  return packTerminalTouchModes(previous) === packTerminalTouchModes(modes)
    ? previous
    : {
        applicationCursorKeys: modes.applicationCursorKeys,
        alternateScreen: modes.alternateScreen,
        mouseButtons: modes.mouseButtons,
        mouseButtonMotion: modes.mouseButtonMotion,
        mouseAnyMotion: modes.mouseAnyMotion,
        mouseSgrEncoding: modes.mouseSgrEncoding,
      };
}

/** Which of the three rules above a touch falls under. */
export type TerminalTouchLayer = 'mouse' | 'arrows' | 'scrollback';

const BIT_APPLICATION_CURSOR = 1;
const BIT_ALTERNATE_SCREEN = 2;
const BIT_MOUSE_BUTTONS = 4;
const BIT_MOUSE_BUTTON_MOTION = 8;
const BIT_MOUSE_ANY_MOTION = 16;
const BIT_MOUSE_SGR = 32;

/**
 * The modes as one integer, so the gesture can hold them in a shared value and
 * read them on the UI thread without reaching for a JS object.
 */
export function packTerminalTouchModes(modes: TerminalTouchModes): number {
  'worklet';
  return (
    (modes.applicationCursorKeys ? BIT_APPLICATION_CURSOR : 0) |
    (modes.alternateScreen ? BIT_ALTERNATE_SCREEN : 0) |
    (modes.mouseButtons ? BIT_MOUSE_BUTTONS : 0) |
    (modes.mouseButtonMotion ? BIT_MOUSE_BUTTON_MOTION : 0) |
    (modes.mouseAnyMotion ? BIT_MOUSE_ANY_MOTION : 0) |
    (modes.mouseSgrEncoding ? BIT_MOUSE_SGR : 0)
  );
}

/** The inverse of `packTerminalTouchModes`, for the byte builders below. */
export function unpackTerminalTouchModes(bits: number): TerminalTouchModes {
  'worklet';
  return {
    applicationCursorKeys: (bits & BIT_APPLICATION_CURSOR) !== 0,
    alternateScreen: (bits & BIT_ALTERNATE_SCREEN) !== 0,
    mouseButtons: (bits & BIT_MOUSE_BUTTONS) !== 0,
    mouseButtonMotion: (bits & BIT_MOUSE_BUTTON_MOTION) !== 0,
    mouseAnyMotion: (bits & BIT_MOUSE_ANY_MOTION) !== 0,
    mouseSgrEncoding: (bits & BIT_MOUSE_SGR) !== 0,
  };
}

/**
 * Whether the program is reporting the mouse at all.
 *
 * Any one of the three is enough. They are not a ladder a program climbs in
 * order: `?1003` is often set without `?1000` beside it, and a program that
 * wants motion certainly wants the click that starts it.
 */
export function terminalMouseReporting(bits: number): boolean {
  'worklet';
  return (bits & (BIT_MOUSE_BUTTONS | BIT_MOUSE_BUTTON_MOTION | BIT_MOUSE_ANY_MOTION)) !== 0;
}

/** Which rule a one-finger touch falls under; see the module comment. */
export function terminalTouchLayer(bits: number): TerminalTouchLayer {
  'worklet';
  if (terminalMouseReporting(bits)) return 'mouse';
  return (bits & BIT_ALTERNATE_SCREEN) !== 0 ? 'arrows' : 'scrollback';
}

/**
 * Whether a drag with this many fingers belongs to the program or to muqun's
 * own scrollback.
 *
 * Two fingers are always the scrollback, in every layer. A reader inside vim
 * still has muqun's history of the session above them and must be able to get
 * at it, and there is no way back to it if the only vertical gesture the pane
 * has is being spent on the program.
 */
export function terminalTouchDragTarget(
  bits: number,
  pointerCount: number
): 'program' | 'scrollback' {
  'worklet';
  if (pointerCount > 1) return 'scrollback';
  return terminalTouchLayer(bits) === 'scrollback' ? 'scrollback' : 'program';
}

/**
 * Whether a long press hands the finger to the program rather than starting a
 * selection.
 *
 * Only under `?1002`, which is precisely the mode that says "tell me where the
 * pointer goes while a button is held" -- so it is the only mode under which a
 * held drag has anywhere to go. tmux sets it to let a divider be dragged and
 * vim to let a visual selection be swept, and both are gestures the reader has
 * no other way to make on a phone.
 *
 * The plain drag stays the wheel in every mouse mode, `?1002` included, and
 * that is deliberate. A drag cannot be both a scroll and a sweep, and scrolling
 * is what a reader does a hundred times to every once they select: a vim or a
 * tmux whose only drag was a visual selection would be a terminal you cannot
 * read. Press-and-hold, then drag, is how every touch surface that emulates a
 * pointer spells the other one.
 *
 * Where this takes the long press, muqun's own selection is still reachable by
 * a double tap, which takes the line.
 */
export function terminalTouchPressDrags(bits: number): boolean {
  'worklet';
  return terminalMouseReporting(bits) && (bits & BIT_MOUSE_BUTTON_MOTION) !== 0;
}

/** A cell of the live screen, 1-based, which is how a mouse report spells one. */
export type TerminalTouchCell = {
  column: number;
  row: number;
};

/**
 * A hit-tested cell of the drawn frame, as the cell the program would name.
 *
 * Two conversions in one. The obvious one is 0-based to 1-based. The other is
 * that the frame the canvas draws is not the screen: on the main screen it is
 * the whole scrollback with the live screen as its last `screenRows` rows, so
 * a report has to be measured from the top of THAT window rather than from the
 * top of the drawing. On the alternate screen the two coincide, because an
 * alternate buffer keeps no scrollback -- but the arithmetic is the same and
 * costs nothing, so there is one path rather than a branch that could rot.
 *
 * Clamped rather than rejected. A finger below the last row of a short frame
 * is a finger on the bottom row of the screen, which is what a mouse pointer
 * held against the bottom edge of a window reports too.
 */
export function terminalTouchCellAt(hit: {
  row: number;
  column: number;
  lineCount: number;
  screenRows: number;
  columns: number;
}): TerminalTouchCell {
  'worklet';
  const screenRows = hit.screenRows > 0 ? hit.screenRows : 1;
  const columns = hit.columns > 0 ? hit.columns : 1;
  const screenTop = Math.max(0, hit.lineCount - screenRows);
  return {
    row: Math.max(1, Math.min(screenRows, hit.row - screenTop + 1)),
    column: Math.max(1, Math.min(columns, hit.column + 1)),
  };
}

const ESC = 0x1b;

/**
 * The largest cell the X10 encoding can name.
 *
 * Every field of that form is `32 + value` in one byte, so 223 is where the
 * byte runs out. Wider than that and there is no report to send: xterm's own
 * answer is to send nothing rather than a wrapped coordinate, because a
 * coordinate that wrapped is a click somewhere the reader did not touch. The
 * fix on the reader's side is the program's, not ours -- `?1006` has no such
 * limit, and everything that sets a mouse mode this decade sets it too.
 */
export const TERMINAL_MOUSE_LEGACY_LIMIT = 223;

/**
 * How many wheel or arrow events one emission may carry.
 *
 * A drag is coalesced to whole cells crossed since the last emission, which
 * for an ordinary drag is one or two. A hard flick across a tall screen in a
 * frame the app was late for is the case this bounds: without a cap the pane
 * would post a hundred wheel events into a PTY in one write, and the program
 * would still be redrawing its way through them long after the finger had
 * stopped. A screenful at a time is as fast as a wheel can usefully go.
 */
export const TERMINAL_TOUCH_EVENTS_PER_EMISSION = 32;

/** Left button, the only one a finger can be. */
const BUTTON_LEFT = 0;
/** X10's "some button was released"; SGR names the button instead. */
const BUTTON_LEGACY_RELEASE = 3;
/** Added to a button code to say the pointer moved while it was held. */
const BUTTON_MOTION = 32;
/** The wheel, which reports as buttons rather than as an axis. */
const BUTTON_WHEEL_UP = 64;
const BUTTON_WHEEL_DOWN = 65;

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0x7f;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array | null {
  let length = 0;
  for (const part of parts) length += part.length;
  if (length === 0) return null;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * One mouse report.
 *
 * `released` picks the terminator in SGR form and the button code in X10 form,
 * which is the whole difference between the two encodings that matters here:
 * SGR says which button came up, X10 can only say that something did. That is
 * also why a program that wants to tell a left-drag from a right-drag has to
 * ask for `?1006`, and why every program that cares does.
 *
 * Returns null when the X10 form cannot name the cell; see
 * `TERMINAL_MOUSE_LEGACY_LIMIT`.
 */
export function terminalMouseReport(
  report: { button: number; cell: TerminalTouchCell; released: boolean },
  sgr: boolean
): Uint8Array | null {
  const { button, cell, released } = report;
  if (sgr) {
    return ascii(`\x1b[<${button};${cell.column};${cell.row}${released ? 'm' : 'M'}`);
  }
  if (cell.column > TERMINAL_MOUSE_LEGACY_LIMIT || cell.row > TERMINAL_MOUSE_LEGACY_LIMIT) {
    return null;
  }
  const code = released ? BUTTON_LEGACY_RELEASE : button;
  return Uint8Array.from([ESC, 0x5b, 0x4d, 32 + code, 32 + cell.column, 32 + cell.row]);
}

/**
 * A tap, as a click: press and release at the same cell, in one write.
 *
 * One write rather than two because the pair is one event to the program and
 * splitting it across two `write` calls only gives the far side a chance to
 * redraw between them.
 */
export function terminalTouchTapBytes(cell: TerminalTouchCell, bits: number): Uint8Array | null {
  if (!terminalMouseReporting(bits)) return null;
  const sgr = (bits & BIT_MOUSE_SGR) !== 0;
  const press = terminalMouseReport({ button: BUTTON_LEFT, cell, released: false }, sgr);
  const release = terminalMouseReport({ button: BUTTON_LEFT, cell, released: true }, sgr);
  if (!press || !release) return null;
  return concat([press, release]);
}

/** The press half on its own, for a drag the program is to see as held. */
export function terminalTouchPressBytes(cell: TerminalTouchCell, bits: number): Uint8Array | null {
  if (!terminalMouseReporting(bits)) return null;
  return terminalMouseReport(
    { button: BUTTON_LEFT, cell, released: false },
    (bits & BIT_MOUSE_SGR) !== 0
  );
}

/** The release half, sent when the finger leaves. */
export function terminalTouchReleaseBytes(
  cell: TerminalTouchCell,
  bits: number
): Uint8Array | null {
  if (!terminalMouseReporting(bits)) return null;
  return terminalMouseReport(
    { button: BUTTON_LEFT, cell, released: true },
    (bits & BIT_MOUSE_SGR) !== 0
  );
}

/** What a drag has accumulated since the last emission. */
export type TerminalTouchDrag = {
  /** Where the finger is now, on the live screen. */
  cell: TerminalTouchCell;
  /** Whole cells crossed downwards since the last emission; negative is upwards. */
  rows: number;
  /** Whole cells crossed rightwards since the last emission. */
  columns: number;
  /**
   * Whether the program is to see this as a drag with the button down rather
   * than as the wheel. Only ever true under `?1002`, and only after a long
   * press: see the component, which is where that arbitration lives.
   */
  held: boolean;
};

/**
 * A cursor key, honouring DECCKM.
 *
 * The same rule and the same table as `@/lib/ssh-key-bytes` -- SS3 in
 * application mode, CSI outside it. Not shared with it, because that module
 * maps key NAMES from a keyboard and this one has a direction; a common
 * two-byte helper would be longer than either copy.
 */
function cursorKey(final: string, applicationMode: boolean): Uint8Array {
  return Uint8Array.from([ESC, applicationMode ? 0x4f : 0x5b, final.charCodeAt(0)]);
}

function repeat(unit: Uint8Array, count: number): Uint8Array[] {
  const capped = Math.min(count, TERMINAL_TOUCH_EVENTS_PER_EMISSION);
  const parts: Uint8Array[] = [];
  for (let index = 0; index < capped; index += 1) parts.push(unit);
  return parts;
}

/**
 * The bytes for one frame's worth of drag, whichever layer the program put us in.
 *
 * The direction convention is the content's, not the pointer's, and it is the
 * one muqun's own scrollback already uses: pulling the finger DOWN brings
 * earlier lines into view. So a downward finger is the wheel turning up, and
 * an Up arrow, in the layers that spell it those ways. Getting this backwards
 * is the difference between a terminal that feels like every other surface on
 * the phone and one that feels inverted, and there is no setting for it here
 * for the same reason there is none on the scrollback.
 *
 * Horizontal movement is arrows only. The wheel has buttons 66 and 67 for a
 * horizontal wheel, but almost nothing reads them and the ones that do treat
 * them as scroll rather than as cursor movement, so a sideways drag in mouse
 * mode is silence rather than a guess.
 */
export function terminalTouchDragBytes(drag: TerminalTouchDrag, bits: number): Uint8Array | null {
  const layer = terminalTouchLayer(bits);
  if (layer === 'scrollback') return null;

  if (layer === 'mouse') {
    const sgr = (bits & BIT_MOUSE_SGR) !== 0;
    if (drag.held) {
      // One report per emission, not one per cell: motion is a position, and
      // the program only ever wanted the newest one.
      if (drag.rows === 0 && drag.columns === 0) return null;
      return terminalMouseReport(
        { button: BUTTON_LEFT + BUTTON_MOTION, cell: drag.cell, released: false },
        sgr
      );
    }
    if (drag.rows === 0) return null;
    const button = drag.rows > 0 ? BUTTON_WHEEL_UP : BUTTON_WHEEL_DOWN;
    const unit = terminalMouseReport({ button, cell: drag.cell, released: false }, sgr);
    if (!unit) return null;
    return concat(repeat(unit, Math.abs(drag.rows)));
  }

  const application = (bits & BIT_APPLICATION_CURSOR) !== 0;
  const parts: Uint8Array[] = [];
  if (drag.rows !== 0) {
    parts.push(...repeat(cursorKey(drag.rows > 0 ? 'A' : 'B', application), Math.abs(drag.rows)));
  }
  if (drag.columns !== 0) {
    parts.push(
      ...repeat(cursorKey(drag.columns > 0 ? 'D' : 'C', application), Math.abs(drag.columns))
    );
  }
  return concat(parts);
}
