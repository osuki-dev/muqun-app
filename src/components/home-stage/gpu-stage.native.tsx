import { createRoot, unmountComponentAtNode } from '@react-three/fiber';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { Canvas, importDevice, type CanvasRef } from 'react-native-webgpu';
import { Skia } from 'react-native-skia';
import { PCFShadowMap, WebGPURenderer } from 'three/webgpu';

import { MapErrorBoundary } from '@/components/computer-map/error-boundary';
import { useLatestReader } from '@/hooks/use-render-refs';
import { createSceneLifetimes } from '@/lib/scene-lifetime';
import { createStageCompilation } from '@/lib/stage-compilation';
import { STAGE_CAMERA_FOV } from '@/lib/home-stage-geometry';
import { stageEffects } from '@/lib/home-stage-motion';
import { recordStageArtEvent } from '@/lib/stage-art-diagnostics';
import { StageRuntime } from './stage-runtime';
import type { StageSceneProps } from './types';

type FiberRoot = ReturnType<typeof createRoot>;
const startScene = createSceneLifetimes();

/**
 * The Stage's WebGPU canvas: the computer map's renderer, root and lifetime
 * pattern (one serialized native lifetime per canvas, a Fiber root with
 * on-demand frames, a renderer that reports a lost device instead of
 * throwing) with the Stage's runtime inside. Never takes touches or
 * accessibility focus: the 2D HUD above it owns both.
 */
export default function GpuStage(props: StageSceneProps) {
  const canvas = useRef<CanvasRef>(null);
  const root = useRef<FiberRoot | null>(null);
  const compilation = useRef<ReturnType<typeof createStageCompilation> | null>(null);
  const sceneChanged = useCallback((ready: boolean) => compilation.current?.changed(ready), []);
  const pendingPresentation = useRef<(() => void) | undefined>(undefined);
  const acknowledgePresentation = useEffectEvent(() => {
    const presented = pendingPresentation.current;
    pendingPresentation.current = undefined;
    presented?.();
  });
  const sceneReady = useCallback(() => {
    pendingPresentation.current = props.onPresented;
  }, [props.onPresented]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const surfaceReset = useEffectEvent(() => {
    pendingPresentation.current = undefined;
    props.onSurfaceReset?.();
  });
  useLayoutEffect(() => surfaceReset(), [size]);
  const renderLatest = useEffectEvent(() =>
    root.current?.render(
      <MapErrorBoundary onError={props.onError}>
        <StageRuntime {...props} onSceneReady={sceneReady} onSceneChanged={sceneChanged} />
      </MapErrorBoundary>
    )
  );
  const fail = useEffectEvent((error?: unknown) => props.onError(error));
  const isPaused = useLatestReader(props.paused);
  const currentQuality = useLatestReader(props.quality);

  useEffect(() => {
    if (!size.width || !size.height || !canvas.current) return;
    const nativeCanvas = canvas.current;
    return startScene(
      nativeCanvas.getContextId(),
      async (isLive) => {
        const context = nativeCanvas.getContext('webgpu');
        if (!context) throw new Error('WebGPU canvas unavailable');
        const surface = context.canvas as HTMLCanvasElement;
        const next = createRoot(surface);
        const preparation = createStageCompilation(false);
        compilation.current = preparation;
        let wake = () => {};
        const dispose = async () => {
          await preparation.close();
          if (compilation.current === preparation) compilation.current = null;
          return new Promise<void>((resolve) => {
            if (root.current === next) root.current = null;
            unmountComponentAtNode(surface, () => resolve());
          });
        };
        try {
          await next.configure({
            size: { ...size, top: 0, left: 0 },
            // The device's own ratio, at most 2 at the full rung: a 3x phone
            // shades about 44% of its native pixels, and 2x is where the
            // art's detail stops being visibly softer, though it shades about
            // 1.8x the pixels of a 1.5 cap every frame. Nothing in the
            // scene is text or a hard edge, so a lower rung's 1.5 or 1.0
            // softens the art rather than breaking it (`StageRuntime`).
            dpr: Math.min(
              PixelRatio.get(),
              stageEffects(currentQuality(), { gpuAvailable: true, reducedMotion: false }).maxDpr
            ),
            frameloop: 'demand',
            // No real-time shadows. Fiber's boolean default asks for
            // PCFSoftShadowMap, which the WebGPU renderer warns it has removed.
            shadows: { enabled: false, type: PCFShadowMap },
            camera: { fov: STAGE_CAMERA_FOV, near: 0.1, far: 200 },
            gl: async () => {
              const renderer = new WebGPURenderer({
                canvas: surface,
                context,
                device: importDevice(Skia.getNativeDevice()),
                // No MSAA and no depth buffer. Every layer is a blended plane
                // whose edges are already soft in its shader (the art's
                // fades, the glows, the motes) and the layers are ordered by
                // hand, so 4x multisampling only quadrupled the half-float
                // frame buffer every frame wrote.
                antialias: false,
                depth: false,
              });
              // three only logs these by default, and after a loss its render
              // returns without drawing: the canvas would stay blank (or a
              // layer whose upload ran out of memory missing) with nothing
              // said. A loss falls back to the static stage; an out-of-memory
              // error too, so the art is drawn while a fresh canvas waits for
              // Home's next visit; anything else is logged.
              renderer.onDeviceLost = (info: { message?: string; reason?: string | null }) =>
                fail(new Error(`WebGPU device lost: ${info.reason ?? ''} ${info.message ?? ''}`));
              // Typed as a message; three calls it with { api, type, message }.
              renderer.onError = (info: unknown) => {
                const { type, message } =
                  typeof info === 'object' && info !== null
                    ? (info as { type?: string; message?: string })
                    : { type: undefined, message: String(info) };
                const error = new Error(`${type ?? 'GPUError'}: ${message ?? ''}`);
                if (type === 'GPUOutOfMemoryError') fail(error);
                else
                  recordStageArtEvent({ slot: 'stage', step: 'upload', status: 'failed', error });
              };
              try {
                await renderer.init();
              } catch (error) {
                await renderer.dispose();
                throw error;
              }
              const draw = renderer.render.bind(renderer);
              renderer.render = (scene, camera) => {
                // Never draw into the canvas while Home is off screen: its
                // surface may be gone, and a frame presented then leaves the
                // canvas blank for good. Home wakes the scene when it returns.
                if (!isLive() || isPaused()) return;
                if (
                  !preparation.ready(
                    () => renderer.compileAsync(scene, camera),
                    () => {
                      if (isLive() && !isPaused()) wake();
                    },
                    fail
                  )
                )
                  return;
                try {
                  draw(scene, camera);
                  context.present();
                  acknowledgePresentation();
                } catch (error) {
                  fail(error);
                }
              };
              return renderer;
            },
          });
          if (isLive()) {
            root.current = next;
            const store = renderLatest();
            if (store) wake = store.getState().invalidate;
          }
        } catch (error) {
          await dispose();
          throw error;
        }
        return dispose;
      },
      fail
    );
  }, [size, isPaused, currentQuality]);
  useEffect(() => {
    renderLatest();
  }, [props]);
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height }
        );
      }}>
      <Canvas ref={canvas} style={StyleSheet.absoluteFill} pointerEvents="none" />
    </View>
  );
}
