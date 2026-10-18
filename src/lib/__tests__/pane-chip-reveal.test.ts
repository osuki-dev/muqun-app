import { describe, expect, test } from 'bun:test';

import { paneChipRevealOffset } from '@/lib/pane-chip-reveal';

describe('active pane title reveal', () => {
  test('shows the beginning of a title wider than the viewport', () => {
    expect(paneChipRevealOffset({ x: 180, width: 1400 }, 390, 685, 24)).toBe(156);
    expect(paneChipRevealOffset({ x: 1, width: 1400 }, 390, 0, 24)).toBeNull();
  });

  test('centres shorter offscreen titles while keeping visible titles in place', () => {
    expect(paneChipRevealOffset({ x: 500, width: 100 }, 390, 0, 24)).toBe(355);
    expect(paneChipRevealOffset({ x: 80, width: 100 }, 390, 0, 24)).toBeNull();
    expect(paneChipRevealOffset({ x: 1, width: 100 }, 390, 200, 24)).toBe(0);
  });

  test('does not scroll before measurements or after reaching the target', () => {
    expect(paneChipRevealOffset(undefined, 390, 0, 24)).toBeNull();
    expect(paneChipRevealOffset({ x: 180, width: 1400 }, 0, 0, 24)).toBeNull();
    expect(paneChipRevealOffset({ x: 180, width: 1400 }, 390, 156, 24)).toBeNull();
  });
});
