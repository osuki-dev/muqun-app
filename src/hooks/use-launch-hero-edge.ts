import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { createMMKV } from 'react-native-mmkv';

import { containedImageRect } from '@/lib/hero-feather';
import type { InkBloomEdge } from '@/lib/ink-bloom-shader';
import {
  chooseHeroEdge,
  decodeHeroEdge,
  encodeHeroEdge,
  heroAlphaEdge,
  heroRectEdge,
  isMeasurableHeroUri,
  type HeroAlphaGrid,
} from '@/lib/launch-hero-edge';

/**
 * The launch picture's own edge, for the opening's front to start from.
 *
 * The geometry is `launch-hero-edge.ts` and has its own tests. This is the
 * half that needs a device: reading the picture's alpha, remembering the
 * answer, and -- the part that matters most -- never letting either of those
 * delay a launch by so much as a frame.
 *
 * ## The race, and how it is not one
 *
 * Measuring the picture costs a decode, and a decode is exactly the kind of
 * thing a cold start has no room for. So the opening never waits for it:
 *
 *  - **The first frame always has an answer.** Before anything is measured the
 *    edge is the rectangle the picture is drawn in, which is already the right
 *    size in the right place. An opening that starts before the measurement
 *    lands simply opens from that rectangle. A picture nothing can open at all
 *    -- a compiled drawable on an unthemed install -- gets no shape and the
 *    opening it always had; see `isMeasurableHeroUri`.
 *  - **The answer is latched when the opening starts.** A decode that finishes
 *    a frame after the rim is on screen must not change the shape of a rim
 *    that is on screen. {@link chooseHeroEdge} is that rule.
 *  - **It is measured once per picture, ever.** The result is normalised and
 *    written to MMKV, and read back synchronously on the next launch -- before
 *    the first frame, the same way `launch-intro-seen.ts` reads its flag. So
 *    the launch that pays is the first one after a pack is applied, and it
 *    pays on the JavaScript thread while the animation runs on the UI one.
 *
 * All of it degrades to the rectangle rather than to an error: a picture that
 * will not decode, a Skia that will not hand back alpha, a binary older than
 * the MMKV store. None of those is worth a failed launch.
 */

/**
 * The alpha grid the outline is measured from, per side.
 *
 * The picture is between 768 and 1024 pixels square in practice and the fit
 * keeps ten harmonics, so a grid this size is already finer than the thing
 * being fitted -- and it is small enough that the whole measurement is a
 * scatter over a few tens of thousands of bytes rather than over a megabyte.
 */
const GRID = 64;

/** How many samples of the source land in each cell, per axis. */
const CELL_SAMPLES = 4;

/**
 * The largest picture that will be read at all, in pixels.
 *
 * `readPixels` copies, so this is the size of the transient allocation as much
 * as it is the size of the loop. A theme pack shipping something larger than
 * this gets the rectangle, which is the fallback working rather than failing.
 */
const MAX_PIXELS = 2048 * 2048;

const STORE_ID = 'muqun.launch';
const STORAGE_KEY = 'muqun.launch-hero-edge';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

/** As `launch-intro-seen.ts`: an over-the-air update can reach a binary without MMKV. */
function openStore(): KeyValueStore {
  try {
    return createMMKV({ id: STORE_ID });
  } catch {
    const memory = new Map<string, string>();
    return {
      getString: (key) => memory.get(key),
      set: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}

let storageInstance: KeyValueStore | null = null;
function store(): KeyValueStore {
  if (!storageInstance) storageInstance = openStore();
  return storageInstance;
}

/** One picture's remembered edge. One entry, not a map: the pack in use is the pack. */
type StoredEdge = { uri: string; edge: string };

function remembered(uri: string, scale: number): InkBloomEdge | null {
  try {
    const raw = store().getString(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const stored = parsed as Partial<StoredEdge>;
    if (stored.uri !== uri || typeof stored.edge !== 'string') return null;
    return decodeHeroEdge(stored.edge, scale);
  } catch {
    return null;
  }
}

function remember(uri: string, edge: InkBloomEdge, scale: number): void {
  try {
    const encoded = encodeHeroEdge(edge, scale);
    if (!encoded) return;
    store().set(STORAGE_KEY, JSON.stringify({ uri, edge: encoded } satisfies StoredEdge));
  } catch {
    // A measurement that cannot be remembered is measured again next launch.
  }
}

/** Test seam, and the reason the store is not a module constant. */
export function resetLaunchHeroEdgeStoreForTesting(): void {
  storageInstance = null;
}

type Alpha = { data: ArrayLike<number>; stride: number; offset: number; scale: number };

/**
 * The picture's alpha, in whatever form Skia will give it up.
 *
 * `Alpha_8` is one byte a pixel and is what this wants; a backend that will
 * not convert to it returns null rather than throwing, so the second attempt
 * is the four-byte form every backend has. Unpremultiplied in both cases, so
 * that the byte read is the artwork's own coverage rather than a coverage that
 * has already been folded into the colour channels.
 */
function readAlpha(image: SkImage, width: number, height: number): Alpha | null {
  const single = image.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.Alpha_8,
    alphaType: AlphaType.Unpremul,
  });
  if (single instanceof Uint8Array && single.length >= width * height) {
    return { data: single, stride: 1, offset: 0, scale: 1 };
  }
  const quad = image.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (quad instanceof Uint8Array && quad.length >= width * height * 4) {
    return { data: quad, stride: 4, offset: 3, scale: 1 };
  }
  if (quad instanceof Float32Array && quad.length >= width * height * 4) {
    return { data: quad, stride: 4, offset: 3, scale: 255 };
  }
  return null;
}

/**
 * The picture, reduced to a {@link GRID} square of alpha.
 *
 * Each cell takes the *largest* alpha of the samples that fall in it, not
 * their average. A strand of hair or the tip of an ear is one pixel wide at
 * this scale, and averaging is precisely the operation that loses it.
 */
function downsample(alpha: Alpha, width: number, height: number): HeroAlphaGrid {
  const cells = new Uint8Array(GRID * GRID);
  const stepX = Math.max(1, Math.floor(width / (GRID * CELL_SAMPLES)));
  const stepY = Math.max(1, Math.floor(height / (GRID * CELL_SAMPLES)));
  for (let y = 0; y < height; y += stepY) {
    const row = Math.min(GRID - 1, Math.floor((y / height) * GRID));
    for (let x = 0; x < width; x += stepX) {
      const column = Math.min(GRID - 1, Math.floor((x / width) * GRID));
      const raw = alpha.data[(y * width + x) * alpha.stride + alpha.offset] ?? 0;
      const value = Math.min(255, Math.round(raw * alpha.scale));
      const index = row * GRID + column;
      if (value > (cells[index] ?? 0)) cells[index] = value;
    }
  }
  return { alpha: cells, width: GRID, height: GRID };
}

/** Decode the picture and fit its outline. Returns null for anything unusable. */
async function measureHeroEdge(
  uri: string,
  box: { width: number; height: number }
): Promise<InkBloomEdge | null> {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) return null;
  const width = image.width();
  const height = image.height();
  if (!(width > 0) || !(height > 0) || width * height > MAX_PIXELS) return null;
  const alpha = readAlpha(image, width, height);
  if (!alpha) return null;
  // The launch frame draws the picture `contain`-fit in its box, so the part
  // of the box the drawing actually occupies is the part worth measuring.
  const drawn = containedImageRect(box, { width, height });
  return heroAlphaEdge(downsample(alpha, width, height), drawn, box);
}

/**
 * The edge the opening should open from, given what is known so far.
 *
 * `started` is the latch: pass the opening's own "the reader is watching this
 * now", and the shape stops changing.
 */
export function useLaunchHeroEdge({
  uri,
  box,
  started,
}: {
  /** The picture the launch frame drew, if it drew one. */
  uri: string | undefined;
  /** The box it is drawn in, in points, or null when there is no picture. */
  box: { width: number; height: number } | null;
  /** Whether the opening has begun, after which the shape is fixed. */
  started: boolean;
}): InkBloomEdge | null {
  const width = box?.width ?? 0;
  const height = box?.height ?? 0;
  // The remembered edge, read synchronously so that the first frame of every
  // launch after the first already has the real outline rather than the box.
  const [measured, setMeasured] = useState<InkBloomEdge | null>(() =>
    isMeasurableHeroUri(uri) && width > 0 ? remembered(uri, width) : null
  );

  useEffect(() => {
    if (!isMeasurableHeroUri(uri) || !(width > 0) || !(height > 0)) return;
    if (remembered(uri, width)) return;
    let cancelled = false;
    // Deliberately not awaited on any render path, and deliberately not
    // deferred either: it is racing the handover, and the launch it cannot
    // win the race for is the launch that pays for every one after it.
    measureHeroEdge(uri, { width, height })
      .then((edge) => {
        if (cancelled || !edge) return;
        remember(uri, edge, width);
        setMeasured(edge);
      })
      .catch(() => {
        // A picture that will not decode is a picture with a rectangle.
      });
    return () => {
      cancelled = true;
    };
  }, [uri, width, height]);

  // The fallback, memoised rather than rebuilt: it is what the chosen edge is
  // most of the time, and the latch below compares edges by identity. Only for
  // a picture that could be measured -- see `isMeasurableHeroUri`, which is
  // also the reason an unthemed launch is untouched by any of this.
  const fallback = useMemo(
    () =>
      isMeasurableHeroUri(uri) && width > 0 && height > 0 ? heroRectEdge({ width, height }) : null,
    [uri, width, height]
  );
  // What the opening is holding on to. Recorded while the opening has not
  // started, and once more if it somehow started before anything was recorded
  // -- which is the one case where the shape could still change underneath a
  // rim that is already drawn, and so the one case worth a second write.
  const [settled, setSettled] = useState<InkBloomEdge | null>(null);
  const edge = chooseHeroEdge({ measured, fallback, settled, started });
  useEffect(() => {
    if (started && settled !== null) return;
    setSettled(edge);
  }, [started, settled, edge]);
  return edge;
}
