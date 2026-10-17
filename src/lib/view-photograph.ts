import { Skia, type SkImage } from 'react-native-skia';
import { importDevice } from 'react-native-webgpu';
import { PixelRatio, type ViewInstance } from 'react-native';
import type { RefObject } from 'react';

/**
 * A picture of one native view, taken by React Native WebGPU.
 *
 * Skia 3.6 removed `makeImageFromView`; the platform now rasterizes the view
 * into a texture on Skia's own device (`queue.drawElementImageToTexture`), and
 * `MakeImageFromGPUTexture` wraps that texture without a copy. The image keeps
 * the texture alive only by reference, so {@link disposeViewPhotograph}
 * destroys the texture when the picture goes. The capture is a promise.
 *
 * The view is drawn with its own `draw`, so a view the reader cannot see
 * (opacity 0) photographs as it would look shown. It must be a real native
 * view: give it `collapsable={false}`.
 */
export async function photographView(
  ref: RefObject<ViewInstance | null>,
  width: number,
  height: number
): Promise<SkImage | null> {
  if (!ref.current || width <= 0 || height <= 0) return null;
  const scale = PixelRatio.get();
  const texture = sharedDevice().createTexture({
    size: [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING,
  });
  try {
    // Skia images are premultiplied.
    await sharedDevice().queue.drawElementImageToTexture(
      { source: ref },
      { texture, premultipliedAlpha: true }
    );
    const image = Skia.Image.MakeImageFromGPUTexture(texture);
    textures.set(image, texture);
    return image;
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

let device: GPUDevice | null = null;

/** Skia's render device, wrapped once; the two libraries share one Dawn. */
function sharedDevice(): GPUDevice {
  device ??= importDevice(Skia.getNativeDevice());
  return device;
}

/** The texture each photograph samples, destroyed with the photograph. */
const textures = new Map<SkImage, GPUTexture>();

/**
 * Give an image back to Skia, and its texture (if it is a photograph) back to
 * the device. Only once nothing can still be drawing it.
 */
export function disposeViewPhotograph(image: SkImage): void {
  image.dispose();
  textures.get(image)?.destroy();
  textures.delete(image);
}
