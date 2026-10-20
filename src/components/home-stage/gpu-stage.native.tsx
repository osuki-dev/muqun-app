import { createRoot, unmountComponentAtNode } from '@react-three/fiber';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { Canvas, importDevice, type CanvasRef } from 'react-native-webgpu';
import { Skia } from 'react-native-skia';
import { PCFShadowMap, WebGPURenderer } from 'three/webgpu';

import { MapErrorBoundary } from '@/components/computer-map/error-boundary';
import { createSceneLifetimes } from '@/lib/scene-lifetime';
import { STAGE_CAMERA_FOV } from '@/lib/home-stage-geometry';
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
  const [size, setSize] = useState({ width: 0, height: 0 });
  const renderLatest = useEffectEvent(() =>
    root.current?.render(
      <MapErrorBoundary onError={props.onError}>
        <StageRuntime {...props} />
      </MapErrorBoundary>
    )
  );
  const fail = useEffectEvent(() => props.onError());
  const canDraw = useEffectEvent(() => !props.paused);

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
        const dispose = () =>
          new Promise<void>((resolve) => {
            if (root.current === next) root.current = null;
            unmountComponentAtNode(surface, () => resolve());
          });
        try {
          await next.configure({
            size: { ...size, top: 0, left: 0 },
            dpr: Math.min(PixelRatio.get(), 1.5),
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
                antialias: true,
              });
              try {
                await renderer.init();
              } catch (error) {
                await renderer.dispose();
                throw error;
              }
              const draw = renderer.render.bind(renderer);
              renderer.render = (scene, camera) => {
                if (!isLive() || !canDraw()) return;
                try {
                  draw(scene, camera);
                  context.present();
                } catch {
                  fail();
                }
              };
              return renderer;
            },
          });
          if (isLive()) {
            root.current = next;
            renderLatest();
          }
        } catch (error) {
          await dispose();
          throw error;
        }
        return dispose;
      },
      fail
    );
  }, [size]);
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
