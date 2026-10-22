import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import type { CanvasRef } from 'react-native-skia';
import { useIsFocused } from 'expo-router';

import { beginThemeRender } from '@/lib/theme-render-readiness';

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

/** Wait for the recorded content to reach its surface, without a second offscreen draw. */
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
    const current = canvas.current;
    if (!current) return;
    void current.whenPresented().then((ready) => {
      if (live) report.current?.(ready);
    });
    return () => {
      live = false;
    };
  }, [canvas, identity, enabled]);
}
