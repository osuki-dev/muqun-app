// The adopted pane theme is a block-cache key, so its identity has to follow
// its colours and nothing else. A fresh object per applied snapshot turned the
// incremental recorder into a full re-record ten times a second on every pane
// whose program owns the screen -- see `adoptedPaneTheme` in palette.ts.
import { describe, expect, test } from 'bun:test';

import { resolveThemePack } from '@/constants/theme-packs';
import {
  __recordedChunkCount,
  __resetRecordedChunkCount,
  nextHeadRecording,
  planTerminalChunks,
  terminalChunkLayoutKey,
  type TerminalHeadRecording,
} from '@/terminal/chunk-plan';
import { renderingIdentity } from '@/terminal/glyph-cache';
import { createTerminalTheme, terminalPaneTheme } from '@/terminal/palette';
import { readTerminalSurface } from '@/terminal/surface';
import { parseTerminalSnapshot } from '@/terminal/terminal-core';

const CSI = '\x1b[';
const pack = resolveThemePack('catppuccin');
const light = createTerminalTheme(pack, 'light');

function editorRow(text: string, width = 60, background = '33;35;55'): string {
  const padding = ' '.repeat(Math.max(0, width - text.length));
  return `${CSI}0m${CSI}38;2;200;211;245m${CSI}48;2;${background}m${text}${padding}${CSI}0m`;
}

/** An editor screen of `count` rows with the cursor line's text varying. */
function editorFrame(cursorText: string, count = 400, background?: string) {
  const rows = Array.from({ length: count }, (_, row) =>
    editorRow(row === count - 3 ? cursorText : `line ${row} of the buffer`, 60, background)
  );
  return parseTerminalSnapshot(rows.join('\n'), light);
}

function paneThemeOf(frame: ReturnType<typeof editorFrame>) {
  return terminalPaneTheme(pack, light, readTerminalSurface(frame), true);
}

describe('adopted pane theme identity', () => {
  test('the same adopted colours come back as the same object', () => {
    const first = paneThemeOf(editorFrame('a'));
    const second = paneThemeOf(editorFrame('ab'));
    expect(first).not.toBe(light);
    expect(second).toBe(first);
    expect(renderingIdentity(second)).toBe(renderingIdentity(first));
  });

  test('a different adopted background is a different object', () => {
    const navy = paneThemeOf(editorFrame('a'));
    const paper = paneThemeOf(editorFrame('a', 400, '239;241;245'));
    expect(paper).not.toBe(navy);
    expect(paper.background).toBe('rgb(239, 241, 245)');
    expect(paneThemeOf(editorFrame('a'))).toBe(navy);
  });

  test('the block cache stays incremental across applied frames of an adopted pane', () => {
    let keys = new Set<string>();
    let head: TerminalHeadRecording | undefined;
    const apply = (cursorText: string) => {
      const frame = editorFrame(cursorText);
      const layoutKey = terminalChunkLayoutKey({
        cellWidth: 8,
        fontSize: 13,
        lineHeight: 19,
        contentWidth: 500,
        themeId: renderingIdentity(paneThemeOf(frame)),
        fontId: 1,
      });
      __resetRecordedChunkCount();
      const plans = planTerminalChunks(frame.lines, layoutKey, (key) => keys.has(key), head);
      head = nextHeadRecording(plans, frame.lines, head);
      keys = new Set(plans.map((plan) => plan.key));
      return { blocks: plans.length, recorded: __recordedChunkCount };
    };
    const cold = apply('typing: h');
    expect(cold.blocks).toBeGreaterThan(1);
    expect(cold.recorded).toBe(cold.blocks);
    // Nine applied frames, a keystroke each: only the block holding the cursor
    // line is re-recorded (two when the edit moves a content-cut boundary),
    // never the whole pane. Before the memo every frame re-recorded all of it.
    for (let typed = 2; typed <= 10; typed += 1) {
      const { recorded } = apply(`typing: ${'helloworld'.slice(0, typed)}`);
      expect(recorded).toBeGreaterThanOrEqual(1);
      expect(recorded).toBeLessThanOrEqual(2);
    }
  });
});
