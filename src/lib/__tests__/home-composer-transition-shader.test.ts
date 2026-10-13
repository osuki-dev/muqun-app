import { afterAll, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import CanvasKitInit from 'canvaskit-wasm';

import { HOME_COMPOSER_TRANSITION_SKSL } from '../home-composer-transition-shader';

const require = createRequire(import.meta.url);
const kit = await CanvasKitInit({
  locateFile: (file) => join(dirname(require.resolve('canvaskit-wasm')), file),
});
const diagnostics: string[] = [];
const effect = kit.RuntimeEffect.Make(HOME_COMPOSER_TRANSITION_SKSL, (error) =>
  diagnostics.push(error)
);
afterAll(() => effect?.delete());

function render(phase: number, progress: number, opacity = 1) {
  if (!effect) throw new Error(diagnostics.join('\n'));
  const surface = kit.MakeSurface(240, 108)!;
  const shader = effect.makeShader([240, 108, 14, phase, progress, 0.1, 0.5, 0.7, opacity]);
  const paint = new kit.Paint();
  try {
    paint.setShader(shader);
    surface.getCanvas().clear(kit.TRANSPARENT);
    surface.getCanvas().drawPaint(paint);
    const pixels = surface.getCanvas().readPixels(0, 0, {
      width: 240,
      height: 108,
      colorType: kit.ColorType.RGBA_8888,
      alphaType: kit.AlphaType.Premul,
      colorSpace: kit.ColorSpace.SRGB,
    });
    if (!pixels) throw new Error('Skia did not render the composer transition');
    return Uint8Array.from(pixels);
  } finally {
    paint.delete();
    shader.delete();
    surface.delete();
  }
}

test('the real shader renders each step while leaving the draft and controls transparent', () => {
  for (const phase of [0, 1, 2]) {
    const pixels = render(phase, 0.4);
    expect(pixels.some((channel) => channel > 0)).toBe(true);
    let centerClear = true;
    for (let y = 16; y < 92; y++)
      for (let x = 16; x < 224; x++) centerClear &&= pixels[(y * 240 + x) * 4 + 3] === 0;
    expect(centerClear).toBe(true);
    expect(render(phase, 0).every((channel) => channel === 0)).toBe(true);
    expect(render(phase, 1).every((channel) => channel === 0)).toBe(true);
  }
});

test('theme opacity scales the premultiplied rim, including fully transparent themes', () => {
  const full = render(2, 0.45);
  const half = render(2, 0.45, 0.5);
  expect(render(2, 0.45, 0).every((channel) => channel === 0)).toBe(true);
  expect(half.every((channel, index) => Math.abs(channel - full[index]! * 0.5) <= 1)).toBe(true);
  expect(full.every((channel, index) => channel <= full[index - (index % 4) + 3]!)).toBe(true);
});
