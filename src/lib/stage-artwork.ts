/** Classify decoded artwork, never guess transparency from its extension. */
export function stageArtworkKind(
  pixels: Uint8Array,
  width: number,
  height: number
): 'cutout' | 'scene' {
  if (width < 2 || height < 2 || pixels.length < width * height * 4) return 'scene';
  // Several older themes feather only the bottom of a full illustration.
  // Transparent borders alone do not make that rectangular scene a cutout.
  let solidRows = 0;
  for (const fraction of [0.04, 0.12, 0.2, 0.28, 0.36, 0.44]) {
    const y = Math.min(height - 1, Math.floor(height * fraction));
    let opaque = 0;
    for (let i = 0; i < 24; i += 1) {
      const x = Math.min(width - 1, Math.floor(width * (0.03 + (i / 23) * 0.94)));
      if (pixels[(y * width + x) * 4 + 3]! >= 224) opaque += 1;
    }
    if (opaque >= 23) solidRows += 1;
  }
  if (solidRows >= 3) return 'scene';
  let transparent = 0;
  let samples = 0;
  const sample = (x: number, y: number) => {
    samples += 1;
    if (pixels[(y * width + x) * 4 + 3]! < 224) transparent += 1;
  };
  // Sample two border rings. A single antialiased or rounded corner must not
  // turn a full illustration into a character standing on a pedestal.
  for (const inset of [0, Math.max(1, Math.floor(Math.min(width, height) * 0.03))]) {
    for (let i = 0; i < 32; i += 1) {
      const x = Math.round(inset + ((width - 1 - 2 * inset) * i) / 31);
      const y = Math.round(inset + ((height - 1 - 2 * inset) * i) / 31);
      sample(x, inset);
      sample(x, height - 1 - inset);
      sample(inset, y);
      sample(width - 1 - inset, y);
    }
  }
  return transparent / samples >= 0.18 ? 'cutout' : 'scene';
}
