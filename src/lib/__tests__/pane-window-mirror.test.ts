import { beforeEach, expect, test } from 'bun:test';

import { normalizeGatewayEntity } from '../gateway-entities';
import {
  forgetMirroredPaneWindows,
  mirroredPaneWindow,
  PANE_WINDOW_MIRROR_TTL_MS,
  rememberMirroredPaneWindow,
} from '../pane-window-mirror';
import { terminalFitToWidthScale } from '../terminal-text-size';

beforeEach(() => forgetMirroredPaneWindows());

test('cached pane text and its grid remain scoped to the same computer and session', () => {
  const pane = normalizeGatewayEntity({ id: 'pane', width: 30, height: 40, title: 'shell' });
  rememberMirroredPaneWindow(
    'mini',
    'herdr',
    'pane',
    'ansi:recent-unwrapped:main',
    'text',
    100,
    pane
  );
  const other = normalizeGatewayEntity({ id: 'pane', width: 100, height: 80, title: 'other' });
  rememberMirroredPaneWindow(
    'osk',
    'herdr',
    'pane',
    'ansi:recent-unwrapped:main',
    'other',
    100,
    other
  );
  const restored = mirroredPaneWindow('mini', 'herdr', 'pane', 101);
  expect(restored?.pane?.raw.width).toBe(30);
  expect(restored?.pane?.title).toBe('shell');
  expect(mirroredPaneWindow('mini', 'tmux', 'pane', 101)).toBeNull();
  const geometry = { viewportWidth: 411, cellWidth: 7.6, fontSize: 13 };
  expect(terminalFitToWidthScale(geometry, restored?.pane?.raw.width as number)).toBeGreaterThan(1);
  expect(terminalFitToWidthScale(geometry)).toBe(1);
});

test('an early text refresh keeps known geometry but a different read shape cannot borrow it', () => {
  const pane = normalizeGatewayEntity({ id: 'pane', width: 30, height: 40 });
  rememberMirroredPaneWindow('mini', 'herdr', 'pane', 'main', 'old', 100, pane);
  rememberMirroredPaneWindow('mini', 'herdr', 'pane', 'main', 'new', 101);
  expect(mirroredPaneWindow('mini', 'herdr', 'pane', 102)?.pane).toEqual(pane);
  rememberMirroredPaneWindow('mini', 'herdr', 'pane', 'alt', 'screen', 103);
  expect(mirroredPaneWindow('mini', 'herdr', 'pane', 104)?.pane).toBeUndefined();
});

test('foreign pane metadata and expired display facts are never restored', () => {
  const foreign = normalizeGatewayEntity({ id: 'other-pane', width: 30 });
  rememberMirroredPaneWindow('mini', 'herdr', 'pane', 'main', 'text', 100, foreign);
  expect(mirroredPaneWindow('mini', 'herdr', 'pane', 101)?.pane).toBeUndefined();
  expect(mirroredPaneWindow('mini', 'herdr', 'pane', 101 + PANE_WINDOW_MIRROR_TTL_MS)).toBeNull();
});
