import { useId, type ReactNode } from 'react';
import Svg, { Circle, Defs, G, Mask, Path, Rect } from 'react-native-svg';

import { ThemeIcon } from '@/components/theme-icon';
import type { TaskRowIcon } from '@/lib/home-computer-cards';

/** What a task-state glyph takes: the same three props a chrome glyph does. */
export type TaskGlyphProps = { size: number; color: string; strokeWidth?: number };

/**
 * A task's state, drawn: the pack's `task.<state>` icon when it supplies one,
 * else the built-in glyph.
 *
 * The built-in set is one family, drawn on the 24-unit grid the chrome glyphs
 * use, at their optical size: the settled states are a solid disc of radius 10
 * with their mark cut out of it, so they hold their weight at 16 pt where a
 * thin outlined circle read as rough; the two in-between states are a heavy
 * ring (dotted while starting, an open arc while working -- the one that
 * spins, in `TaskStateIcon`); sent is a solid paper plane. The colour is the
 * row's tone.
 */
export function TaskStateGlyph({ state, ...glyph }: TaskGlyphProps & { state: TaskRowIcon }) {
  switch (state) {
    case 'sent':
      return <ThemeIcon name="task.sent" fallback={SentGlyph} {...glyph} />;
    case 'starting':
      return <ThemeIcon name="task.starting" fallback={StartingGlyph} {...glyph} />;
    case 'working':
      return <ThemeIcon name="task.working" fallback={WorkingGlyph} {...glyph} />;
    case 'waiting':
      return <ThemeIcon name="task.waiting" fallback={WaitingGlyph} {...glyph} />;
    case 'paused':
      return <ThemeIcon name="task.paused" fallback={PausedGlyph} {...glyph} />;
    case 'done':
      return <ThemeIcon name="task.done" fallback={DoneGlyph} {...glyph} />;
    case 'failed':
      return <ThemeIcon name="task.failed" fallback={FailedGlyph} {...glyph} />;
    case 'cancelled':
      return <ThemeIcon name="task.cancelled" fallback={CancelledGlyph} {...glyph} />;
  }
}

function WaitingGlyph(props: TaskGlyphProps) {
  return <CutDisc {...props} cut={WAITING_CUT} />;
}
function PausedGlyph(props: TaskGlyphProps) {
  return <CutDisc {...props} cut={PAUSED_CUT} />;
}
function DoneGlyph(props: TaskGlyphProps) {
  return <CutDisc {...props} cut={DONE_CUT} />;
}
function FailedGlyph(props: TaskGlyphProps) {
  return <CutDisc {...props} cut={FAILED_CUT} />;
}
function CancelledGlyph(props: TaskGlyphProps) {
  return <CutDisc {...props} cut={CANCELLED_CUT} />;
}

/** The width of a mark cut out of a disc, in grid units. */
const CUT = 2.4;

const DONE_CUT = <Path d="M7.6 12.4l3 3 5.8-6.3" strokeWidth={CUT} />;
const FAILED_CUT = <Path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8" strokeWidth={CUT} />;
const CANCELLED_CUT = <Path d="M7.8 12h8.4" strokeWidth={CUT} />;
const PAUSED_CUT = (
  <>
    <Rect x={8.6} y={7.6} width={2.3} height={8.8} rx={0.6} fill="black" />
    <Rect x={13.1} y={7.6} width={2.3} height={8.8} rx={0.6} fill="black" />
  </>
);
const WAITING_CUT = (
  <>
    <Path d="M9.5 9.4a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.4" strokeWidth={CUT} />
    <Circle cx={12} cy={17.1} r={1.35} fill="black" />
  </>
);

/** A solid disc with `cut` taken out of it, so the background shows through. */
function CutDisc({ size, color, cut }: TaskGlyphProps & { cut: ReactNode }) {
  // One mask per drawing: several rows on screen must not share an id.
  const id = `task-cut-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <Mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={24} height={24}>
          <Rect x={0} y={0} width={24} height={24} fill="white" />
          <G stroke="black" fill="none" strokeLinecap="round" strokeLinejoin="round">
            {cut}
          </G>
        </Mask>
      </Defs>
      <Circle cx={12} cy={12} r={10} fill={color} mask={`url(#${id})`} />
    </Svg>
  );
}

function SentGlyph({ size, color }: TaskGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3.5 11.2 19.9 3.8c.7-.3 1.4.4 1.1 1.1l-7.4 16.4c-.3.7-1.3.6-1.5-.1l-1.8-5.9-5.9-1.8c-.7-.2-.8-1.2-.1-1.5Z"
        fill={color}
      />
    </Svg>
  );
}

function StartingGlyph({ size, color, strokeWidth = 2.2 }: TaskGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={12}
        r={8.6}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth + 0.4}
        strokeLinecap="round"
        strokeDasharray="0.1 4.4"
      />
    </Svg>
  );
}

function WorkingGlyph({ size, color, strokeWidth = 2.2 }: TaskGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3.4a8.6 8.6 0 1 1-8.6 8.6"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth + 0.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}
