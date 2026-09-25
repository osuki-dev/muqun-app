import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_HOME_LAYOUT,
  isHomeLayout,
  resolveHomeLayout,
  type HomeLayout,
} from '@/lib/home-layout';

describe('home layout resolution', () => {
  test('editorial is the default for users without a saved choice', () => {
    expect(DEFAULT_HOME_LAYOUT satisfies HomeLayout).toBe('editorial');
    expect(resolveHomeLayout(undefined)).toBe('editorial');
  });

  test('accepts only released layouts', () => {
    expect(isHomeLayout('classic')).toBe(true);
    expect(isHomeLayout('editorial')).toBe(true);
    expect(isHomeLayout('studio')).toBe(false);
    expect(isHomeLayout(null)).toBe(false);
    expect(isHomeLayout({ id: 'classic' })).toBe(false);
  });

  test.each([undefined, null, '', 'studio', 42, { id: 'editorial' }])(
    'falls back to editorial for unknown input %#',
    (value) => {
      expect(resolveHomeLayout(value)).toBe('editorial');
    }
  );

  test('keeps an explicitly selected released layout', () => {
    expect(resolveHomeLayout('editorial')).toBe('editorial');
    expect(resolveHomeLayout('classic')).toBe('classic');
  });
});
