import { describe, expect, test } from 'bun:test';

import { isHomeLayout, resolveHomeLayout } from '@/lib/home-layout';

describe('home layout resolution', () => {
  test('accepts only released layouts', () => {
    expect(isHomeLayout('classic')).toBe(true);
    expect(isHomeLayout('editorial')).toBe(true);
    expect(isHomeLayout('studio')).toBe(false);
    expect(isHomeLayout(null)).toBe(false);
    expect(isHomeLayout({ id: 'classic' })).toBe(false);
  });

  test('falls back to editorial for unknown input', () => {
    for (const value of [undefined, 'studio', { id: 'editorial' }]) {
      expect(resolveHomeLayout(value)).toBe('editorial');
    }
  });

  test('keeps an explicitly selected released layout', () => {
    expect(resolveHomeLayout('editorial')).toBe('editorial');
    expect(resolveHomeLayout('classic')).toBe('classic');
  });
});
