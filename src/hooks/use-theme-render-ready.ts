import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { Skia, type CanvasRef } from 'react-native-skia';
import { useIsFocused } from 'expo-router';

import { beginThemeRender } from '@/lib/theme-render-readiness';

/**
 * Submit this Canvas's recorded scene and await its GPU readback. Skia exposes
 * no on-screen presentation callback; rAF alone does not even wait for upload.
 */
async function canvasDrawn(canvas: CanvasRef | null): Promise<boolean> {
  if (!canvas) return false;
  let snapshot;
  let raster;
  try {
    snapshot = canvas.makeImageSnapshot(Skia.XYWHRect(0, 0, 1, 1));
    raster = await snapshot.makeRasterImage();
    return Boolean(raster);
  } catch {
    return false;
  } finally {
    if (raster && raster !== snapshot) raster.dispose();
    snapshot?.dispose();
  }
}

export function useThemeRenderReady(source: string | undefined, ready: boolean) {
  const id = useId();
  const focused = useIsFocused();
  useLayoutEffect(() => {
    if (!source || ready || !focused) return;
    return beginThemeRender(id);
  }, [id, source, ready, focused]);
}

/** Only explicit route backgrounds opt in; decoration and hidden drawers never wait. */
export function ThemeRenderReadiness({ source, ready }: { source: string; ready: boolean }) {
  useThemeRenderReady(source, ready);
  return null;
}

/** Acknowledges a changed canvas once, never on its animation frames. */
export function useSkiaDrawReady(
  canvas: RefObject<CanvasRef | null>,
  identity: unknown,
  enabled: boolean,
  onReady?: (ready: boolean) => void
) {
  const report = useRef(onReady);
  useEffect(() => {
    report.current = onReady;
  }, [onReady]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const frame = requestAnimationFrame(() => {
      void canvasDrawn(canvas.current).then((ready) => {
        if (live) report.current?.(ready);
      });
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
  }, [canvas, identity, enabled]);
}
