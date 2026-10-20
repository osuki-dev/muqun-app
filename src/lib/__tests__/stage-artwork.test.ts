import { expect, test } from 'bun:test';
import { stageArtworkKind } from '../stage-artwork';

function pixels(alpha: (x: number, y: number) => number) {
  const result = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1)
    for (let x = 0; x < 64; x += 1) result[(y * 64 + x) * 4 + 3] = alpha(x, y);
  return result;
}

test('opaque illustrations and bottom-feathered scenes do not become pedestal characters', () => {
  expect(
    stageArtworkKind(
      pixels(() => 255),
      64,
      64
    )
  ).toBe('scene');
  expect(
    stageArtworkKind(
      pixels((_, y) => (y < 40 ? 255 : 0)),
      64,
      64
    )
  ).toBe('scene');
  expect(
    stageArtworkKind(
      pixels((x, y) => (x < 3 && y < 3 ? 0 : 255)),
      64,
      64
    )
  ).toBe('scene');
});

test('a freestanding silhouette with transparent surroundings stays a cutout', () => {
  expect(
    stageArtworkKind(
      pixels((x, y) => (x > 16 && x < 48 && y > 4 ? 255 : 0)),
      64,
      64
    )
  ).toBe('cutout');
});

test('incomplete pixel buffers fall back to a scene without sampling invalid memory', () => {
  expect(stageArtworkKind(new Uint8Array(8), 64, 64)).toBe('scene');
});
