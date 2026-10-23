import { describe, expect, test } from 'bun:test';

import { resolveThemeImage } from '@/theme/resolve';
import { createThemeStarter } from '@/theme/starter';
import { DEFAULT_TERMINAL_STYLE } from '../types';
import { paintsCellBackground, terminalCanvasPaint } from '../background';

describe('terminal wallpaper composition', () => {
  test('home-only artwork needs a translucent canvas, while explicit shell disable stays flat', () => {
    const manifest = createThemeStarter();
    manifest.decoration = { 'home.wallpaper': { asset: 'home', opacity: 0.6 } };
    const terminal = { background: '#112233', backgroundOpacity: 0.5 };
    const paint = () =>
      terminalCanvasPaint(
        terminal,
        terminal,
        '#ffffff',
        Boolean(
          resolveThemeImage(manifest, 'shell.wallpaper', 'light', 'compact', true, 'home.wallpaper')
        )
      );
    expect(paint().opaque).toBe(false);
    manifest.decoration['shell.wallpaper'] = { asset: 'shell' };
    expect(paint().opaque).toBe(false);
    manifest.decoration['shell.wallpaper'] = null;
    expect(paint().opaque).toBe(true);
    expect(paint().fill).toBe('rgb(136, 145, 153)');
  });

  test('authored opaque and screen-owning backgrounds retain their solid ground', () => {
    expect(
      terminalCanvasPaint(
        { backgroundOpacity: 1 },
        { background: '#112233', backgroundOpacity: 1 },
        '#ffffff',
        true
      )
    ).toEqual({ opaque: true, fill: '#112233' });
    // A program can paint an opaque surface on the already translucent native
    // canvas without replacing that native view or exposing the wallpaper.
    expect(
      terminalCanvasPaint(
        { backgroundOpacity: 0.5 },
        { background: '#112233', backgroundOpacity: 1 },
        '#ffffff',
        true
      ).fill
    ).toBe('rgba(17, 34, 51, 1)');
  });

  test('explicit ANSI backgrounds remain painted even when they equal the default', () => {
    expect(paintsCellBackground(DEFAULT_TERMINAL_STYLE, '#112233', '#112233')).toBe(false);
    expect(
      paintsCellBackground(
        { ...DEFAULT_TERMINAL_STYLE, background: '#112233' },
        '#112233',
        '#112233'
      )
    ).toBe(true);
    expect(
      paintsCellBackground({ ...DEFAULT_TERMINAL_STYLE, inverse: true }, '#112233', '#112233')
    ).toBe(true);
  });
});
