import {
  AlphaType,
  ColorType,
  FilterMode,
  MipmapMode,
  Skia,
  type SkImage,
} from 'react-native-skia';
import { useEffect, useEffectEvent, useState } from 'react';

import { hasTransparentArtworkUpperEdges } from '@/lib/artwork-edge-alpha';
import {
  stageAlphaContent,
  stageClearFraction,
  type StageImageBounds,
} from '@/lib/home-stage-layers';
import { createRefCountedCache } from '@/lib/ref-counted-cache';
import { useSharedSkiaImage } from '@/lib/skia-image-cache';
import {
  currentStageArtEpoch,
  noteStageArtFailure,
  recordStageArtEvent,
  useStageArtEpoch,
} from '@/lib/stage-art-diagnostics';
import {
  stageArtErrorText,
  stageArtRetryEdge,
  stageArtShouldRetry,
  type StageArtSlot,
  type StageArtStep,
} from '@/lib/stage-art-log';
import { stageTextureFromPixels, type StageTextureSource } from './stage-scene';

/** The longest edge a picture is shrunk to before its clear pixels are counted. */
const MEASURE_EDGE = 128;
/** The picture's shape, clear share, visible bounds and whether its foot is a painted edge. */
export type StagePictureFacts = {
  clear: number;
  aspect: number;
  bounds?: StageImageBounds;
  solidBottom?: boolean;
  decodeFailed?: boolean;
};
const FAILED_PICTURE: StagePictureFacts = { clear: 0, aspect: 1, decodeFailed: true };
/**
 * Pictures already measured: a theme's pictures are measured once. Only real
 * measurements are kept; a fallback guess is measured again next time. Theme
 * assets are named by their content hash, so a URI never changes meaning.
 */
const measuredFacts = new Map<string, StagePictureFacts>();

/**
 * A picture's failures and whether it may be tried again: a failure holds
 * until Home comes back (the retry epoch moves), a few times a session
 * (`stageArtShouldRetry`). `failures` is how many times it has failed so far,
 * which also shrinks the next texture.
 */
function useStageArtRetry(uri: string | undefined) {
  const epoch = useStageArtEpoch();
  const [failure, setFailure] = useState<{
    uri: string;
    epoch: number;
    failures: number;
  } | null>(null);
  const mine = uri && failure?.uri === uri ? failure : null;
  const failed =
    mine !== null &&
    !stageArtShouldRetry({ failures: mine.failures, failedEpoch: mine.epoch, epoch });
  const fail = (record: {
    uri: string;
    slot: StageArtSlot;
    step: StageArtStep;
    error?: unknown;
    maxEdge?: number;
  }) => {
    const failures = noteStageArtFailure(record);
    setFailure({ uri: record.uri, epoch: currentStageArtEpoch(), failures });
  };
  return { failed, failures: mine?.failures ?? 0, fail };
}

/**
 * The clear share and silhouette of `image`, measured on the same small copy:
 * the decoded picture is the shared one, drawn down once and read back as
 * alpha only. An opaque picture is not read at all. Null when it could not be
 * read back.
 */
function measureAlpha(image: SkImage): Omit<StagePictureFacts, 'aspect'> | null {
  if (image.getImageInfo().alphaType === AlphaType.Opaque) return { clear: 0 };
  const width = image.width();
  const height = image.height();
  if (width <= 0 || height <= 0) return { clear: 0 };
  const scale = Math.min(1, MEASURE_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const surface = Skia.Surface.MakeRaster(targetWidth, targetHeight);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    canvas.drawImageRectOptions(
      image,
      Skia.XYWHRect(0, 0, width, height),
      Skia.XYWHRect(0, 0, targetWidth, targetHeight),
      FilterMode.Linear,
      MipmapMode.None
    );
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    try {
      const alpha = snapshot.readPixels(0, 0, {
        width: targetWidth,
        height: targetHeight,
        colorType: ColorType.Alpha_8,
        alphaType: AlphaType.Unpremul,
      });
      return alpha instanceof Uint8Array
        ? {
            clear: stageClearFraction(alpha),
            ...stageAlphaContent(alpha, targetWidth, targetHeight),
          }
        : null;
    } finally {
      snapshot.dispose();
    }
  } finally {
    surface.dispose();
  }
}

/**
 * Measure `image`; when its alpha cannot be counted, fall back to the 2D
 * Home's rule for artwork (clear upper edges make a cut-out) and to a whole
 * scene for anything else, so the picture is still drawn. `fallback` says why.
 */
function measurePicture(
  image: SkImage,
  slot: 'artwork' | 'wallpaper'
): { facts: StagePictureFacts; fallback?: string } {
  const height = image.height();
  const aspect = height > 0 ? image.width() / height : 1;
  let reason = 'The alpha readback returned nothing';
  try {
    const alpha = measureAlpha(image);
    if (alpha !== null) return { facts: { ...alpha, aspect } };
  } catch (error) {
    reason = stageArtErrorText(error) ?? reason;
  }
  if (slot === 'artwork') {
    try {
      const cutout = hasTransparentArtworkUpperEdges(
        image.width(),
        height,
        (x, y) =>
          image.readPixels(x, y, {
            width: 1,
            height: 1,
            colorType: ColorType.Alpha_8,
            alphaType: AlphaType.Unpremul,
          })?.[0]
      );
      return { facts: { clear: cutout ? 1 : 0, aspect }, fallback: reason };
    } catch {
      // A scene, below.
    }
  }
  return { facts: { clear: 0, aspect }, fallback: reason };
}

/**
 * How much of the picture at `uri` is clear (0..1), which decides the layer
 * it becomes, and its shape, which lays it out: `null` while it loads,
 * `undefined` for no picture. A decode failure retains the URI through a
 * conservative measurement marked for native-image fallback until retry.
 */
export function useStagePictureFacts(
  uri: string | undefined,
  slot: 'artwork' | 'wallpaper'
): StagePictureFacts | null | undefined {
  const known = uri ? measuredFacts.get(uri) : undefined;
  const retry = useStageArtRetry(uri);
  const image = useSharedSkiaImage(
    known === undefined && !retry.failed ? uri : undefined,
    (error) => {
      if (uri) retry.fail({ uri, slot, step: 'decode', error });
    }
  );
  const [measured, setMeasured] = useState<{ uri: string; facts: StagePictureFacts } | null>(null);
  useEffect(() => {
    if (!uri || !image || measuredFacts.has(uri)) return;
    const { facts, fallback } = measurePicture(image, slot);
    if (!fallback) measuredFacts.set(uri, facts);
    recordStageArtEvent({
      slot,
      step: 'measure',
      status: fallback ? 'fallback' : 'ok',
      uri,
      width: image.width(),
      height: image.height(),
      error: fallback,
    });
    setMeasured({ uri, facts });
  }, [image, uri, slot]);
  if (!uri) return undefined;
  if (retry.failed) return FAILED_PICTURE;
  if (known !== undefined) return known;
  return measured?.uri === uri ? measured.facts : null;
}

/**
 * Theme pictures as Stage textures. The picture is decoded by the same shared
 * Skia cache Classic and Editorial draw from, then drawn once at the stage's
 * texture cap (<= 2560 px cover layers, <= 2048 px art, never more than the
 * screen's height in pixels; `stage-view.tsx`) and read back as RGBA. The
 * decoded picture stays at its own size in that cache; only the texture
 * follows the cap. A conversion too large for memory (a raster surface or
 * readback that comes back empty, an allocation that throws) fails the
 * picture, which falls back to the static stage and is retried at half the
 * cap. Converted textures are shared and ref-counted per picture and size, so
 * a theme's light and dark pictures are cached separately and both go within a
 * second of nobody showing them (leaving the layout, or a new theme).
 *
 * The decoded picture reaches the loader through `pending`, set and cleared
 * around the one `acquire` that may start a load, so no stale (and possibly
 * already disposed) picture is left behind for a later load of the same key.
 */
const pending = new Map<string, SkImage>();
/** Why the last load of each key failed; cleared on success. */
const textureFailures = new Map<string, string>();
const cache = createRefCountedCache<StageTextureSource>({
  load: async (key) => {
    const image = pending.get(key);
    if (!image) return null;
    const maxEdge = Number(key.slice(0, key.indexOf('|')));
    try {
      const source = downsample(image, maxEdge);
      if (source) textureFailures.delete(key);
      else textureFailures.set(key, 'The pixel readback returned nothing');
      return source;
    } catch (error) {
      textureFailures.set(key, stageArtErrorText(error) ?? 'Downsampling failed');
      return null;
    }
  },
  dispose: (source) => source.texture.dispose(),
});

function downsample(image: SkImage, maxEdge: number): StageTextureSource | null {
  const width = image.width();
  const height = image.height();
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  // A CPU surface: the readback below must not wait on a GPU round trip.
  const surface = Skia.Surface.MakeRaster(targetWidth, targetHeight);
  if (!surface) return null;
  try {
    surface
      .getCanvas()
      .drawImageRectOptions(
        image,
        Skia.XYWHRect(0, 0, width, height),
        Skia.XYWHRect(0, 0, targetWidth, targetHeight),
        FilterMode.Linear,
        MipmapMode.None
      );
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    try {
      const pixels = snapshot.readPixels(0, 0, {
        width: targetWidth,
        height: targetHeight,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      });
      if (!(pixels instanceof Uint8Array)) return null;
      return {
        texture: stageTextureFromPixels(pixels, targetWidth, targetHeight),
        aspect: width / height,
      };
    } finally {
      snapshot.dispose();
    }
  } finally {
    surface.dispose();
  }
}

export type StageTextureState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; source: StageTextureSource }
  | { status: 'failed' };

/**
 * The picture at `uri` as a texture capped at `maxEdge` px, shared while held.
 * A failure is logged and holds until Home comes back; each retry halves the
 * cap (`stageArtRetryEdge`).
 */
export function useStageTexture(
  uri: string | undefined,
  maxEdge: number,
  slot: StageArtSlot
): StageTextureState {
  const retry = useStageArtRetry(uri);
  const active = retry.failed ? undefined : uri;
  const edge = stageArtRetryEdge(maxEdge, retry.failures);
  const image = useSharedSkiaImage(active, (error) => {
    if (active) retry.fail({ uri: active, slot, step: 'decode', error });
  });
  const key = active ? `${edge}|${active}` : null;
  // The source is state, cleared with its lease, never read from the lease in
  // render: see `useSharedSkiaImage` for why.
  const [loaded, setLoaded] = useState<{ key: string; source: StageTextureSource } | null>(null);
  const loadFailed = useEffectEvent((failedUri: string, failedKey: string) =>
    retry.fail({
      uri: failedUri,
      slot,
      step: 'downsample',
      error: textureFailures.get(failedKey),
      maxEdge: edge,
    })
  );
  useEffect(() => {
    if (!key || !active || !image) return;
    const fresh = !cache.peek(key);
    pending.set(key, image);
    const handle = cache.acquire(key);
    pending.delete(key);
    let live = true;
    void handle.promise.then((source) => {
      if (!live) return;
      if (!source) {
        loadFailed(active, key);
        return;
      }
      if (fresh)
        recordStageArtEvent({
          slot,
          step: 'downsample',
          status: 'ok',
          uri: active,
          width: image.width(),
          height: image.height(),
          maxEdge: edge,
        });
      setLoaded({ key, source });
    });
    return () => {
      live = false;
      handle.release();
      setLoaded((current) => (current?.key === key ? null : current));
    };
  }, [image, key, active, slot, edge]);
  if (!uri) return { status: 'none' };
  if (retry.failed) return { status: 'failed' };
  if (loaded !== null && loaded.key === key) return { status: 'ready', source: loaded.source };
  return { status: 'loading' };
}
