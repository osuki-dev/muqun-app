/**
 * Derives the Android launcher layers from the rendered mascot.
 *
 *   bun run scripts/generate-brand-assets.ts
 *
 * The masters are hand-made renders and live in `assets/images`:
 * `icon.png` / `icon-dark.png` (the mascot on its plate, what iOS shows),
 * `brand-mark-3d.png` / `brand-mark-3d-dark.png` (the mascot alone, with
 * alpha, what the app and the launch screen show) and `favicon.png`. Two
 * files are derived rather than drawn and this script is where they come
 * from, so a new render regenerates them instead of someone redoing them in
 * an editor:
 *
 *  - `android-icon-foreground.png`: the light icon on the 108 dp adaptive
 *    canvas. The plate is the same cream as `adaptiveIcon.backgroundColor`,
 *    so it may run a hair past the 66 dp safe zone without a visible edge.
 *  - `android-icon-monochrome.png`: the mascot's silhouette in white, for
 *    themed launchers. The soft shadow under the feet is cut by the alpha
 *    threshold; a blob there reads as a stain once tinted.
 *
 * `@expo/image-utils` is what Expo's own icon plugin draws with, and its
 * bundled jimp is the one image library already in the tree.
 */
import { createSquareAsync, getJimpImageAsync } from '@expo/image-utils/build/jimp';

const IMAGES = new URL('../assets/images/', import.meta.url).pathname;
const CANVAS = 1024;
const ICON_SIZE = 672;
const SILHOUETTE_BOX = 600;
const SILHOUETTE_ALPHA = 200;
const SILHOUETTE_CHROMA = 120;

async function transparentCanvas() {
  return getJimpImageAsync(
    await createSquareAsync({ size: CANVAS, color: 'transparent', mime: 'image/png' })
  );
}

async function foreground() {
  const canvas = await transparentCanvas();
  const icon = await getJimpImageAsync(`${IMAGES}icon.png`);
  icon.resize(ICON_SIZE, ICON_SIZE);
  const inset = (CANVAS - ICON_SIZE) / 2;
  canvas.composite(icon, inset, inset);
  await canvas.writeAsync(`${IMAGES}android-icon-foreground.png`);
}

async function monochrome() {
  const mark = await getJimpImageAsync(`${IMAGES}brand-mark-3d.png`);
  const { width, height, data } = mark.bitmap;
  // The body is saturated coral and everything drawn on it sits inside its
  // outline; the drop shadow is grey. Chroma tells them apart, and the eyes
  // and highlights it leaves out are holes filled below.
  const body = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    body[i] = data[i * 4 + 3] >= SILHOUETTE_ALPHA && chroma >= SILHOUETTE_CHROMA ? 1 : 0;
  }
  const outside = floodFromEdges(body, width, height);
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const opaque = outside[i] === 0;
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = opaque ? 255 : 0;
      if (!opaque) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  mark.crop(left, top, right - left + 1, bottom - top + 1);
  const scale = SILHOUETTE_BOX / Math.max(mark.bitmap.width, mark.bitmap.height);
  mark.resize(Math.round(mark.bitmap.width * scale), Math.round(mark.bitmap.height * scale));
  const canvas = await transparentCanvas();
  canvas.composite(
    mark,
    Math.round((CANVAS - mark.bitmap.width) / 2),
    Math.round((CANVAS - mark.bitmap.height) / 2)
  );
  await canvas.writeAsync(`${IMAGES}android-icon-monochrome.png`);
}

/** 1 for every non-body pixel reachable from the canvas edge; holes inside the body stay 0. */
function floodFromEdges(body: Uint8Array, width: number, height: number) {
  const outside = new Uint8Array(width * height);
  const queue: number[] = [];
  const push = (i: number) => {
    if (body[i] === 0 && outside[i] === 0) {
      outside[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (queue.length > 0) {
    const i = queue.pop() as number;
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i + width < width * height) push(i + width);
  }
  return outside;
}

await foreground();
await monochrome();
console.log('android-icon-foreground.png and android-icon-monochrome.png regenerated');
