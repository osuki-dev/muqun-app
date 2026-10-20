import { useEffect, useState } from 'react';
import {
  AlphaType,
  ColorType,
  FontWeight,
  Skia,
  TextAlign,
  type SkCanvas,
} from 'react-native-skia';
import type { Texture } from 'three/webgpu';

import { stageReadableInk } from '@/lib/home-stage-ink';
import { useFrozenValue } from '@/hooks/use-frozen-value';
import type { StagePanel } from '@/lib/home-stage-panels';
import { STAGE_FACE_COLUMNS, STAGE_FACE_ROWS, stageTextureFromPixels } from './stage-scene';

/** One face: the sketch's 640 x 400 at 0.7, about 1.6:1 like the screen. */
const CELL_WIDTH = 448;
const CELL_HEIGHT = 240;
const PAD = 28;

export type StageFaceColors = {
  text: string;
  primary: string;
  success: string;
  warning: string;
  offline: string;
  /** The slab's glass tint in the light variant, which the face reads against. */
  surface: string;
  light: boolean;
};

type Face = { serverId: string; name: string; ink: string };

function paragraph(
  canvas: SkCanvas,
  text: string,
  x: number,
  y: number,
  width: number,
  style: { color: string; size: number; weight: FontWeight; mono?: boolean }
) {
  const builder = Skia.ParagraphBuilder.Make({
    maxLines: 1,
    ellipsis: '…',
    textAlign: TextAlign.Center,
  });
  builder
    .pushStyle({
      color: Skia.Color(style.color),
      fontSize: style.size,
      fontFamilies: style.mono ? ['Menlo', 'monospace'] : ['Helvetica Neue', 'sans-serif'],
      fontStyle: { weight: style.weight },
    })
    .addText(text)
    .pop();
  const built = builder.build();
  builder.dispose?.();
  built.layout(width);
  built.paint(canvas, x, y);
  built.dispose();
}

/** Every drawn face into one atlas, read back as RGBA for a texture. */
function paintAtlas(faces: readonly Face[]): Texture | null {
  const width = CELL_WIDTH * STAGE_FACE_COLUMNS;
  const height = CELL_HEIGHT * STAGE_FACE_ROWS;
  const surface = Skia.Surface.MakeRaster(width, height);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    faces.forEach((face, slot) => {
      const x = (slot % STAGE_FACE_COLUMNS) * CELL_WIDTH;
      const y = Math.floor(slot / STAGE_FACE_COLUMNS) * CELL_HEIGHT;
      canvas.save();
      canvas.clipRect(Skia.XYWHRect(x, y, CELL_WIDTH, CELL_HEIGHT), 1, true);
      paragraph(canvas, face.name, x + PAD, y + 85, CELL_WIDTH - PAD * 2, {
        color: face.ink,
        size: face.name.length > 8 ? 34 : 48,
        weight: FontWeight.Bold,
      });
      canvas.restore();
    });
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    try {
      const pixels = snapshot.readPixels(0, 0, {
        width,
        height,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      });
      return pixels instanceof Uint8Array
        ? stageTextureFromPixels(pixels, width, height, { mipmaps: true })
        : null;
    } finally {
      snapshot.dispose();
    }
  } finally {
    surface.dispose();
  }
}

/** Computer names share one atlas, updated only when visible labels change. */
export function useStageFaces(
  panels: readonly StagePanel[],
  drawn: readonly number[],
  colors: StageFaceColors,
  paused = false
): { atlas: Texture | null; slots: ReadonlyMap<string, number> } {
  const faces: Face[] = drawn.flatMap((index) => {
    const panel = panels[index];
    if (!panel) return [];
    return [
      {
        serverId: panel.serverId,
        name: panel.label,
        ink: stageReadableInk(colors.text, colors.surface),
      },
    ];
  });
  const signature = useFrozenValue(JSON.stringify(faces), paused, null);
  const [atlas, setAtlas] = useState<{
    signature: string;
    texture: Texture | null;
  } | null>(null);
  useEffect(() => {
    let texture: Texture | null = null;
    try {
      texture = paintAtlas(JSON.parse(signature) as Face[]);
    } catch {
      texture = null;
    }
    setAtlas({ signature, texture });
    return () => texture?.dispose();
  }, [signature]);
  const slots = new Map(faces.map((face, slot) => [face.serverId, slot]));
  return { atlas: atlas?.texture ?? null, slots };
}
