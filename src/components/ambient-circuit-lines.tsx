import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { withAlpha } from '@/lib/color';
import { ambientParticleCount } from '@/lib/ambient-motion';
import type { ThemeEffectPaletteRole } from '@/theme/schema';

export interface CircuitPalette {
  primary: string;
  info: string;
  success: string;
  warning: string;
  text: string;
  textMuted: string;
}

/** Sparse printed-circuit traces, static so this effect needs no animation clock. */
export function AmbientCircuitLines({
  width,
  height,
  intensity,
  colors,
  density = 1,
  size = 1,
  palette: paletteRoles,
}: {
  width: number;
  height: number;
  intensity: number;
  colors: CircuitPalette;
  density?: number;
  size?: number;
  palette?: ThemeEffectPaletteRole[];
}) {
  const traces = useMemo(
    () =>
      Array.from({ length: 10 }, (_, index) => {
        const left = index % 2 === 0;
        const startX = left ? -4 : width + 4;
        const direction = left ? 1 : -1;
        const startY = height * (0.07 + index * 0.091);
        const reach = Math.min(width * (0.12 + (index % 3) * 0.035), 110);
        const elbow = 12 + (index % 3) * 7;
        const points = [
          { x: startX, y: startY },
          { x: startX + direction * reach, y: startY },
          { x: startX + direction * (reach + elbow), y: startY + elbow },
          { x: startX + direction * (reach + elbow), y: startY + elbow + 14 },
          { x: startX + direction * (reach + elbow + 20), y: startY + elbow + 14 },
        ];
        const path = Skia.Path.Make();
        path.moveTo(points[0]!.x, points[0]!.y);
        for (const point of points.slice(1)) path.lineTo(point.x, point.y);
        return { path, end: points[points.length - 1]! };
      }),
    [width, height]
  );
  const palette = paletteRoles?.length
    ? paletteRoles.map((role) => colors[role])
    : [colors.primary, colors.info, colors.success, colors.warning];
  const visible = traces.slice(0, ambientParticleCount('scanlines', density));
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {visible.map(({ path }, index) => {
        const color = withAlpha(palette[index % palette.length]!, intensity * 0.24);
        return (
          <Path
            key={`trace-${index}`}
            path={path}
            color={color}
            style="stroke"
            strokeWidth={size}
            strokeCap="round"
            strokeJoin="round"
          />
        );
      })}
      {visible
        .filter((_, index) => index % 2 === 0)
        .map(({ end }, index) => (
          <Circle
            key={`node-${index}`}
            cx={end.x}
            cy={end.y}
            r={2.2 * size}
            color={withAlpha(palette[(index * 2) % palette.length]!, intensity * 0.35)}
          />
        ))}
    </Canvas>
  );
}
