import { createRoot, unmountComponentAtNode, type RootState } from '@react-three/fiber';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { PanResponder, PixelRatio, StyleSheet, View } from 'react-native';
import { Canvas, importDevice, type CanvasRef } from 'react-native-webgpu';
import { Skia } from 'react-native-skia';
import { PerspectiveCamera, Vector3, WebGPURenderer } from 'three/webgpu';
import { Text } from '@/components/text';
import { createSceneLifetimes } from '@/lib/scene-lifetime';
import { useLatestReader } from '@/hooks/use-render-refs';
import { ComputerScene } from './scene';
import { MapErrorBoundary } from './error-boundary';
import type { ComputerMapSceneProps, MapPose } from './types';

type FiberRoot = ReturnType<typeof createRoot>;
const startScene = createSceneLifetimes();
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function labelsFor(props: ComputerMapSceneProps, width: number, height: number) {
  const { pose } = props;
  const camera = new PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(
    Math.sin(pose.yaw) * Math.cos(pose.pitch) * pose.distance,
    Math.sin(pose.pitch) * pose.distance,
    Math.cos(pose.yaw) * Math.cos(pose.pitch) * pose.distance
  );
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return props.graph.nodes.map((node) => {
    const point = new Vector3(node.position[0], 1, node.position[2]).project(camera);
    return {
      id: node.id,
      label: node.label,
      x: ((point.x + 1) * width) / 2,
      y: ((1 - point.y) * height) / 2,
    };
  });
}

function mapResponder(read: () => ComputerMapSceneProps, readRoot: () => RootState | undefined) {
  let start: MapPose | undefined;
  let pinch = 0;
  let moved = false;
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      start = read().pose;
      moved = false;
      const [a, b] = event.nativeEvent.touches;
      pinch = a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0;
    },
    onPanResponderMove: (event, gesture) => {
      if (!start) return;
      moved ||= Math.hypot(gesture.dx, gesture.dy) > 6 || event.nativeEvent.touches.length > 1;
      const [a, b] = event.nativeEvent.touches;
      if (a && b) {
        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        if (!pinch) {
          pinch = distance;
          start = read().pose;
        }
        read().onPose({
          ...start,
          distance: clamp((start.distance * pinch) / Math.max(1, distance), 9, 20),
        });
      } else {
        read().onPose({
          ...start,
          yaw: clamp(start.yaw - gesture.dx / 180, -Math.PI, Math.PI),
          pitch: clamp(start.pitch + gesture.dy / 240, 0.35, 1.25),
        });
      }
    },
    onPanResponderRelease: (event) => {
      if (moved) return;
      const state = readRoot();
      if (!state) return;
      state.pointer.set(
        (event.nativeEvent.locationX / state.size.width) * 2 - 1,
        1 - (event.nativeEvent.locationY / state.size.height) * 2
      );
      state.raycaster.setFromCamera(state.pointer, state.camera);
      const hit = state.raycaster
        .intersectObjects(state.scene.children, true)
        .find((entry) => typeof entry.object.userData.nodeId === 'string');
      if (hit) read().onSelect(hit.object.userData.nodeId as string);
    },
    onPanResponderTerminationRequest: () => false,
  });
}

export default function GpuMap(props: ComputerMapSceneProps) {
  const { t } = useLingui();
  const canvas = useRef<CanvasRef>(null);
  const root = useRef<FiberRoot | null>(null);
  const state = useRef<RootState | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const read = useLatestReader(props);
  const readState = useLatestReader(state);
  const responder = useMemo(() => mapResponder(read, () => readState().current), [read, readState]);
  const renderLatest = useEffectEvent(() =>
    root.current?.render(
      <MapErrorBoundary onError={props.onError}>
        <ComputerScene {...props} />
      </MapErrorBoundary>
    )
  );
  const fail = useEffectEvent(() => props.onError());

  useEffect(() => {
    if (!size.width || !size.height || !canvas.current) return;
    setReady(false);
    const nativeCanvas = canvas.current;
    return startScene(
      nativeCanvas.getContextId(),
      async (isLive) => {
        const context = nativeCanvas.getContext('webgpu');
        if (!context) throw new Error('WebGPU canvas unavailable');
        // NativeCanvas supplies the DOM-like dimensions used by Fiber/Three.
        // Touch input is delivered by the native responder, not DOM listeners.
        const surface = context.canvas as HTMLCanvasElement;
        const next = createRoot(surface);
        const dispose = () =>
          new Promise<void>((resolve) => {
            if (root.current === next) {
              root.current = null;
              state.current = undefined;
            }
            unmountComponentAtNode(surface, () => resolve());
          });
        try {
          await next.configure({
            size: { ...size, top: 0, left: 0 },
            dpr: Math.min(PixelRatio.get(), 2),
            frameloop: 'demand',
            camera: { fov: 45, near: 0.1, far: 100 },
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
                if (!isLive()) return;
                try {
                  draw(scene, camera);
                  context.present();
                } catch {
                  fail();
                }
              };
              return renderer;
            },
            onCreated: (created) => {
              state.current = created;
              setReady(true);
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
  const labels = size.width && size.height ? labelsFor(props, size.width, size.height) : [];
  return (
    <View
      style={styles.frame}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height }
        );
      }}
      {...responder.panHandlers}
      accessible={false}
      importantForAccessibility="no-hide-descendants">
      <Canvas ref={canvas} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {!ready ? (
          <Text variant="caption" color={props.colors.foreground}>{t`Loading map…`}</Text>
        ) : null}
        {labels.map((label) => (
          <View
            key={label.id}
            style={[
              styles.label,
              {
                left: clamp(label.x - 52, 0, Math.max(0, size.width - 104)),
                top: clamp(label.y - 12, 0, Math.max(0, size.height - 24)),
                backgroundColor: props.colors.background,
              },
            ]}>
            <Text variant="caption" numberOfLines={1} color={props.colors.foreground}>
              {label.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { height: 310, overflow: 'hidden' },
  label: {
    position: 'absolute',
    width: 104,
    paddingHorizontal: 4,
    borderRadius: 3,
    alignItems: 'center',
  },
});
