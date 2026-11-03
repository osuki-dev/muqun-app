import { AlphaType, ColorType, type SkImage } from 'react-native-skia';

/** One Alpha_8 byte per pixel of a whole image, unpremultiplied. */
export type AlphaPlane = { width: number; height: number; pixels: Uint8Array };

/**
 * Skia 3.x reads pixels asynchronously: `readPixels` returns a promise, and a
 * `Uint8Array` only once it resolves. One full-plane read per image feeds every
 * edge and extent check that used to read single pixels synchronously.
 */
export async function readAlphaPlane(image: SkImage): Promise<AlphaPlane | null> {
  const width = image.width();
  const height = image.height();
  if (width < 1 || height < 1) return null;
  const pixels = await image.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.Alpha_8,
    alphaType: AlphaType.Unpremul,
  });
  return pixels instanceof Uint8Array && pixels.length >= width * height
    ? { width, height, pixels }
    : null;
}

/** The alpha reader the edge checks take, over a plane already in memory. */
export function alphaAt(plane: AlphaPlane): (x: number, y: number) => number | undefined {
  return (x, y) => plane.pixels[y * plane.width + x];
}
