import { describe, expect, test } from 'bun:test';
import { canUseToolHeaderTint } from '../tool-header-tint';

describe('tool header contrast over its actual backdrop', () => {
  test('keeps the light tint on readable light and dark solid backgrounds', () => {
    expect(canUseToolHeaderTint('#FFFFFF', '#663399', ['#222222', '#555555'], false)).toBe(true);
    expect(canUseToolHeaderTint('#111111', '#AABBFF', ['#FFFFFF', '#CCCCCC'], false)).toBe(true);
  });

  test('requires a reading surface over artwork regardless of the base palette', () => {
    expect(canUseToolHeaderTint('#FFFFFF', '#663399', ['#222222'], true)).toBe(false);
  });

  test('rejects insufficient muted-label contrast and unknown color formats', () => {
    expect(canUseToolHeaderTint('#FFFFFF', '#663399', ['#222222', '#BBBBBB'], false)).toBe(false);
    expect(canUseToolHeaderTint('transparent', '#663399', ['#222222'], false)).toBe(false);
  });
});
