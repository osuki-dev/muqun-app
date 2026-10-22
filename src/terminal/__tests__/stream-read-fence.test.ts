// A pane read answered after a newer streamed frame must not take the window
// back in time (the terminal flashed its previous lines for a frame whenever a
// safety-net read landed mid-stream on a phone).
import { describe, expect, test } from 'bun:test';

import { foldPaneWindow, type PaneReadWindow } from '@/terminal/history';
import { createStreamReadFence } from '@/terminal/stream-read-fence';

const screen = (last: number) =>
  Array.from({ length: 6 }, (_, index) => `line ${last - 5 + index}`).join('\n');

describe('createStreamReadFence', () => {
  test('a read with no frame painted while it was in flight may be applied', () => {
    const fence = createStreamReadFence();
    fence.noteFrame();
    const fresh = fence.begin();
    expect(fresh()).toBe(true);
  });

  test('a frame painted while a read is in flight overtakes it, and only that read', () => {
    const fence = createStreamReadFence();
    const early = fence.begin();
    fence.noteFrame();
    const late = fence.begin();
    expect(early()).toBe(false);
    expect(late()).toBe(true);
  });

  test('the overtaken read is the one that would have rolled the window back', () => {
    const fence = createStreamReadFence();
    const fold = (window: PaneReadWindow, text: string, origin: 'frame' | 'refresh') =>
      foldPaneWindow(window, text, origin, 240);
    let window = fold({ output: '', capturedRows: 0 }, screen(10), 'frame');
    fence.noteFrame();

    // The read is taken at line 10; a frame at line 11 lands before its answer.
    const answer = screen(10);
    const fresh = fence.begin();
    window = fold(window, screen(11), 'frame');
    fence.noteFrame();

    expect(fold(window, answer, 'refresh').output.endsWith('line 11')).toBe(false);
    expect(fresh()).toBe(false);
    expect(window.output.endsWith('line 11')).toBe(true);
  });
});
