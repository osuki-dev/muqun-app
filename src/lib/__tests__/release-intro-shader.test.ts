import { afterAll, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import CanvasKitInit from 'canvaskit-wasm';
import { RELEASE_INTRO_SKSL } from '../release-intro-shader';

const require = createRequire(import.meta.url);
const kit = await CanvasKitInit({
  locateFile: (file) => join(dirname(require.resolve('canvaskit-wasm')), file),
});
const diagnostics: string[] = [];
const effect = kit.RuntimeEffect.Make(RELEASE_INTRO_SKSL, (message) => diagnostics.push(message));
afterAll(() => effect?.delete());

function render(scene: number, time: number, dark = false) {
  if (!effect) throw new Error(diagnostics.join('\n'));
  const surface = kit.MakeSurface(160, 140)!;
  const ink = dark ? 0.95 : 0.08;
  const shader = effect.makeShader([160, 140, time, scene, 0.2, 0.4, 0.8, ink, ink, ink]);
  const paint = new kit.Paint();
  try {
    paint.setShader(shader);
    surface.getCanvas().clear(kit.TRANSPARENT);
    surface.getCanvas().drawPaint(paint);
    return Uint8Array.from(
      surface.getCanvas().readPixels(0, 0, {
        width: 160,
        height: 140,
        colorType: kit.ColorType.RGBA_8888,
        alphaType: kit.AlphaType.Premul,
        colorSpace: kit.ColorSpace.SRGB,
      })!
    );
  } finally {
    paint.delete();
    shader.delete();
    surface.delete();
  }
}

test('release particles compile, morph between all three chapters and drift with time', () => {
  expect(diagnostics).toEqual([]);
  expect(effect).not.toBeNull();
  const first = render(0, 0);
  expect(first.some((value) => value > 0)).toBe(true);
  expect(first).not.toEqual(render(1, 0));
  expect(render(1, 0)).not.toEqual(render(2, 0));
  expect(first).not.toEqual(render(0, 1));
  expect(first).not.toEqual(render(0.5, 0));
});

test('light and dark frames have transparent edges and valid premultiplied soft particles', () => {
  for (const dark of [false, true]) {
    for (const scene of [0, 0.5, 1, 1.5, 2]) {
      const pixels = render(scene, 2, dark);
      let soft = 0;
      let validPremultiplication = true;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3]!;
        if (Math.max(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) > alpha)
          validPremultiplication = false;
        if (alpha > 20 && alpha < 220) soft++;
      }
      expect(validPremultiplication).toBe(true);
      expect(soft).toBeGreaterThan(80);
      expect(pixels[3]).toBe(0);
      expect(pixels[(140 * 160 - 1) * 4 + 3]).toBe(0);
    }
  }
});
