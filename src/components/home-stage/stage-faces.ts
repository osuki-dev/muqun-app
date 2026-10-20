import { useLingui as useLinguiRuntime } from '@lingui/react';
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

import { agentStatusWord } from '@/i18n/labels';
import { stageReadableInk } from '@/lib/home-stage-ink';
import type { StagePanel } from '@/lib/home-stage-panels';
import { STAGE_FACE_COLUMNS, STAGE_FACE_ROWS, stageTextureFromPixels } from './stage-scene';

/** One face: the sketch's 640 x 400 pane at 0.7, 1.6:1 like the pane. */
const CELL_WIDTH = 448;
const CELL_HEIGHT = 280;
const PAD = 32;

export type StageFaceColors = {
  text: string;
  primary: string;
  success: string;
  warning: string;
  /** An offline computer's text. */
  offline: string;
  /** An offline computer's status dot, as its pane's edge. */
  offlineDot: string;
  /** The pane's glass tint, which the face reads against. */
  surface: string;
  light: boolean;
};

type FaceLine = { text: string; live: boolean };

type Face = {
  serverId: string;
  name: string;
  dot: string;
  /** The name. */
  ink: string;
  /** Ordinary lines, and a running agent's line. */
  lineInk: string;
  liveInk: string;
  lines: FaceLine[];
};

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
    textAlign: TextAlign.Left,
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
    const dot = Skia.Paint();
    faces.forEach((face, slot) => {
      const x = (slot % STAGE_FACE_COLUMNS) * CELL_WIDTH;
      const y = Math.floor(slot / STAGE_FACE_COLUMNS) * CELL_HEIGHT;
      canvas.save();
      canvas.clipRect(Skia.XYWHRect(x, y, CELL_WIDTH, CELL_HEIGHT), 1, true);
      paragraph(canvas, face.name, x + PAD, y + 26, CELL_WIDTH - PAD * 2 - 40, {
        color: face.ink,
        size: 45,
        weight: FontWeight.Bold,
      });
      dot.setColor(Skia.Color(face.dot));
      canvas.drawCircle(x + CELL_WIDTH - 39, y + 55, 8, dot);
      face.lines.forEach((line, index) => {
        paragraph(canvas, line.text, x + PAD, y + 100 + index * 35, CELL_WIDTH - PAD * 2, {
          color: line.live ? face.liveInk : face.lineInk,
          size: 21,
          weight: FontWeight.Medium,
          mono: true,
        });
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

/**
 * The panes' faces -- name, status dot and the latest agent and session
 * lines from existing Home state -- as one texture atlas, drawn over the
 * pane's glass by the scene. Repainted only when
 * what a face says changes, never per frame; the old atlas goes with it.
 */
export function useStageFaces(
  panels: readonly StagePanel[],
  drawn: readonly number[],
  colors: StageFaceColors
): { atlas: Texture | null; slots: ReadonlyMap<string, number> } {
  const { _ } = useLinguiRuntime();
  const faces: Face[] = drawn.flatMap((index) => {
    const panel = panels[index];
    if (!panel) return [];
    const offline = panel.tone === 'offline' || panel.tone === 'unknown';
    const dot = offline
      ? colors.offlineDot
      : panel.tone === 'warning' || panel.attention
        ? colors.warning
        : panel.working
          ? colors.primary
          : colors.success;
    const lines: FaceLine[] = [
      ...panel.face.agents.map((agent) => ({
        text: `${agent.status === 'working' ? '▸' : '·'} ${agent.name} · ${_(agentStatusWord[agent.status])}`,
        live: agent.status === 'working' && !offline,
      })),
      ...panel.face.sessions.map((title) => ({ text: `$ ${title}`, live: false })),
    ];
    // Night: light text on the dark frosted glass, a running line in its status
    // colour. Day: dark text on the pale glass, lines in the primary darkened to
    // 4.5:1 against it.
    const dayLines = stageReadableInk(offline ? colors.offline : colors.primary, colors.surface);
    const ink = offline
      ? colors.light
        ? stageReadableInk(colors.offline, colors.surface)
        : colors.offline
      : colors.text;
    return [
      {
        serverId: panel.serverId,
        name: panel.label,
        dot,
        ink,
        lineInk: colors.light ? dayLines : ink,
        liveInk: colors.light ? dayLines : dot,
        lines,
      },
    ];
  });
  const signature = JSON.stringify(faces);
  const [atlas, setAtlas] = useState<{ signature: string; texture: Texture | null } | null>(null);
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
