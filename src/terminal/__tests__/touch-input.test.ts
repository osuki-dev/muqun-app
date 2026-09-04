// The three-layer touch rule and the two mouse encodings, as bytes.
import { describe, expect, test } from 'bun:test';

import {
  TERMINAL_MOUSE_LEGACY_LIMIT,
  TERMINAL_TOUCH_MODES_OFF,
  TERMINAL_TOUCH_EVENTS_PER_EMISSION,
  type TerminalTouchModes,
  packTerminalTouchModes,
  terminalMouseReport,
  terminalMouseReporting,
  terminalTouchCellAt,
  terminalTouchDragBytes,
  terminalTouchDragTarget,
  terminalTouchLayer,
  terminalTouchModesOf,
  terminalTouchPressBytes,
  terminalTouchPressDrags,
  terminalTouchReleaseBytes,
  terminalTouchTapBytes,
  unpackTerminalTouchModes,
} from '@/terminal/touch-input';

const OFF: TerminalTouchModes = TERMINAL_TOUCH_MODES_OFF;

function bits(overrides: Partial<TerminalTouchModes> = {}): number {
  return packTerminalTouchModes({ ...OFF, ...overrides });
}

function text(bytes: Uint8Array | null): string {
  if (!bytes) return '';
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

const cell = { column: 4, row: 7 };

describe('packing', () => {
  test('every mode survives a round trip, alone and together', () => {
    const keys = Object.keys(OFF) as (keyof TerminalTouchModes)[];
    for (const key of keys) {
      expect(unpackTerminalTouchModes(bits({ [key]: true }))).toEqual({ ...OFF, [key]: true });
    }
    const all = Object.fromEntries(keys.map((key) => [key, true])) as TerminalTouchModes;
    expect(unpackTerminalTouchModes(packTerminalTouchModes(all))).toEqual(all);
    expect(unpackTerminalTouchModes(packTerminalTouchModes(OFF))).toEqual(OFF);
  });

  test('no two modes share a bit', () => {
    const keys = Object.keys(OFF) as (keyof TerminalTouchModes)[];
    const seen = new Set(keys.map((key) => bits({ [key]: true })));
    expect(seen.size).toBe(keys.length);
    expect(seen.has(0)).toBe(false);
  });
});

describe('terminalTouchModesOf', () => {
  test('keeps the previous object when nothing this module reads changed', () => {
    const previous = { ...OFF, alternateScreen: true };
    // A live emulator object with the same six flags, plus one this module has
    // no opinion about.
    const live = { ...previous, bracketedPaste: true } as TerminalTouchModes;
    expect(terminalTouchModesOf(previous, live)).toBe(previous);
  });

  test('copies out a new object the moment one of them moves', () => {
    const previous = { ...OFF };
    const next = terminalTouchModesOf(previous, { ...OFF, mouseButtons: true });
    expect(next).not.toBe(previous);
    expect(next).toEqual({ ...OFF, mouseButtons: true });
  });

  test('the copy does not alias the emulator that is still mutating it', () => {
    const live = { ...OFF };
    const copied = terminalTouchModesOf({ ...OFF, alternateScreen: true }, live);
    live.mouseButtons = true;
    expect(copied.mouseButtons).toBe(false);
  });
});

describe('terminalMouseReporting', () => {
  test('any of 1000, 1002 and 1003 is enough, and 1006 alone is not', () => {
    expect(terminalMouseReporting(bits({ mouseButtons: true }))).toBe(true);
    expect(terminalMouseReporting(bits({ mouseButtonMotion: true }))).toBe(true);
    expect(terminalMouseReporting(bits({ mouseAnyMotion: true }))).toBe(true);
    expect(terminalMouseReporting(bits({ mouseSgrEncoding: true }))).toBe(false);
    expect(terminalMouseReporting(bits())).toBe(false);
  });
});

describe('terminalTouchLayer', () => {
  test('mouse reporting wins, on either screen', () => {
    for (const alternateScreen of [false, true]) {
      for (const key of ['mouseButtons', 'mouseButtonMotion', 'mouseAnyMotion'] as const) {
        expect(terminalTouchLayer(bits({ alternateScreen, [key]: true }))).toBe('mouse');
      }
    }
  });

  test('the alternate screen without a mouse mode is arrows', () => {
    expect(terminalTouchLayer(bits({ alternateScreen: true }))).toBe('arrows');
    expect(terminalTouchLayer(bits({ alternateScreen: true, mouseSgrEncoding: true }))).toBe(
      'arrows'
    );
  });

  test('the main screen without a mouse mode is the scrollback', () => {
    expect(terminalTouchLayer(bits())).toBe('scrollback');
    expect(terminalTouchLayer(bits({ applicationCursorKeys: true }))).toBe('scrollback');
  });
});

describe('terminalTouchPressDrags', () => {
  test('only 1002 turns a long press into the program drag', () => {
    expect(terminalTouchPressDrags(bits({ mouseButtonMotion: true }))).toBe(true);
    expect(terminalTouchPressDrags(bits({ mouseButtons: true, mouseButtonMotion: true }))).toBe(
      true
    );
    expect(terminalTouchPressDrags(bits({ mouseButtons: true }))).toBe(false);
    expect(terminalTouchPressDrags(bits({ mouseAnyMotion: true }))).toBe(false);
    expect(terminalTouchPressDrags(bits({ alternateScreen: true }))).toBe(false);
    expect(terminalTouchPressDrags(bits())).toBe(false);
  });
});

describe('terminalTouchDragTarget', () => {
  test('a second finger is the scrollback in every layer', () => {
    for (const modes of [{}, { alternateScreen: true }, { mouseButtons: true }]) {
      expect(terminalTouchDragTarget(bits(modes), 2)).toBe('scrollback');
      expect(terminalTouchDragTarget(bits(modes), 3)).toBe('scrollback');
    }
  });

  test('one finger goes to the program in the two program layers', () => {
    expect(terminalTouchDragTarget(bits({ mouseButtons: true }), 1)).toBe('program');
    expect(terminalTouchDragTarget(bits({ alternateScreen: true }), 1)).toBe('program');
    expect(terminalTouchDragTarget(bits(), 1)).toBe('scrollback');
    expect(terminalTouchDragTarget(bits(), 0)).toBe('scrollback');
  });
});

describe('terminalTouchCellAt', () => {
  test('the alternate screen, where the frame is the screen', () => {
    expect(
      terminalTouchCellAt({ row: 0, column: 0, lineCount: 24, screenRows: 24, columns: 80 })
    ).toEqual({ row: 1, column: 1 });
    expect(
      terminalTouchCellAt({ row: 23, column: 79, lineCount: 24, screenRows: 24, columns: 80 })
    ).toEqual({ row: 24, column: 80 });
  });

  test('the main screen, where the live screen is the tail of the scrollback', () => {
    // 500 lines drawn, the last 24 of which are the screen: the first of those
    // is row 476 of the drawing and row 1 of the screen.
    expect(
      terminalTouchCellAt({ row: 476, column: 0, lineCount: 500, screenRows: 24, columns: 80 })
    ).toEqual({ row: 1, column: 1 });
    expect(
      terminalTouchCellAt({ row: 499, column: 9, lineCount: 500, screenRows: 24, columns: 80 })
    ).toEqual({ row: 24, column: 10 });
  });

  test('a touch in the history above the screen clamps to its first row', () => {
    expect(
      terminalTouchCellAt({ row: 0, column: 3, lineCount: 500, screenRows: 24, columns: 80 })
    ).toEqual({ row: 1, column: 4 });
  });

  test('a touch past the end clamps to the last row and column', () => {
    expect(
      terminalTouchCellAt({ row: 99, column: 999, lineCount: 24, screenRows: 24, columns: 80 })
    ).toEqual({ row: 24, column: 80 });
  });

  test('a frame shorter than the screen still reports from the screen top', () => {
    // Trailing blank rows are trimmed out of a frame, so a fresh alternate
    // screen can be two lines long inside a 24-row grid.
    expect(
      terminalTouchCellAt({ row: 1, column: 0, lineCount: 2, screenRows: 24, columns: 80 })
    ).toEqual({ row: 2, column: 1 });
  });

  test('degenerate sizes do not produce a zero or negative cell', () => {
    expect(
      terminalTouchCellAt({ row: 0, column: 0, lineCount: 0, screenRows: 0, columns: 0 })
    ).toEqual({ row: 1, column: 1 });
  });
});

describe('terminalMouseReport', () => {
  test('SGR press, release and motion', () => {
    expect(text(terminalMouseReport({ button: 0, cell, released: false }, true))).toBe(
      '\x1b[<0;4;7M'
    );
    expect(text(terminalMouseReport({ button: 0, cell, released: true }, true))).toBe(
      '\x1b[<0;4;7m'
    );
    expect(text(terminalMouseReport({ button: 32, cell, released: false }, true))).toBe(
      '\x1b[<32;4;7M'
    );
  });

  test('X10 offsets every field by 32 and cannot name the button that came up', () => {
    expect(Array.from(terminalMouseReport({ button: 0, cell, released: false }, false)!)).toEqual([
      0x1b, 0x5b, 0x4d, 32, 36, 39,
    ]);
    // Release is button 3 -- "something was released" -- whichever button it was.
    expect(Array.from(terminalMouseReport({ button: 0, cell, released: true }, false)!)).toEqual([
      0x1b, 0x5b, 0x4d, 35, 36, 39,
    ]);
  });

  test('X10 reaches exactly 223 and gives up past it; SGR has no such limit', () => {
    const edge = { column: TERMINAL_MOUSE_LEGACY_LIMIT, row: TERMINAL_MOUSE_LEGACY_LIMIT };
    const legacy = terminalMouseReport({ button: 0, cell: edge, released: false }, false);
    expect(legacy).not.toBeNull();
    expect(legacy![4]).toBe(255);
    expect(legacy![5]).toBe(255);
    const past = { column: TERMINAL_MOUSE_LEGACY_LIMIT + 1, row: 1 };
    expect(terminalMouseReport({ button: 0, cell: past, released: false }, false)).toBeNull();
    expect(
      terminalMouseReport({ button: 0, cell: { column: 1, row: 400 }, released: false }, false)
    ).toBeNull();
    expect(text(terminalMouseReport({ button: 0, cell: past, released: false }, true))).toBe(
      '\x1b[<0;224;1M'
    );
  });
});

describe('a tap', () => {
  test('is a press and a release in one write, in SGR', () => {
    expect(
      text(terminalTouchTapBytes(cell, bits({ mouseButtons: true, mouseSgrEncoding: true })))
    ).toBe('\x1b[<0;4;7M\x1b[<0;4;7m');
  });

  test('is the same pair in X10', () => {
    expect(text(terminalTouchTapBytes(cell, bits({ mouseButtons: true })))).toBe(
      '\x1b[M\x20\x24\x27\x1b[M\x23\x24\x27'
    );
  });

  test('is nothing when no mouse mode is on', () => {
    expect(terminalTouchTapBytes(cell, bits({ alternateScreen: true }))).toBeNull();
    expect(terminalTouchTapBytes(cell, bits({ mouseSgrEncoding: true }))).toBeNull();
  });

  test('is nothing when X10 cannot name the cell', () => {
    expect(terminalTouchTapBytes({ column: 300, row: 1 }, bits({ mouseButtons: true }))).toBeNull();
  });

  test('the press and release halves are also available on their own', () => {
    const held = bits({ mouseButtonMotion: true, mouseSgrEncoding: true });
    expect(text(terminalTouchPressBytes(cell, held))).toBe('\x1b[<0;4;7M');
    expect(text(terminalTouchReleaseBytes(cell, held))).toBe('\x1b[<0;4;7m');
    expect(terminalTouchPressBytes(cell, bits())).toBeNull();
    expect(terminalTouchReleaseBytes(cell, bits())).toBeNull();
  });
});

describe('a drag in the mouse layer', () => {
  const mouse = bits({ mouseButtons: true, mouseSgrEncoding: true });

  test('downwards is the wheel turning up, one event per cell crossed', () => {
    expect(text(terminalTouchDragBytes({ cell, rows: 3, columns: 0, held: false }, mouse))).toBe(
      '\x1b[<64;4;7M'.repeat(3)
    );
  });

  test('upwards is the wheel turning down', () => {
    expect(text(terminalTouchDragBytes({ cell, rows: -2, columns: 0, held: false }, mouse))).toBe(
      '\x1b[<65;4;7M'.repeat(2)
    );
  });

  test('sideways alone says nothing -- the wheel has no useful horizontal', () => {
    expect(terminalTouchDragBytes({ cell, rows: 0, columns: 5, held: false }, mouse)).toBeNull();
  });

  test('X10 spells the same wheel', () => {
    const legacy = bits({ mouseButtons: true });
    expect(text(terminalTouchDragBytes({ cell, rows: 1, columns: 0, held: false }, legacy))).toBe(
      '\x1b[M\x60\x24\x27'
    );
  });

  test('a held drag is one motion report at the newest cell, not one per cell', () => {
    const drag = bits({ mouseButtonMotion: true, mouseSgrEncoding: true });
    expect(text(terminalTouchDragBytes({ cell, rows: 4, columns: 2, held: true }, drag))).toBe(
      '\x1b[<32;4;7M'
    );
    expect(text(terminalTouchDragBytes({ cell, rows: 0, columns: 1, held: true }, drag))).toBe(
      '\x1b[<32;4;7M'
    );
    expect(terminalTouchDragBytes({ cell, rows: 0, columns: 0, held: true }, drag)).toBeNull();
  });

  test('a flick is capped at a screenful of wheel events', () => {
    const bytes = terminalTouchDragBytes({ cell, rows: 400, columns: 0, held: false }, mouse);
    expect(text(bytes).split('M').length - 1).toBe(TERMINAL_TOUCH_EVENTS_PER_EMISSION);
  });
});

describe('a drag in the arrows layer', () => {
  const arrows = bits({ alternateScreen: true });
  const applicationArrows = bits({ alternateScreen: true, applicationCursorKeys: true });

  test('downwards is Up, one per cell, and CSI without DECCKM', () => {
    expect(text(terminalTouchDragBytes({ cell, rows: 2, columns: 0, held: false }, arrows))).toBe(
      '\x1b[A\x1b[A'
    );
  });

  test('upwards is Down', () => {
    expect(text(terminalTouchDragBytes({ cell, rows: -1, columns: 0, held: false }, arrows))).toBe(
      '\x1b[B'
    );
  });

  test('rightwards is Left and leftwards is Right, the content convention', () => {
    expect(text(terminalTouchDragBytes({ cell, rows: 0, columns: 2, held: false }, arrows))).toBe(
      '\x1b[D\x1b[D'
    );
    expect(text(terminalTouchDragBytes({ cell, rows: 0, columns: -1, held: false }, arrows))).toBe(
      '\x1b[C'
    );
  });

  test('both axes travel in one emission, vertical first', () => {
    expect(text(terminalTouchDragBytes({ cell, rows: 1, columns: 1, held: false }, arrows))).toBe(
      '\x1b[A\x1b[D'
    );
  });

  test('DECCKM moves them to SS3', () => {
    expect(
      text(terminalTouchDragBytes({ cell, rows: -1, columns: -1, held: false }, applicationArrows))
    ).toBe('\x1bOB\x1bOC');
  });

  test('a standstill is silence', () => {
    expect(terminalTouchDragBytes({ cell, rows: 0, columns: 0, held: false }, arrows)).toBeNull();
  });

  test('each axis is capped on its own', () => {
    const bytes = terminalTouchDragBytes({ cell, rows: 400, columns: 400, held: false }, arrows);
    expect(bytes!.length).toBe(TERMINAL_TOUCH_EVENTS_PER_EMISSION * 3 * 2);
  });

  test('a held flag means nothing here -- there is no button to hold', () => {
    expect(text(terminalTouchDragBytes({ cell, rows: 1, columns: 0, held: true }, arrows))).toBe(
      '\x1b[A'
    );
  });
});

describe('a drag in the scrollback layer', () => {
  test('produces no bytes at all, whatever it did', () => {
    for (const held of [false, true]) {
      expect(terminalTouchDragBytes({ cell, rows: 5, columns: 5, held }, bits())).toBeNull();
    }
    expect(
      terminalTouchDragBytes(
        { cell, rows: 5, columns: 0, held: false },
        bits({ applicationCursorKeys: true, mouseSgrEncoding: true })
      )
    ).toBeNull();
  });
});
