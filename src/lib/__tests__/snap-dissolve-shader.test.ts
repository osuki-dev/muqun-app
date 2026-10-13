import { afterAll, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import CanvasKitInit from 'canvaskit-wasm';
import { SNAP_DUST_SKSL, snapCellSize } from '../snap-dissolve';

const require = createRequire(import.meta.url);
const kit = await CanvasKitInit({
  locateFile: (file) => join(dirname(require.resolve('canvaskit-wasm')), file),
});
const diagnostics: string[] = [];
const effect = kit.RuntimeEffect.Make(SNAP_DUST_SKSL, (message) => diagnostics.push(message));
afterAll(() => effect?.delete());
const width = 180;
const height = 240;
const info = {
  width,
  height,
  colorType: kit.ColorType.RGBA_8888,
  alphaType: kit.AlphaType.Premul,
  colorSpace: kit.ColorSpace.SRGB,
};

function render(progress: number, dark = false, transparent = false) {
  if (!effect) throw new Error(diagnostics.join('\n'));
  const source = kit.MakeSurface(width, height)!;
  const target = kit.MakeSurface(width, height)!;
  const paint = new kit.Paint();
  source
    .getCanvas()
    .clear(transparent ? kit.TRANSPARENT : dark ? kit.Color(30, 35, 45) : kit.Color(239, 229, 205));
  paint.setColor(kit.Color(54, 90, 180, transparent ? 0.6 : 1));
  source.getCanvas().drawCircle(width / 2, height / 2, 56, paint);
  const original = Uint8Array.from(source.getCanvas().readPixels(0, 0, info)!);
  const image = source.makeImageSnapshot();
  const child = image.makeShaderOptions(
    kit.TileMode.Decal,
    kit.TileMode.Decal,
    kit.FilterMode.Linear,
    kit.MipmapMode.None
  );
  const shader = effect.makeShaderWithChildren(
    [width, height, snapCellSize(width, height, 1), progress],
    [child]
  );
  try {
    paint.setColor(kit.WHITE);
    paint.setShader(shader);
    target.getCanvas().clear(kit.TRANSPARENT);
    target.getCanvas().drawPaint(paint);
    return { original, pixels: Uint8Array.from(target.getCanvas().readPixels(0, 0, info)!) };
  } finally {
    paint.delete();
    shader.delete();
    child.delete();
    image.delete();
    source.delete();
    target.delete();
  }
}

function averageAlpha(pixels: Uint8Array) {
  let sum = 0;
  for (let i = 3; i < pixels.length; i += 4) sum += pixels[i]!;
  return sum / (pixels.length / 4);
}

test('the real dust shader compiles and preserves the snapshot exactly at the handoff', () => {
  expect(diagnostics).toEqual([]);
  for (const dark of [false, true]) {
    for (const transparent of [false, true]) {
      const { original, pixels } = render(0, dark, transparent);
      expect(pixels.filter((channel, index) => channel !== original[index]).length).toBe(0);
      expect(render(1, dark, transparent).pixels.some((channel) => channel !== 0)).toBe(false);
    }
  }
});

test('erosion opens the edges first and fades all remaining dust before unmount', () => {
  const early = render(0.24).pixels;
  expect(early[(120 * width + 90) * 4 + 3]).toBe(255);
  expect(early[(120 * width + 3) * 4 + 3]).toBeLessThan(200);
  const middle = render(0.5).pixels;
  const late = render(0.85).pixels;
  expect(averageAlpha(middle)).toBeGreaterThan(averageAlpha(late));
  expect(averageAlpha(middle)).toBeLessThan(averageAlpha(early));
  expect(averageAlpha(render(0.99).pixels)).toBeLessThan(0.02);
  let soft = 0;
  for (let i = 3; i < middle.length; i += 4) if (middle[i]! > 0 && middle[i]! < 255) soft++;
  expect(soft).toBeGreaterThan(width * height * 0.1);
});

test('soft ash keeps valid premultiplied alpha on light, dark and transparent artwork', () => {
  for (const dark of [false, true]) {
    for (const transparent of [false, true]) {
      const pixels = render(0.56, dark, transparent).pixels;
      let valid = true;
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > pixels[i + 3]!) valid = false;
      }
      expect(valid).toBe(true);
    }
  }
});
