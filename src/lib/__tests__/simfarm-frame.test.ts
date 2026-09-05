// Where the simulator's picture goes, and which pixel a finger hit.
//
// Both halves of the report this file exists for are silent failures. A picture
// laid out wrong looks like a design decision -- the preview drew an iPhone at
// half the width of the screen for weeks and read as "the preview is small" --
// and a touch resolved against a different rectangle than the one on screen
// looks like a tap that did nothing, which is the other half of the same
// report. Neither raises anything.
//
// So the numbers here are the reported case, and the property that matters most
// is the round trip: whatever the zoom and wherever the picture has been
// dragged to, a point on the drawn picture has to come back as the same
// fraction of the device. That is the whole of "a tap lands where you put it".
import { describe, expect, test } from 'bun:test';

import {
  clampSimfarmOffset,
  placeSimfarmFrame,
  SIMFARM_ANDROID_EDGE_REACH,
  simfarmEdgeAt,
  simfarmEdgeBands,
  simfarmFitScale,
  simfarmRestingOffset,
  simfarmNormalizedPoint,
  SIMFARM_MAX_ZOOM,
} from '@/lib/simfarm-frame';

/** An iPhone 17 Pro: 1206x2622 at 3x, which is what simfarm reports for one. */
const IPHONE = { width: 402, height: 874 };
/** The sheet on the phone this was reported from, measured in the client. */
const PHONE_SHEET = { width: 402, height: 812 };

describe('simfarmFitScale', () => {
  test('a portrait surface fills its width', () => {
    // The number this whole change is about. simfarm's own client reserved a
    // rail column, a margin and a pill row out of this same 402x812 surface and
    // then snapped what was left down to 50%, so it drew the device 201pt wide.
    // Filling the width is 402.
    expect(simfarmFitScale(IPHONE, PHONE_SHEET)).toBe(1);
    expect(IPHONE.width * simfarmFitScale(IPHONE, PHONE_SHEET)).toBe(PHONE_SHEET.width);
  });

  test('a narrower surface than the device still fills its width', () => {
    // A 393pt Android phone looking at a 402pt iPhone: still the full width,
    // now at less than 1:1 rather than at a snap point below it.
    expect(simfarmFitScale(IPHONE, { width: 393, height: 830 })).toBeCloseTo(393 / 402, 10);
  });

  test('a landscape surface fills its height instead', () => {
    // Filling the width here would put a picture three screens tall in front of
    // someone. The short side is the one that binds.
    expect(simfarmFitScale(IPHONE, { width: 1024, height: 768 })).toBeCloseTo(768 / 874, 10);
  });

  test('a square surface counts as portrait, and nothing divides by zero', () => {
    expect(simfarmFitScale(IPHONE, { width: 500, height: 500 })).toBeCloseTo(500 / 402, 10);
    expect(simfarmFitScale({ width: 0, height: 0 }, PHONE_SHEET)).toBe(1);
    expect(simfarmFitScale(IPHONE, { width: 0, height: 0 })).toBe(1);
  });
});

describe('placeSimfarmFrame', () => {
  test('fills the width and centres the overflow', () => {
    const placed = placeSimfarmFrame(IPHONE, PHONE_SHEET);
    expect(placed.width).toBe(402);
    expect(placed.height).toBe(874);
    expect(placed.x).toBe(0);
    // 62pt over, half of it off each end, so both are the same reach away.
    expect(placed.y).toBe(-31);
  });

  test('a device shorter than the surface sits centred with no offset', () => {
    const placed = placeSimfarmFrame({ width: 402, height: 600 }, PHONE_SHEET);
    expect(placed.y).toBe((812 - 600) / 2);
  });

  test('zoom multiplies the fit and is clamped at both ends', () => {
    expect(placeSimfarmFrame(IPHONE, PHONE_SHEET, 2).width).toBe(804);
    // Below the fit there would be background on every side again, which is the
    // state being fixed; above 4x a pinch is scrolling around a blur.
    expect(placeSimfarmFrame(IPHONE, PHONE_SHEET, 0.25).width).toBe(402);
    expect(placeSimfarmFrame(IPHONE, PHONE_SHEET, 99).width).toBe(402 * SIMFARM_MAX_ZOOM);
  });

  test('a pan cannot drag either end past the surface', () => {
    const far = placeSimfarmFrame(IPHONE, PHONE_SHEET, 1, { x: 500, y: 500 });
    // Nothing to spare across, so the axis with room does not move at all.
    expect(far.x).toBe(0);
    // 62pt of overflow means 31pt of travel, and no more.
    expect(far.y).toBe(0);
  });
});

describe('clampSimfarmOffset', () => {
  test('an axis with room to spare is pinned', () => {
    expect(
      clampSimfarmOffset({ width: 300, height: 400 }, { width: 402, height: 812 }, { x: 40, y: 40 })
    ).toEqual({ x: 0, y: 0 });
  });

  test('an axis that overflows may move by half the overflow, either way', () => {
    const content = { width: 402, height: 1000 };
    const viewport = { width: 402, height: 800 };
    expect(clampSimfarmOffset(content, viewport, { x: 0, y: 999 })).toEqual({ x: 0, y: 100 });
    expect(clampSimfarmOffset(content, viewport, { x: 0, y: -999 })).toEqual({ x: 0, y: -100 });
    expect(clampSimfarmOffset(content, viewport, { x: 0, y: 40 })).toEqual({ x: 0, y: 40 });
  });
});

describe('simfarmNormalizedPoint', () => {
  test('the centre of the drawn picture is the centre of the device, at any zoom or pan', () => {
    // The property the input mapping stands on. If this holds, a tap lands
    // where it was put no matter what the reader has done to the view; if it
    // does not, a tap lands somewhere else and looks like a tap that did
    // nothing -- which is exactly what was reported.
    for (const zoom of [1, 1.37, 2, SIMFARM_MAX_ZOOM]) {
      for (const offset of [
        { x: 0, y: 0 },
        { x: -80, y: 40 },
        { x: 250, y: -250 },
      ]) {
        const placed = placeSimfarmFrame(IPHONE, PHONE_SHEET, zoom, offset);
        const centre = simfarmNormalizedPoint(
          { x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 },
          placed
        );
        expect(centre.x).toBeCloseTo(0.5, 10);
        expect(centre.y).toBeCloseTo(0.5, 10);
      }
    }
  });

  test('a known control resolves to the fraction it occupies on the device', () => {
    // A button 40pt wide whose centre is 80pt from the left and 200pt down a
    // 402x874 device, with the picture at the fit: 80/402 and 200/874.
    const placed = placeSimfarmFrame(IPHONE, PHONE_SHEET);
    const point = simfarmNormalizedPoint({ x: placed.x + 80, y: placed.y + 200 }, placed);
    expect(point.x).toBeCloseTo(80 / 402, 10);
    expect(point.y).toBeCloseTo(200 / 874, 10);
  });

  test('a point past the edge is clamped, not dropped', () => {
    // A swipe that begins on the picture and finishes past it is a real gesture
    // -- an upward swipe on a device drawn taller than the sheet is exactly
    // that -- and dropping its end would leave a touch down on the device.
    const placed = placeSimfarmFrame(IPHONE, PHONE_SHEET);
    expect(simfarmNormalizedPoint({ x: -500, y: -500 }, placed)).toEqual({ x: 0, y: 0 });
    expect(simfarmNormalizedPoint({ x: 5000, y: 5000 }, placed)).toEqual({ x: 1, y: 1 });
  });

  test('a picture with no size answers the origin rather than NaN', () => {
    const empty = { x: 0, y: 0, width: 0, height: 0, scale: 1 };
    expect(simfarmNormalizedPoint({ x: 10, y: 10 }, empty)).toEqual({ x: 0, y: 0 });
  });
});

describe('simfarmEdgeAt', () => {
  test('names the edge a system gesture would have started from', () => {
    expect(simfarmEdgeAt({ x: 0.5, y: 0.01 })).toBe('top');
    expect(simfarmEdgeAt({ x: 0.5, y: 0.99 })).toBe('bottom');
    expect(simfarmEdgeAt({ x: 0.01, y: 0.5 })).toBe('left');
    expect(simfarmEdgeAt({ x: 0.99, y: 0.5 })).toBe('right');
  });

  test('the middle is not an edge', () => {
    expect(simfarmEdgeAt({ x: 0.5, y: 0.5 })).toBe('none');
    expect(simfarmEdgeAt({ x: 0.2, y: 0.2 })).toBe('none');
  });

  test('a corner resolves to one edge, the nearer one', () => {
    // The wire has one byte for this and a device has one gesture for it, so
    // "both" is not an answer that can be sent.
    expect(simfarmEdgeAt({ x: 0.04, y: 0.01 })).toBe('top');
    expect(simfarmEdgeAt({ x: 0.01, y: 0.04 })).toBe('left');
  });
});

describe('simfarmRestingOffset', () => {
  // Full screen, the surface begins under the camera cutout: the iPhone from
  // the report on a viewport 62pt shorter than itself.
  const frame = { width: 402, height: 874 };
  const viewport = { width: 402, height: 812 };

  test('a device taller than the surface rests with its top at the top', () => {
    const rest = simfarmRestingOffset(frame, viewport);
    expect(rest).toEqual({ x: 0, y: 31 });
    // Which is the same thing as "drawn from y = 0": the overflow hangs off
    // the bottom, not half of it off each end.
    expect(placeSimfarmFrame(frame, viewport, 1, rest).y).toBe(0);
  });

  test('a device that fits rests centred', () => {
    expect(simfarmRestingOffset({ width: 402, height: 700 }, viewport)).toEqual({ x: 0, y: 0 });
  });

  test('is a pan the clamp agrees with', () => {
    const rest = simfarmRestingOffset(frame, viewport);
    const placed = placeSimfarmFrame(frame, viewport);
    expect(clampSimfarmOffset(placed, viewport, rest)).toEqual(rest);
  });

  test('follows the zoom, clamped the way the placement clamps it', () => {
    const zoomed = simfarmRestingOffset(frame, viewport, 2);
    expect(zoomed.y).toBe((874 * 2 - 812) / 2);
    expect(simfarmRestingOffset(frame, viewport, 10)).toEqual(
      simfarmRestingOffset(frame, viewport, 4)
    );
  });
});

describe('simfarmEdgeBands', () => {
  test('an iOS viewer keeps the one fraction on both axes', () => {
    expect(simfarmEdgeBands('ios', 402)).toEqual({ x: 0.05, y: 0.05 });
  });

  test('an Android viewer widens the sides past the system back strip', () => {
    // A 402pt iPhone drawn 411dp wide on the emulator: the system takes the
    // first ~24dp of the screen, so the device's edge reaches 40dp in.
    const bands = simfarmEdgeBands('android', 411);
    expect(bands.x).toBeCloseTo(SIMFARM_ANDROID_EDGE_REACH / 411, 10);
    expect(bands.y).toBe(0.05);
    // A swipe that begins at 30dp -- past the system's strip, inside the
    // reach -- is the device's left edge.
    expect(simfarmEdgeAt({ x: 30 / 411, y: 0.5 }, bands)).toBe('left');
    expect(simfarmEdgeAt({ x: 60 / 411, y: 0.5 }, bands)).toBe('none');
  });

  test('never narrower than the fraction, and harmless without a width', () => {
    expect(simfarmEdgeBands('android', 4000).x).toBe(0.05);
    expect(simfarmEdgeBands('android', 0)).toEqual({ x: 0.05, y: 0.05 });
  });

  test('a corner goes to the edge it is deeper into, by band', () => {
    // 5pt from the top and 30dp from the left on Android: the top band is
    // the thinner one, and the point is a fifth of the way into it versus
    // three quarters of the way into the side band.
    const bands = simfarmEdgeBands('android', 411);
    expect(simfarmEdgeAt({ x: 30 / 411, y: 5 / 874 }, bands)).toBe('top');
  });
});
