import { describe, expect, test } from 'bun:test';
import {
  clampPreviewTransform,
  containedPreviewSize,
  finishPreviewPan,
  panPreviewFrom,
  previewPageIndex,
  RESTING_PREVIEW,
  zoomPreviewAt,
  type PreviewSize,
} from '../image-preview-geometry';

const portrait = { width: 400, height: 800 };
const landscape = { width: 800, height: 400 };
const square = { width: 400, height: 400 };
const center = { x: 0, y: 0 };

describe('contained image geometry', () => {
  test('fits wide, tall and square images without stretching or upscaling assumptions', () => {
    expect(containedPreviewSize({ width: 1600, height: 400 }, portrait)).toEqual({
      width: 400,
      height: 100,
    });
    expect(containedPreviewSize({ width: 400, height: 1600 }, portrait)).toEqual({
      width: 200,
      height: 800,
    });
    expect(containedPreviewSize({ width: 40, height: 40 }, portrait)).toEqual(square);
    expect(containedPreviewSize({ width: 400, height: 1600 }, landscape)).toEqual({
      width: 100,
      height: 400,
    });
  });

  test('unloaded, invalid and zero-sized layouts have no zoomable geometry', () => {
    for (const source of [
      { width: 0, height: 0 },
      { width: -1, height: 2 },
      { width: NaN, height: 10 },
      { width: 10, height: Infinity },
    ]) {
      expect(containedPreviewSize(source, portrait)).toEqual({ width: 0, height: 0 });
      expect(zoomPreviewAt(RESTING_PREVIEW, 3, center, center, source, portrait)).toEqual(
        RESTING_PREVIEW
      );
    }
    for (const viewport of [
      { width: 0, height: 800 },
      { width: 400, height: 0 },
      { width: Infinity, height: 400 },
    ]) {
      expect(containedPreviewSize(square, viewport)).toEqual({ width: 0, height: 0 });
    }
  });

  test('wide images cannot move vertically while their scaled height still fits', () => {
    expect(
      clampPreviewTransform({ scale: 4, x: 9999, y: -9999 }, { width: 1600, height: 400 }, portrait)
    ).toEqual({ scale: 4, x: 600, y: 0 });
  });

  test('tall images cannot move horizontally while their scaled width still fits', () => {
    expect(
      clampPreviewTransform({ scale: 2, x: -9999, y: 9999 }, { width: 400, height: 1600 }, portrait)
    ).toEqual({ scale: 2, x: 0, y: 400 });
  });

  test('at 1x both offsets are exactly zero; shrinking clamps both axes immediately', () => {
    expect(clampPreviewTransform({ scale: 1, x: -300, y: 300 }, square, square)).toEqual(
      RESTING_PREVIEW
    );
    expect(clampPreviewTransform({ scale: 1.5, x: 600, y: -600 }, square, square)).toEqual({
      scale: 1.5,
      x: 100,
      y: -100,
    });
  });

  test('each frame remains bounded when an animation crosses an overflow threshold', () => {
    const source = { width: 800, height: 600 };
    expect(clampPreviewTransform({ scale: 2.5, x: 0, y: 100 }, source, portrait).y).toBe(0);
    expect(clampPreviewTransform({ scale: 3, x: 0, y: 200 }, source, portrait).y).toBe(50);
  });

  test('finite input boundaries are enforced without NaN reaching transforms', () => {
    expect(clampPreviewTransform({ scale: 99, x: Infinity, y: NaN }, square, square)).toEqual({
      scale: 4,
      x: 0,
      y: 0,
    });
    expect(clampPreviewTransform({ scale: NaN, x: 100, y: 100 }, square, square)).toEqual(
      RESTING_PREVIEW
    );
    expect(clampPreviewTransform({ scale: -1, x: 100, y: 100 }, square, square)).toEqual(
      RESTING_PREVIEW
    );
  });
});

describe('focal zoom and pan rebase', () => {
  test('double-tap zoom preserves the tapped image point, not the center', () => {
    const tap = { x: 60, y: -80 };
    const next = zoomPreviewAt(RESTING_PREVIEW, 2.5, tap, tap, square, square);
    expect(next).toEqual({ scale: 2.5, x: -90, y: 120 });
    expect((tap.x - next.x) / next.scale).toBeCloseTo(tap.x);
    expect((tap.y - next.y) / next.scale).toBeCloseTo(tap.y);
  });

  test('pinch preserves its initial image point under a moving focal point', () => {
    const start = { scale: 2, x: 50, y: -30 };
    const from = { x: 20, y: -10 };
    const to = { x: 40, y: 30 };
    const next = zoomPreviewAt(start, 3, from, to, square, square);
    expect(next).toEqual({ scale: 3, x: 85, y: 0 });
    expect((to.x - next.x) / next.scale).toBeCloseTo((from.x - start.x) / start.scale);
    expect((to.y - next.y) / next.scale).toBeCloseTo((from.y - start.y) / start.scale);
  });

  test('pinch translation at constant scale follows the focal point', () => {
    expect(
      zoomPreviewAt({ scale: 2, x: 20, y: -10 }, 2, center, { x: 30, y: 40 }, square, square)
    ).toEqual({ scale: 2, x: 50, y: 30 });
  });

  test('an off-image focal point stops at an image edge rather than exposing an empty screen', () => {
    expect(
      zoomPreviewAt(
        RESTING_PREVIEW,
        2.5,
        { x: 200, y: 400 },
        { x: 200, y: 400 },
        { width: 1600, height: 400 },
        portrait
      )
    ).toEqual({ scale: 2.5, x: -300, y: 0 });
  });

  test('zoom out from a translated image ends at a clean 1x; zooming below 1 is harmless', () => {
    const start = { scale: 4, x: 600, y: -600 };
    expect(zoomPreviewAt(start, 1, { x: -80, y: 50 }, { x: 40, y: 90 }, square, square)).toEqual(
      RESTING_PREVIEW
    );
    expect(zoomPreviewAt(start, 0.1, center, center, square, square)).toEqual(RESTING_PREVIEW);
  });

  test('repeated zoom in/out cycles do not accumulate offset', () => {
    let current = RESTING_PREVIEW;
    for (let cycle = 0; cycle < 20; cycle++) {
      const focal = { x: cycle * 5 - 40, y: 80 - cycle * 3 };
      current = zoomPreviewAt(current, 2.5, focal, focal, square, square);
      current = zoomPreviewAt(current, 1, focal, focal, square, square);
      expect(current).toEqual(RESTING_PREVIEW);
    }
  });

  test('rebasing a pinch with a new pointer centroid causes no transform jump', () => {
    const current = { scale: 2.5, x: 70, y: -90 };
    const newFocal = { x: -120, y: 130 };
    expect(zoomPreviewAt(current, current.scale, newFocal, newFocal, square, square)).toEqual(
      current
    );
  });

  test('one-finger continuation ignores the pan translation accumulated during pinch', () => {
    const current = { scale: 2.5, x: 70, y: -90 };
    const origin = { x: 250, y: -180 };
    expect(panPreviewFrom(current, origin, origin, square, square)).toEqual(current);
    expect(panPreviewFrom(current, origin, { x: 265, y: -160 }, square, square)).toEqual({
      scale: 2.5,
      x: 85,
      y: -70,
    });
  });

  test('one-finger continuation after shrinking to 1 cannot leave an offset', () => {
    expect(
      panPreviewFrom(RESTING_PREVIEW, { x: 250, y: -180 }, { x: 500, y: 400 }, square, square)
    ).toEqual(RESTING_PREVIEW);
  });

  test('pan clamps each axis using the decoded aspect ratio', () => {
    expect(
      panPreviewFrom(
        { scale: 3, x: 0, y: 0 },
        center,
        { x: -900, y: 900 },
        { width: 400, height: 1600 },
        portrait
      )
    ).toEqual({ scale: 3, x: -100, y: 800 });
  });

  test('geometry stays bounded across portrait/landscape and source aspect ratios', () => {
    const sources: PreviewSize[] = [
      square,
      { width: 1600, height: 400 },
      { width: 400, height: 1600 },
      { width: 1920, height: 1080 },
    ];
    for (const source of sources) {
      for (const viewport of [portrait, landscape, square]) {
        const size = containedPreviewSize(source, viewport);
        for (const scale of [0.5, 1, 1.01, 1.5, 2.5, 4, 8]) {
          for (const offset of [-10000, -100, 0, 100, 10000]) {
            const next = clampPreviewTransform({ scale, x: offset, y: -offset }, source, viewport);
            if (scale <= 1) expect(next).toEqual(RESTING_PREVIEW);
            expect(next.scale).toBeGreaterThanOrEqual(1);
            expect(next.scale).toBeLessThanOrEqual(4);
            expect(Math.abs(next.x)).toBeLessThanOrEqual(
              Math.max(0, (size.width * next.scale - viewport.width) / 2)
            );
            expect(Math.abs(next.y)).toBeLessThanOrEqual(
              Math.max(0, (size.height * next.scale - viewport.height) / 2)
            );
            expect(clampPreviewTransform(next, source, viewport)).toEqual(next);
          }
        }
      }
    }
  });
});

const release = {
  success: true,
  zoomedAtStart: false,
  usedMultiplePointers: false,
  axis: 'horizontal' as const,
  index: 1,
  count: 3,
  width: 400,
  translationX: -150,
  velocityX: 0,
  dragY: 0,
  velocityY: 0,
};

describe('pan completion and cancellation', () => {
  test('successful unzoomed swipes page once and short drags settle to the committed page', () => {
    expect(finishPreviewPan(release)).toEqual({ index: 2, dismiss: false });
    expect(finishPreviewPan({ ...release, translationX: 121 })).toEqual({
      index: 0,
      dismiss: false,
    });
    expect(finishPreviewPan({ ...release, translationX: 120 })).toEqual({
      index: 1,
      dismiss: false,
    });
  });

  test('a flick follows release velocity, even after reversing direction', () => {
    expect(finishPreviewPan({ ...release, translationX: -10, velocityX: 800 })).toEqual({
      index: 0,
      dismiss: false,
    });
    expect(finishPreviewPan({ ...release, translationX: 10, velocityX: -800 })).toEqual({
      index: 2,
      dismiss: false,
    });
  });

  test('paging clamps at both edges and handles empty and singleton sets', () => {
    expect(finishPreviewPan({ ...release, index: 2 })).toEqual({ index: 2, dismiss: false });
    expect(finishPreviewPan({ ...release, index: 0, translationX: 200 })).toEqual({
      index: 0,
      dismiss: false,
    });
    expect(finishPreviewPan({ ...release, count: 1, index: 0 })).toEqual({
      index: 0,
      dismiss: false,
    });
    expect(finishPreviewPan({ ...release, count: 0 })).toEqual({ index: 0, dismiss: false });
  });

  test('only downward distance or velocity dismisses; a short/upward drag settles', () => {
    expect(finishPreviewPan({ ...release, axis: 'vertical', dragY: 121 })).toEqual({
      index: 1,
      dismiss: true,
    });
    expect(finishPreviewPan({ ...release, axis: 'vertical', velocityY: 901 })).toEqual({
      index: 1,
      dismiss: true,
    });
    expect(
      finishPreviewPan({ ...release, axis: 'vertical', dragY: 120, velocityY: -1000 })
    ).toEqual({ index: 1, dismiss: false });
    expect(finishPreviewPan({ ...release, axis: null, dragY: 200 })).toEqual({
      index: 1,
      dismiss: false,
    });
  });

  test('cancelled/failed handlers cannot page or dismiss even above all thresholds', () => {
    expect(finishPreviewPan({ ...release, success: false, velocityX: -2000 })).toEqual({
      index: 1,
      dismiss: false,
    });
    expect(
      finishPreviewPan({
        ...release,
        success: false,
        axis: 'vertical',
        dragY: 500,
        velocityY: 2000,
      })
    ).toEqual({ index: 1, dismiss: false });
  });

  test('a zoomed-start stream cannot become navigation at its tail', () => {
    expect(finishPreviewPan({ ...release, zoomedAtStart: true })).toEqual({
      index: 1,
      dismiss: false,
    });
    expect(
      finishPreviewPan({ ...release, zoomedAtStart: true, axis: 'vertical', dragY: 500 })
    ).toEqual({ index: 1, dismiss: false });
  });

  test('a pinch-to-1 stream remains non-navigating after one finger is lifted', () => {
    expect(finishPreviewPan({ ...release, usedMultiplePointers: true, velocityX: -2000 })).toEqual({
      index: 1,
      dismiss: false,
    });
    expect(
      finishPreviewPan({
        ...release,
        usedMultiplePointers: true,
        axis: 'vertical',
        dragY: 500,
        velocityY: 2000,
      })
    ).toEqual({ index: 1, dismiss: false });
  });

  test('image selection is bounded for changed lists and invalid initial indices', () => {
    expect(previewPageIndex(9, 3)).toBe(2);
    expect(previewPageIndex(-1, 3)).toBe(0);
    expect(previewPageIndex(NaN, 3)).toBe(0);
    expect(previewPageIndex(1.5, 3)).toBe(1);
    expect(previewPageIndex(4, 0)).toBe(0);
  });
});
