/**
 * Rebuild launcher exports from the checked-in masters. Requires ImageMagick 7.
 * Run: bun scripts/generate-brand-assets.ts
 * Creative edits use imagegen; this step only sizes, composites and encodes assets.
 * No generated-image cache, network service or untracked source is required.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type IconSpec = { id: string; directory: string; light: string; dark: string };
const root = fileURLToPath(new URL('../', import.meta.url));
const specs: IconSpec[] = JSON.parse(readFileSync(`${root}assets/icons/catalog.json`, 'utf8'));
const encode = [
  '-strip',
  '-depth',
  '8',
  '+dither',
  '-colors',
  '256',
  '-define',
  'png:compression-level=9',
];
function magick(args: string[]) {
  execFileSync('magick', args, { cwd: root, stdio: 'inherit' });
}

for (const spec of specs) {
  const folder = `assets/icons/${spec.directory}`;
  if (spec.directory === 'classic') continue; // Preserve the original artwork and its native identifier.
  const master = `${folder}/mark.png`;
  for (const [filename, background] of [
    ['icon.png', spec.light],
    ...(spec.dark === spec.light ? [] : [['icon-dark.png', spec.dark]]),
  ]) {
    magick([
      master,
      '-resize',
      '720x720',
      '-gravity',
      'center',
      '-background',
      background,
      '-extent',
      '1024x1024',
      '-alpha',
      'remove',
      '-alpha',
      'off',
      ...encode,
      `${folder}/${filename}`,
    ]);
  }
  // 440px bounding square has a 622px diagonal: fully inside the 66/108 safe circle.
  magick([
    master,
    '-resize',
    '440x440',
    '-gravity',
    'center',
    '-background',
    'none',
    '-extent',
    '1024x1024',
    ...encode,
    `${folder}/android-foreground.png`,
  ]);
  // Small, dedicated picker previews avoid bundling 1024px native build inputs in JS.
  for (const [mode, background] of [
    ['light', spec.light],
    ['dark', spec.dark],
  ]) {
    if (mode === 'dark' && spec.dark === spec.light) continue;
    magick([
      master,
      '-resize',
      '134x134',
      '-gravity',
      'center',
      '-background',
      background,
      '-extent',
      '192x192',
      '-alpha',
      'remove',
      '-alpha',
      'off',
      ...encode,
      `${folder}/preview-${mode}.png`,
    ]);
  }
}
for (const [mode, filename] of [
  ['light', 'icon.png'],
  ['dark', 'icon-dark.png'],
]) {
  magick([
    `assets/icons/classic/${filename}`,
    '-resize',
    '192x192',
    '-alpha',
    'off',
    ...encode,
    `assets/icons/classic/preview-${mode}.png`,
  ]);
}
// Shared monochrome identity retains Classic's facial negative space for every style.
// Classic's existing foreground is already a real transparent mark; use that as the source.
magick([
  'assets/icons/classic/android-icon-foreground.png',
  '-trim',
  '+repage',
  '-resize',
  '440x440',
  '-gravity',
  'center',
  '-background',
  'none',
  '-extent',
  '1024x1024',
  '-colorspace',
  'Gray',
  '-threshold',
  '35%',
  '-transparent',
  'black',
  ...encode,
  'assets/icons/monochrome.png',
]);
magick([
  'assets/icons/mascot/mark.png',
  '-resize',
  '384x384',
  '-gravity',
  'center',
  '-background',
  'none',
  '-extent',
  '512x512',
  ...encode,
  'assets/icons/mascot/brand-mark.png',
]);
magick([
  'assets/icons/classic/icon.png',
  '-resize',
  '64x64',
  ...encode,
  'assets/icons/favicon.png',
]);
console.log('Launcher assets and compact previews regenerated.');
