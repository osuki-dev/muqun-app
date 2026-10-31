import { StyleSheet } from 'react-native';
import { Canvas, Fill, Group, Image, useCanvasRef, type SkImage } from 'react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, useReducedMotion, type SharedValue } from 'react-native-reanimated';

import { ParticleField, PARTICLE_EFFECT } from './particle-field';
import { useSkiaDrawReady } from '@/hooks/use-theme-render-ready';

export type ParticleTransitionProps = {
  /** Outgoing snapshot. Omit for reassembly only. */
  from?: SkImage | null;
  /** Incoming snapshot. Omit to dissolve onto the live content beneath. */
  to?: SkImage | null;
  /** Controlled 0..1 clock. Reverse it to reverse the transition. */
  progress: SharedValue<number>;
  /** Logical viewport dimensions, independent of snapshot pixel density. */
  width: number;
  height: number;
  /** Explicit caller palette; the primitive never reads global theme state. */
  backgroundColor: string;
  fromTint?: string;
  toTint?: string;
  /** Reports GPU readback success or failure for each changed snapshot/viewport. */
  onReady?: (ready: boolean) => void;
};

/**
 * A controlled, non-interactive transition surface, independent of themes and navigation.
 * Progress travels from 0 to 1: `from` dissolves, `to` reassembles, or both cross over.
 * The caller owns the clock, cancellation and image disposal. Keep snapshots alive until
 * this surface unmounts. `onReady` acknowledges the first GPU draw, not merely a mount.
 * Dimensions are logical points; snapshots may be at any pixel density.
 */
export function ParticleTransition({
  from,
  to,
  progress,
  width,
  height,
  backgroundColor,
  fromTint,
  toTint,
  onReady,
}: ParticleTransitionProps) {
  const canvas = useCanvasRef();
  const reduced = useReducedMotion();
  const hasIncoming = Boolean(to);
  const outgoing = useDerivedValue(() =>
    Math.min(1, Math.max(0, progress.get() / (hasIncoming ? 0.7 : 1)))
  );
  const incoming = useDerivedValue(() =>
    Math.min(1, Math.max(0, (1 - Math.min(1, Math.max(0, progress.get()))) / 0.7))
  );
  const fading = useDerivedValue(() => 1 - Math.min(1, Math.max(0, progress.get())));
  const appearing = useDerivedValue(() => Math.min(1, Math.max(0, progress.get())));
  const identity = useMemo(() => ({ from, to, width, height }), [from, to, width, height]);
  useSkiaDrawReady(canvas, identity, Boolean(from || to), onReady);
  if ((!from && !to) || !(width > 0 && height > 0)) return null;
  if (reduced || !PARTICLE_EFFECT)
    return (
      <Canvas ref={canvas} pointerEvents="none" style={StyleSheet.absoluteFill}>
        {to ? (
          <Group opacity={from ? 1 : appearing}>
            <Image image={to} x={0} y={0} width={width} height={height} fit="cover" />
          </Group>
        ) : null}
        {from ? (
          <Group opacity={fading}>
            <Image image={from} x={0} y={0} width={width} height={height} fit="cover" />
          </Group>
        ) : null}
      </Canvas>
    );
  return (
    <Canvas ref={canvas} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {to ? <Fill color={backgroundColor} /> : null}
      {to ? (
        <ParticleField
          image={to}
          width={width}
          height={height}
          progress={incoming}
          tint={toTint}
          onReady={fieldReady}
        />
      ) : null}
      {from ? (
        <ParticleField
          image={from}
          width={width}
          height={height}
          progress={outgoing}
          tint={fromTint}
          onReady={fieldReady}
        />
      ) : null}
    </Canvas>
  );
}

const fieldReady = () => {};
