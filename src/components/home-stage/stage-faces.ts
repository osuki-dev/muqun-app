import { plural } from '@lingui/core/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import {
  AlphaType,
  ColorType,
  FontWeight,
  Skia,
  TextAlign,
  type SkCanvas,
  type SkPaint,
} from 'react-native-skia';
import type { Texture } from 'three/webgpu';

import { useMinuteNow } from '@/hooks/use-minute-now';
import { useTaskAge } from '@/hooks/use-task-age';
import { agentStatusWord, connectionStatusDescription } from '@/i18n/labels';
import {
  stageFaceHeight,
  STAGE_FACE_CELL_HEIGHT as CELL_HEIGHT,
  STAGE_FACE_CELL_WIDTH as CELL_WIDTH,
  STAGE_FACE_LINE_STEP,
  STAGE_FACE_LINE_TOP,
  STAGE_FACE_PAD as PAD,
  STAGE_FACE_SIDE_HEIGHT,
  STAGE_FACE_SUMMARY_TOP,
} from '@/lib/home-stage-geometry';
import { stageReadableInk } from '@/lib/home-stage-ink';
import type { StageAgentLine, StagePanel } from '@/lib/home-stage-panels';
import { STAGE_FACE_COLUMNS, STAGE_FACE_ROWS, stageTextureFromPixels } from './stage-scene';

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

/** A run of text in one ink. */
type Span = { text: string; ink: string };

/**
 * A row under the summary: one line of spans, or names to wrap onto at most
 * `IDLE_ROWS` rows (a quiet computer's idle agents).
 */
type Row = { spans: Span[] } | { names: string[]; ink: string };

type Face = {
  serverId: string;
  name: string;
  /** The front face's dot: its status, or the warning colour while it needs you. */
  dot: string;
  /** The side face's dot: its status alone... */
  status: string;
  /** ...and beside it a warning dot while it needs you. */
  warn: string | null;
  /** The name. */
  ink: string;
  /** "2 working · 1 needs you", or the one quiet or offline line. */
  summary: Span[];
  /** The front face's rows under the summary. */
  rows: Row[];
};

type TextStyle = { size: number; weight: FontWeight; mono?: boolean; maxLines?: number };

/** A quiet face wraps its idle agents onto this many rows at most. */
const IDLE_ROWS = 2;
const LINE_STYLE: TextStyle = { size: 21, weight: FontWeight.Medium, mono: true };

function build(spans: readonly Span[], style: TextStyle) {
  const builder = Skia.ParagraphBuilder.Make({
    maxLines: style.maxLines ?? 1,
    ellipsis: '…',
    textAlign: TextAlign.Left,
  });
  for (const span of spans)
    builder
      .pushStyle({
        color: Skia.Color(span.ink),
        fontSize: style.size,
        fontFamilies: style.mono ? ['Menlo', 'monospace'] : ['Helvetica Neue', 'sans-serif'],
        fontStyle: { weight: style.weight },
      })
      .addText(span.text)
      .pop();
  const built = builder.build();
  builder.dispose?.();
  return built;
}

function paragraph(
  canvas: SkCanvas,
  spans: readonly Span[],
  x: number,
  y: number,
  width: number,
  style: TextStyle
) {
  const built = build(spans, style);
  built.layout(width);
  built.paint(canvas, x, y);
  built.dispose();
}

/** `text`'s width on one line, in cell pixels. */
function measure(text: string, style: TextStyle): number {
  const built = build([{ text, ink: '#000000' }], style);
  built.layout(100_000);
  const width = built.getMaxIntrinsicWidth();
  built.dispose();
  return width;
}

/**
 * `names` as "· codex · claude ×2", wrapped by measured width onto at most
 * `IDLE_ROWS` rows; the last row ends in an ellipsis when more do not fit.
 */
function wrapNames(names: readonly string[], width: number): string[] {
  const counted = new Map<string, number>();
  for (const name of names) counted.set(name, (counted.get(name) ?? 0) + 1);
  const items = [...counted].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
  const rows: string[] = [];
  let row = '';
  for (const item of items) {
    const next = row ? `${row} · ${item}` : `· ${item}`;
    if (!row || measure(next, LINE_STYLE) <= width || rows.length === IDLE_ROWS - 1) row = next;
    else {
      rows.push(row);
      row = `· ${item}`;
    }
  }
  if (row) rows.push(row);
  return rows;
}

/**
 * The front face: name and dot, the summary, then its rows. Returns how many
 * rows it painted under the name, the summary included.
 */
function paintFront(canvas: SkCanvas, face: Face, x: number, y: number, dot: SkPaint): number {
  const width = CELL_WIDTH - PAD * 2;
  paragraph(canvas, [{ text: face.name, ink: face.ink }], x + PAD, y + 22, width - 40, {
    size: 42,
    weight: FontWeight.Bold,
  });
  dot.setColor(Skia.Color(face.dot));
  canvas.drawCircle(x + CELL_WIDTH - 39, y + 50, 8, dot);
  paragraph(canvas, face.summary, x + PAD, y + STAGE_FACE_SUMMARY_TOP, width, {
    size: 23,
    weight: FontWeight.SemiBold,
  });
  const lines = face.rows.flatMap((row): Span[][] =>
    'spans' in row
      ? [row.spans]
      : wrapNames(row.names, width).map((text) => [{ text, ink: row.ink }])
  );
  lines.forEach((line, index) => {
    paragraph(
      canvas,
      line,
      x + PAD,
      y + STAGE_FACE_LINE_TOP + index * STAGE_FACE_LINE_STEP,
      width,
      LINE_STYLE
    );
  });
  return 1 + lines.length;
}

/**
 * A neighbour's face, read from the side and cut short to
 * `STAGE_FACE_SIDE_HEIGHT`: the name, larger, its status dot and a warning
 * dot while it needs you. Nothing else, so nothing is cut at the screen edge.
 */
function paintCompact(canvas: SkCanvas, face: Face, x: number, y: number, dot: SkPaint) {
  const middle = y + STAGE_FACE_SIDE_HEIGHT / 2;
  const dots = face.warn ? 82 : 48;
  paragraph(
    canvas,
    [{ text: face.name, ink: face.ink }],
    x + PAD,
    middle - 34,
    CELL_WIDTH - PAD * 2 - dots,
    { size: 54, weight: FontWeight.Bold }
  );
  dot.setColor(Skia.Color(face.status));
  canvas.drawCircle(x + CELL_WIDTH - 44, middle, 12, dot);
  if (face.warn) {
    dot.setColor(Skia.Color(face.warn));
    canvas.drawCircle(x + CELL_WIDTH - 78, middle, 12, dot);
  }
}

/**
 * Every drawn face, front and compact, into one atlas read back as RGBA, only
 * as many rows tall as the faces need, with how tall each front face came out
 * (`stageFaceHeight`). Painted into `reuse` when that is the same size, so the
 * GPU updates the texture it has rather than allocating another; otherwise a
 * new texture.
 */
function paintAtlas(
  faces: readonly Face[],
  reuse: Texture | null
): { texture: Texture | null; heights: number[] } {
  const width = CELL_WIDTH * STAGE_FACE_COLUMNS * 2;
  const rows = Math.min(STAGE_FACE_ROWS, Math.max(1, Math.ceil(faces.length / STAGE_FACE_COLUMNS)));
  const height = CELL_HEIGHT * rows;
  const heights: number[] = [];
  const surface = Skia.Surface.MakeRaster(width, height);
  if (!surface) return { texture: null, heights };
  try {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    const dot = Skia.Paint();
    faces.forEach((face, slot) => {
      const y = Math.floor(slot / STAGE_FACE_COLUMNS) * CELL_HEIGHT;
      for (const compact of [false, true]) {
        const x = ((slot % STAGE_FACE_COLUMNS) + (compact ? STAGE_FACE_COLUMNS : 0)) * CELL_WIDTH;
        canvas.save();
        canvas.clipRect(Skia.XYWHRect(x, y, CELL_WIDTH, CELL_HEIGHT), 1, true);
        if (compact) paintCompact(canvas, face, x, y, dot);
        else heights[slot] = stageFaceHeight(paintFront(canvas, face, x, y, dot));
        canvas.restore();
      }
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
      if (!(pixels instanceof Uint8Array)) return { texture: null, heights };
      const image = reuse?.image as { data: unknown; width: number; height: number } | undefined;
      if (reuse && image && image.width === width && image.height === height) {
        image.data = pixels;
        reuse.needsUpdate = true;
        return { texture: reuse, heights };
      }
      const atlas = stageTextureFromPixels(pixels, width, height, { mipmaps: true });
      // The side panes turn 48 degrees away: sharper text there for a few samples.
      atlas.anisotropy = 4;
      return { texture: atlas, heights };
    } finally {
      snapshot.dispose();
    }
  } finally {
    surface.dispose();
  }
}

const MARKER: Record<StageAgentLine['mark'], string> = {
  working: '▸',
  'needs-you': '⚑',
  idle: '·',
};

/**
 * The panes' faces -- name, status dot, what the computer is doing and
 * whether it needs the reader, from existing Home state -- as one texture
 * atlas, drawn over the pane's glass by the scene, with how tall each front
 * face is (`heights`, cell pixels by computer), which the pane's height
 * follows. Repainted only when what a face says or its colours change, never
 * per frame, and into the same texture while the number of faces stays the
 * same (`version` counts the repaints). While Home is off screen (`paused`)
 * nothing is repainted -- a status or the minute changing there costs
 * nothing -- and the faces catch up when it returns.
 */
export function useStageFaces(
  panels: readonly StagePanel[],
  drawn: readonly number[],
  colors: StageFaceColors,
  paused: boolean
): {
  atlas: Texture | null;
  version: number;
  slots: ReadonlyMap<string, number>;
  heights: ReadonlyMap<string, number>;
} {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const age = useTaskAge();
  const nowMs = useMinuteNow();
  const faces: Face[] = drawn.flatMap((index) => {
    const panel = panels[index];
    if (!panel) return [];
    const offline = panel.tone === 'offline' || panel.tone === 'unknown';
    const status = offline
      ? colors.offlineDot
      : panel.tone === 'warning'
        ? colors.warning
        : panel.working
          ? colors.primary
          : colors.success;
    const dot = panel.attention && !offline ? colors.warning : status;
    // Night: light text on the dark frosted glass, running work in the
    // primary and a wait in the warning colour. Day: dark text on the pale
    // glass, every colour darkened to 4.5:1 against it.
    const ink = offline
      ? colors.light
        ? stageReadableInk(colors.offline, colors.surface)
        : colors.offline
      : colors.text;
    const lineInk = colors.light
      ? stageReadableInk(offline ? colors.offline : colors.primary, colors.surface)
      : ink;
    const liveInk = colors.light ? lineInk : colors.primary;
    const warnInk = colors.light
      ? stageReadableInk(colors.warning, colors.surface)
      : colors.warning;
    const { face } = panel;
    let summary: Span[];
    if (face.kind === 'busy') {
      const parts: Span[] = [];
      if (panel.workingCount > 0)
        parts.push({
          text: plural(panel.workingCount, { one: '# working', other: '# working' }),
          ink: liveInk,
        });
      if (panel.needsYouCount > 0)
        parts.push({
          text: plural(panel.needsYouCount, { one: '# needs you', other: '# need you' }),
          ink: warnInk,
        });
      summary = parts.flatMap((part, at) =>
        at > 0 ? [{ text: ' · ', ink: lineInk }, part] : [part]
      );
    } else {
      const text =
        face.kind === 'offline'
          ? face.lastSeenMs !== undefined
            ? t`Offline · last seen ${age(face.lastSeenMs, nowMs)}`
            : t`Offline`
          : face.kind === 'quiet'
            ? t`All quiet`
            : _(connectionStatusDescription[panel.connection]);
      summary = [
        { text, ink: face.kind === 'status' && panel.tone === 'warning' ? warnInk : lineInk },
      ];
    }
    const rows: Row[] =
      face.kind === 'busy'
        ? [
            ...face.agents.map((agent): Row => {
              const lead =
                agent.mark === 'needs-you' ? warnInk : agent.mark === 'working' ? liveInk : lineInk;
              const doing =
                agent.activity ??
                (agent.mark === 'needs-you' ? t`Needs you` : _(agentStatusWord[agent.status]));
              return {
                spans: [
                  { text: `${MARKER[agent.mark]} `, ink: lead },
                  { text: agent.name, ink: agent.mark === 'idle' ? lineInk : ink },
                  { text: ` · ${doing}`, ink: lead },
                ],
              };
            }),
            ...(face.more > 0
              ? [
                  {
                    spans: [
                      {
                        text: plural(face.more, { one: '+# more', other: '+# more' }),
                        ink: lineInk,
                      },
                    ],
                  },
                ]
              : []),
          ]
        : face.kind === 'quiet'
          ? [
              ...(face.idle.length > 0 ? [{ names: face.idle, ink: lineInk }] : []),
              ...(face.lastActivityMs !== undefined
                ? [
                    {
                      spans: [
                        {
                          text: t`Last activity ${age(face.lastActivityMs, nowMs)}`,
                          ink: lineInk,
                        },
                      ],
                    },
                  ]
                : []),
            ]
          : [];
    return [
      {
        serverId: panel.serverId,
        name: panel.label,
        dot,
        status,
        warn: panel.attention && !offline ? colors.warning : null,
        ink,
        summary,
        rows,
      },
    ];
  });
  const current = JSON.stringify(faces);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const signature = paused && atlas ? atlas.signature : current;
  const owned = useRef<Texture | null>(null);
  useEffect(() => {
    const painted = JSON.parse(signature) as Face[];
    let result: ReturnType<typeof paintAtlas> = { texture: null, heights: [] };
    try {
      result = paintAtlas(painted, owned.current);
    } catch {
      result = { texture: null, heights: [] };
    }
    const { texture, heights } = result;
    if (owned.current !== texture) owned.current?.dispose();
    owned.current = texture;
    setAtlas((previous) => ({
      signature,
      texture,
      version: (previous?.version ?? 0) + 1,
      slots: new Map(painted.map((face, slot) => [face.serverId, slot])),
      heights: new Map(
        painted.flatMap((face, slot) => {
          const height = heights[slot];
          return height === undefined ? [] : [[face.serverId, height] as const];
        })
      ),
    }));
  }, [signature]);
  useEffect(
    () => () => {
      owned.current?.dispose();
      owned.current = null;
    },
    []
  );
  return {
    atlas: atlas?.texture ?? null,
    version: atlas?.version ?? 0,
    slots: atlas?.slots ?? NO_SLOTS,
    heights: atlas?.heights ?? NO_SLOTS,
  };
}

type Atlas = {
  signature: string;
  texture: Texture | null;
  version: number;
  /** Each painted computer's cell in the atlas. */
  slots: ReadonlyMap<string, number>;
  /** Each painted computer's front face height, in cell pixels. */
  heights: ReadonlyMap<string, number>;
};

const NO_SLOTS: ReadonlyMap<string, number> = new Map();
