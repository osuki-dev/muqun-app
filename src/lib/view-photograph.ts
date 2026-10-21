import { Skia, type SkImage } from 'react-native-skia';
import { importDevice } from 'react-native-webgpu';
import { PixelRatio, Platform, type ViewInstance } from 'react-native';
import type { RefObject } from 'react';

import { isViewPhotographImportFailure } from '@/lib/view-photograph-policy';

export interface ViewPhotographOptions {
  /**
   * Allow an explicit CPU readback retry. Defaults to true for occasional
   * captures such as re-skin. False skips Android below API 33 and known
   * import failures, so a gesture can cross-fade instead. The native library
   * may still fall back internally when hardware rendering fails.
   */
  allowReadback?: boolean;
  /**
   * Whether to try the zero-copy import first. False goes straight to the
   * copy: one CPU readback, but no hardware buffer imported into the device a
   * live WebGPU canvas shares.
   */
  zeroCopy?: boolean;
}

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
  height: number,
  { allowReadback = true, zeroCopy = true }: ViewPhotographOptions = {}
): Promise<SkImage | null> {
  if (!ref.current || width <= 0 || height <= 0) return null;
  if (!allowReadback && (zeroCopyFailed || (Platform.OS === 'android' && Platform.Version < 33))) {
    return null;
  }
  if (zeroCopy && !zeroCopyFailed) {
    try {
      return await capture(ref, width, height, true);
    } catch (error) {
      // An unmounted or not-yet-laid-out view is not evidence that this
      // device cannot import GPU buffers. Let its caller abandon the move.
      if (!isViewPhotographImportFailure(error)) throw error;
      zeroCopyFailed = true;
    }
  }
  if (!allowReadback) return null;
  return capture(ref, width, height, false);
}

/**
 * Whether the zero-copy path has failed on this device. A texture that can be
 * rendered to lets the platform hand over the GPU buffer it drew the view
 * into; without `RENDER_ATTACHMENT` it reads the pixels back and uploads them,
 * which costs a copy but works wherever WebGPU does.
 */
let zeroCopyFailed = false;

async function capture(
  ref: RefObject<ViewInstance | null>,
  width: number,
  height: number,
  zeroCopy: boolean
): Promise<SkImage> {
  const scale = PixelRatio.get();
  const texture = sharedDevice().createTexture({
    size: [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.TEXTURE_BINDING |
      (zeroCopy ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
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
